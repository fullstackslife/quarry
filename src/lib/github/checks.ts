import { githubRequest } from "./client.ts";

export type CheckDigest = {
  summary: string;
  pending: boolean;
  configured: boolean;
};

type CheckRuns = {
  total_count?: number;
  check_runs?: { name?: string; conclusion?: string | null; status?: string }[];
  message?: string;
};

type CombinedStatus = {
  state?: string;
  statuses?: { context?: string; state?: string }[];
  message?: string;
};

function formatRuns(runs: NonNullable<CheckRuns["check_runs"]>): string {
  if (!runs.length) return "";
  return runs
    .slice(0, 12)
    .map((run) => {
      const state = run.conclusion || run.status || "unknown";
      return `- ${run.name ?? "check"}: ${state}`;
    })
    .join("\n");
}

export function formatVerifySection(digest: CheckDigest): string {
  return ["## Quarry verify", digest.summary, digest.configured ? "" : "", digest.configured ? "" : "No GitHub checks were configured for this commit."]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();
}

export async function loadCommitChecks(input: {
  owner: string;
  repo: string;
  token: string;
  sha: string;
}): Promise<CheckDigest> {
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const sha = encodeURIComponent(input.sha);
  const [runsRes, statusRes] = await Promise.all([
    githubRequest<CheckRuns>(
      "GET",
      `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      input.token,
    ),
    githubRequest<CombinedStatus>(
      "GET",
      `/repos/${owner}/${repo}/commits/${sha}/status`,
      input.token,
    ),
  ]);
  if (runsRes.status === 403 || statusRes.status === 403) {
    return {
      configured: false,
      pending: false,
      summary: "Token cannot read Actions/Checks. Grant Checks read to verify on GitHub.",
    };
  }
  const runs = runsRes.status < 400 ? runsRes.json.check_runs ?? [] : [];
  const statuses = statusRes.status < 400 ? statusRes.json.statuses ?? [] : [];
  const pending =
    runs.some((run) => run.status === "queued" || run.status === "in_progress") ||
    statuses.some((item) => item.state === "pending");
  if (!runs.length && !statuses.length) {
    return {
      configured: false,
      pending: false,
      summary: "No check-runs or commit statuses on this SHA.",
    };
  }
  const failed = runs.filter(
    (run) => run.conclusion === "failure" || run.conclusion === "timed_out",
  );
  const state = statusRes.json.state ?? (failed.length ? "failure" : pending ? "pending" : "success");
  return {
    configured: true,
    pending,
    summary: [`Combined: ${state}`, formatRuns(runs)].filter(Boolean).join("\n"),
  };
}

export async function pollCommitChecks(input: {
  owner: string;
  repo: string;
  token: string;
  sha: string;
  attempts?: number;
  delayMs?: number;
}): Promise<CheckDigest> {
  const attempts = input.attempts ?? 4;
  const delayMs = input.delayMs ?? 2500;
  let last = await loadCommitChecks(input);
  for (let i = 1; i < attempts && last.pending; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await loadCommitChecks(input);
  }
  return last;
}

export async function appendPullBody(input: {
  owner: string;
  repo: string;
  token: string;
  number: number;
  extra: string;
}): Promise<void> {
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const current = await githubRequest<{ body?: string }>(
    "GET",
    `/repos/${owner}/${repo}/pulls/${input.number}`,
    input.token,
  );
  const body = [current.json.body?.trim() ?? "", "", input.extra].filter(Boolean).join("\n");
  await githubRequest(
    "PATCH",
    `/repos/${owner}/${repo}/pulls/${input.number}`,
    input.token,
    { body },
  );
}
