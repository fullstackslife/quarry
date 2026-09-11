import { githubRequest } from "./client.ts";
import type { GithubErrorCode, GithubResult } from "./types.ts";
import type { Finding } from "../review/types.ts";

export type GithubIssue = {
  number: number;
  title: string;
  htmlUrl: string;
  state: "open" | "closed";
};

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

function mapStatus(
  status: number,
  remaining: string | null,
  message?: string,
): GithubResult<never> {
  if (status === 401) return fail("GitHub rejected the access token.", "unauthorized");
  if (status === 403 && remaining === "0") {
    return fail("GitHub rate limit reached.", "rate_limit");
  }
  if (status === 403) {
    return fail(
      message ||
        "This token cannot write issues. Fine-grained tokens need Issues: Write. Classic tokens need the repo scope.",
      "unauthorized",
    );
  }
  if (status === 404) return fail(message || "Issue or repository not found.", "not_found");
  if (status === 422) return fail(message || "GitHub rejected that issue.", "invalid");
  return fail(message || `GitHub error ${status}`, "network");
}

export function findingIssueTitle(finding: Finding): string {
  const raw = `[quarry] ${finding.severity}: ${finding.title}`.trim();
  return raw.slice(0, 240);
}

export function formatFindingIssue(finding: Finding): { title: string; body: string } {
  const lines = [
    finding.detail.trim(),
    "",
    finding.file ? `File: \`${finding.file}\`` : "",
    `Severity: ${finding.severity}`,
    `Category: ${finding.category}`,
    finding.evidence ? `\n\`\`\`\n${finding.evidence.slice(0, 1_200)}\n\`\`\`` : "",
    "",
    "_Opened from a Quarry review._",
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
  return {
    title: findingIssueTitle(finding),
    body: lines.join("\n").trim() + "\n",
  };
}

export function addressIssueComment(extra?: string): string {
  const extraText = extra?.trim();
  return [
    "Quarry is addressing this issue from the local reviewer.",
    extraText || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function resolveIssueComment(extra?: string): string {
  const extraText = extra?.trim();
  return [extraText || "Resolved from Quarry.", "", "_Closed by Quarry._"]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();
}

type GhIssue = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  message?: string;
  errors?: { message?: string }[];
};

function mapIssue(json: GhIssue, owner: string, repo: string): GithubIssue | null {
  if (!json.number) return null;
  return {
    number: json.number,
    title: json.title || `Issue #${json.number}`,
    htmlUrl: json.html_url || `https://github.com/${owner}/${repo}/issues/${json.number}`,
    state: json.state === "closed" ? "closed" : "open",
  };
}

async function ensureQuarryLabel(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
) {
  await githubRequest(
    "POST",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
    token,
    { name: "quarry", color: "3d5a3a", description: "Opened or tracked by Quarry" },
    signal,
  );
}

export async function createGithubIssue(input: {
  owner: string;
  repo: string;
  token: string;
  title: string;
  body?: string;
  labels?: string[];
  signal?: AbortSignal;
}): Promise<GithubResult<GithubIssue>> {
  const token = input.token.trim();
  if (!token) {
    return fail("Add a GitHub token with Issues write to create issues.", "unauthorized");
  }
  const title = input.title.trim().slice(0, 256);
  if (!title) return fail("An issue needs a title.", "invalid");
  try {
    await ensureQuarryLabel(input.owner, input.repo, token, input.signal);
    const labels = [...new Set(["quarry", ...(input.labels ?? [])])];
    const res = await githubRequest<GhIssue>(
      "POST",
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`,
      token,
      {
        title,
        body: input.body?.trim() || undefined,
        labels,
      },
      input.signal,
    );
    if (res.status >= 400) {
      const detail =
        res.json.errors?.map((item) => item.message).filter(Boolean).join(" ") ||
        res.json.message;
      return mapStatus(res.status, res.remaining, detail);
    }
    const mapped = mapIssue(res.json, input.owner, input.repo);
    if (!mapped) return fail("GitHub created an issue but returned no number.", "network");
    return { ok: true, data: mapped };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not create the issue.", "network");
  }
}

export async function commentOnGithubIssue(input: {
  owner: string;
  repo: string;
  token: string;
  number: number;
  body: string;
  signal?: AbortSignal;
}): Promise<GithubResult<{ htmlUrl: string }>> {
  const token = input.token.trim();
  const body = input.body.trim();
  if (!token) return fail("A GitHub token is required to comment.", "unauthorized");
  if (!body) return fail("Comment text is empty.", "invalid");
  if (!input.number) return fail("Pick an issue first.", "invalid");
  try {
    const res = await githubRequest<{ html_url?: string; message?: string }>(
      "POST",
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.number}/comments`,
      token,
      { body },
      input.signal,
    );
    if (res.status >= 400) {
      return mapStatus(res.status, res.remaining, res.json.message);
    }
    return {
      ok: true,
      data: {
        htmlUrl:
          res.json.html_url ||
          `https://github.com/${input.owner}/${input.repo}/issues/${input.number}`,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not comment.", "network");
  }
}

export async function setGithubIssueState(input: {
  owner: string;
  repo: string;
  token: string;
  number: number;
  state: "open" | "closed";
  reason?: "completed" | "not_planned" | "reopened";
  signal?: AbortSignal;
}): Promise<GithubResult<GithubIssue>> {
  const token = input.token.trim();
  if (!token) return fail("A GitHub token is required to update issues.", "unauthorized");
  if (!input.number) return fail("Pick an issue first.", "invalid");
  try {
    const res = await githubRequest<GhIssue>(
      "PATCH",
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.number}`,
      token,
      {
        state: input.state,
        state_reason:
          input.reason ??
          (input.state === "closed" ? "completed" : "reopened"),
      },
      input.signal,
    );
    if (res.status >= 400) {
      return mapStatus(res.status, res.remaining, res.json.message);
    }
    const mapped = mapIssue(res.json, input.owner, input.repo);
    if (!mapped) return fail("GitHub updated the issue but returned no number.", "network");
    return { ok: true, data: mapped };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not update the issue.", "network");
  }
}

export async function addressGithubIssue(input: {
  owner: string;
  repo: string;
  token: string;
  number: number;
  extra?: string;
  signal?: AbortSignal;
}): Promise<GithubResult<{ htmlUrl: string }>> {
  return commentOnGithubIssue({
    ...input,
    body: addressIssueComment(input.extra),
  });
}

export async function resolveGithubIssue(input: {
  owner: string;
  repo: string;
  token: string;
  number: number;
  extra?: string;
  signal?: AbortSignal;
}): Promise<GithubResult<GithubIssue>> {
  const commented = await commentOnGithubIssue({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    number: input.number,
    body: resolveIssueComment(input.extra),
    signal: input.signal,
  });
  if (!commented.ok) return commented;
  return setGithubIssueState({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    number: input.number,
    state: "closed",
    reason: "completed",
    signal: input.signal,
  });
}

export async function createIssuesFromFindings(input: {
  owner: string;
  repo: string;
  token: string;
  findings: Finding[];
  signal?: AbortSignal;
}): Promise<GithubResult<{ issues: GithubIssue[]; warnings: string[] }>> {
  const findings = input.findings.filter((item) => item.severity !== "info").slice(0, 8);
  if (findings.length === 0) {
    return fail("Select findings to file (info notes are skipped).", "invalid");
  }
  const issues: GithubIssue[] = [];
  const warnings: string[] = [];
  for (const finding of findings) {
    const spec = formatFindingIssue(finding);
    const created = await createGithubIssue({
      owner: input.owner,
      repo: input.repo,
      token: input.token,
      title: spec.title,
      body: spec.body,
      signal: input.signal,
    });
    if (!created.ok) {
      warnings.push(`${finding.title}: ${created.error}`);
      continue;
    }
    issues.push(created.data);
  }
  if (issues.length === 0) {
    return fail(warnings[0] || "Could not file any issues.", "network");
  }
  return { ok: true, data: { issues, warnings } };
}
