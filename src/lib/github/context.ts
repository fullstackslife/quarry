import { githubRequest } from "./client.ts";

export type RepoContextDigest = {
  checks: string | null;
  codeowners: string | null;
  protection: string | null;
  dependabot: string | null;
};

function clip(text: string, max = 1_200): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function formatContextDigest(digest: RepoContextDigest): string {
  const parts = [
    digest.checks ? `## CI\n${digest.checks}` : "",
    digest.protection ? `## Branch protection\n${digest.protection}` : "",
    digest.codeowners ? `## CODEOWNERS\n${digest.codeowners}` : "",
    digest.dependabot ? `## Dependabot\n${digest.dependabot}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export async function loadRepoContext(input: {
  owner: string;
  repo: string;
  token: string;
  sha: string;
  defaultBranch: string;
  signal?: AbortSignal;
}): Promise<RepoContextDigest> {
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const token = input.token.trim();
  const digest: RepoContextDigest = {
    checks: null,
    codeowners: null,
    protection: null,
    dependabot: null,
  };
  if (!token) return digest;

  const [runs, protection, codeowners, dependabot] = await Promise.all([
    githubRequest<{
      check_runs?: { name?: string; conclusion?: string | null; status?: string }[];
    }>(
      "GET",
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(input.sha)}/check-runs`,
      token,
      undefined,
      input.signal,
    ),
    githubRequest<{
      required_status_checks?: { contexts?: string[] };
      enforce_admins?: { enabled?: boolean };
      required_pull_request_reviews?: { required_approving_review_count?: number };
      message?: string;
    }>(
      "GET",
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(input.defaultBranch)}/protection`,
      token,
      undefined,
      input.signal,
    ),
    githubRequest<{ content?: string; encoding?: string; message?: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/CODEOWNERS?ref=${encodeURIComponent(input.sha)}`,
      token,
      undefined,
      input.signal,
    ),
    githubRequest<{ security_advisory?: { summary?: string }; dependency?: { package?: { name?: string } }; severity?: string }[] | { message?: string }>(
      "GET",
      `/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=5`,
      token,
      undefined,
      input.signal,
    ),
  ]);

  if (runs.status < 400 && runs.json.check_runs?.length) {
    digest.checks = runs.json.check_runs
      .slice(0, 8)
      .map((run) => `${run.name}: ${run.conclusion || run.status}`)
      .join("\n");
  }
  if (protection.status === 200) {
    const reviews = protection.json.required_pull_request_reviews?.required_approving_review_count;
    const contexts = protection.json.required_status_checks?.contexts ?? [];
    digest.protection = [
      reviews != null ? `Required reviews: ${reviews}` : "Protection enabled",
      contexts.length ? `Required checks: ${contexts.join(", ")}` : "",
      protection.json.enforce_admins?.enabled ? "Enforced for admins" : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (codeowners.status === 200 && codeowners.json.encoding === "base64" && codeowners.json.content) {
    try {
      digest.codeowners = clip(atob(codeowners.json.content.replace(/\n/g, "")));
    } catch {
      digest.codeowners = null;
    }
  } else if (codeowners.status === 404) {
    const nested = await githubRequest<{ content?: string; encoding?: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/.github/CODEOWNERS?ref=${encodeURIComponent(input.sha)}`,
      token,
      undefined,
      input.signal,
    );
    if (nested.status === 200 && nested.json.encoding === "base64" && nested.json.content) {
      try {
        digest.codeowners = clip(atob(nested.json.content.replace(/\n/g, "")));
      } catch {
        digest.codeowners = null;
      }
    }
  }
  if (dependabot.status === 200 && Array.isArray(dependabot.json) && dependabot.json.length) {
    digest.dependabot = dependabot.json
      .slice(0, 5)
      .map((alert) => {
        const name = alert.dependency?.package?.name ?? "dependency";
        const sev = alert.severity ?? "unknown";
        return `${sev}: ${name}`;
      })
      .join("\n");
  }
  return digest;
}
