import { githubRequest } from "./client.ts";
import type { GithubErrorCode, GithubResult } from "./types.ts";

export type JobKind = "default" | "pull" | "branch" | "issue";

export type ReviewJob = {
  kind: JobKind;
  title: string;
  head: string;
  sha: string;
  base: string;
  number: number | null;
  body: string;
  comments: string[];
  comparePaths: string[];
  patches: { path: string; patch: string }[];
};

export type JobListItem = {
  kind: "pull" | "branch" | "issue";
  id: string;
  title: string;
  head: string;
  base: string;
  number: number | null;
  updatedAt: string | null;
};

const COMMENT_CAP = 16;
const COMMENT_CHARS = 400;
const PATCH_FILES = 24;
const PATCH_CHARS = 1_200;

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

export function defaultReviewJob(defaultBranch: string, sha: string): ReviewJob {
  return {
    kind: "default",
    title: `${defaultBranch} (default)`,
    head: defaultBranch,
    sha,
    base: defaultBranch,
    number: null,
    body: "",
    comments: [],
    comparePaths: [],
    patches: [],
  };
}

export function extractMentionedPaths(text: string, known: string[]): string[] {
  if (!text.trim() || known.length === 0) return [];
  const hay = text.toLowerCase();
  const fromTicks = [...text.matchAll(/`([^`\n]{1,180})`/g)].map((match) =>
    match[1]!.trim().replace(/\\/g, "/"),
  );
  const hits = known.filter((path) => {
    const needle = path.toLowerCase();
    return hay.includes(needle) || fromTicks.includes(path);
  });
  return [...new Set([...fromTicks.filter((path) => known.includes(path)), ...hits])].slice(
    0,
    24,
  );
}

export function formatJobDigest(job: ReviewJob): string {
  const lines = [
    `Job: ${job.kind} — ${job.title}`,
    `Head: ${job.head} (${job.sha.slice(0, 8)})`,
    `Base: ${job.base}`,
  ];
  if (job.number) lines.push(`Number: ${job.number}`);
  if (job.body.trim()) lines.push("", job.body.slice(0, 2_000));
  if (job.comments.length) {
    lines.push("", "## Comments", ...job.comments.map((item) => `- ${item}`));
  }
  if (job.comparePaths.length) {
    lines.push("", "## Changed paths", job.comparePaths.slice(0, 80).join("\n"));
  }
  if (job.patches.length) {
    lines.push(
      "",
      "## Diff excerpts",
      ...job.patches.map(
        (item) => `### ${item.path}\n\`\`\`diff\n${item.patch}\n\`\`\``,
      ),
    );
  }
  return lines.join("\n");
}

type GhPull = {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  updated_at?: string;
  base?: { ref?: string; sha?: string };
  head?: { ref?: string; sha?: string };
  message?: string;
};

type GhBranch = {
  name?: string;
  commit?: { sha?: string };
  protected?: boolean;
};

type GhIssue = {
  number?: number;
  title?: string;
  body?: string | null;
  updated_at?: string;
  pull_request?: unknown;
};

type GhComment = { body?: string; user?: { login?: string } };

type GhCompare = {
  files?: { filename?: string; patch?: string; status?: string }[];
  message?: string;
};

function mapStatus(status: number, remaining: string | null, message?: string) {
  if (status === 401) return fail("GitHub rejected the access token.", "unauthorized");
  if (status === 403 && remaining === "0") {
    return fail("GitHub rate limit reached.", "rate_limit");
  }
  if (status === 403) return fail(message || "GitHub refused the request.", "unauthorized");
  if (status === 404) return fail(message || "Not found.", "not_found");
  return fail(message || `GitHub error ${status}`, "network");
}

export async function listRepoJobs(input: {
  owner: string;
  repo: string;
  token: string;
  signal?: AbortSignal;
}): Promise<GithubResult<{ pulls: JobListItem[]; branches: JobListItem[]; issues: JobListItem[] }>> {
  const token = input.token.trim();
  if (!token) return fail("A GitHub token is required to list PRs, branches, and issues.", "unauthorized");
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  try {
    const [pullsRes, branchesRes, issuesRes] = await Promise.all([
      githubRequest<GhPull[] | { message?: string }>(
        "GET",
        `/repos/${owner}/${repo}/pulls?state=open&per_page=30&sort=updated`,
        token,
        undefined,
        input.signal,
      ),
      githubRequest<GhBranch[] | { message?: string }>(
        "GET",
        `/repos/${owner}/${repo}/branches?per_page=100`,
        token,
        undefined,
        input.signal,
      ),
      githubRequest<GhIssue[] | { message?: string }>(
        "GET",
        `/repos/${owner}/${repo}/issues?state=open&per_page=30`,
        token,
        undefined,
        input.signal,
      ),
    ]);
    for (const res of [pullsRes, branchesRes, issuesRes]) {
      if (res.status >= 400) {
        const message = !Array.isArray(res.json) ? res.json.message : undefined;
        return mapStatus(res.status, res.remaining, message);
      }
    }
    const pulls = Array.isArray(pullsRes.json)
      ? pullsRes.json.map((item) => ({
          kind: "pull" as const,
          id: `pull-${item.number}`,
          title: item.title || `PR #${item.number}`,
          head: item.head?.ref || "",
          base: item.base?.ref || "",
          number: item.number ?? null,
          updatedAt: item.updated_at ?? null,
        }))
      : [];
    const branches = Array.isArray(branchesRes.json)
      ? branchesRes.json
          .filter((item) => Boolean(item.name))
          .map((item) => ({
            kind: "branch" as const,
            id: `branch-${item.name}`,
            title: item.name || "",
            head: item.name || "",
            base: "",
            number: null,
            updatedAt: null,
          }))
      : [];
    const issues = Array.isArray(issuesRes.json)
      ? issuesRes.json
          .filter((item) => !item.pull_request)
          .map((item) => ({
            kind: "issue" as const,
            id: `issue-${item.number}`,
            title: item.title || `Issue #${item.number}`,
            head: "",
            base: "",
            number: item.number ?? null,
            updatedAt: item.updated_at ?? null,
          }))
      : [];
    return { ok: true, data: { pulls, branches, issues } };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not list jobs.", "network");
  }
}

async function loadComments(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await githubRequest<GhComment[] | { message?: string }>(
    "GET",
    path,
    token,
    undefined,
    signal,
  );
  if (res.status >= 400 || !Array.isArray(res.json)) return [];
  return res.json
    .slice(0, COMMENT_CAP)
    .map((item) => {
      const who = item.user?.login ? `@${item.user.login}: ` : "";
      return `${who}${(item.body ?? "").slice(0, COMMENT_CHARS)}`;
    })
    .filter(Boolean);
}

export async function loadCompare(input: {
  owner: string;
  repo: string;
  token: string;
  base: string;
  head: string;
  signal?: AbortSignal;
}): Promise<{ paths: string[]; patches: { path: string; patch: string }[] }> {
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const spec = `${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`;
  const res = await githubRequest<GhCompare>(
    "GET",
    `/repos/${owner}/${repo}/compare/${spec}`,
    input.token,
    undefined,
    input.signal,
  );
  if (res.status >= 400 || !res.json.files) return { paths: [], patches: [] };
  const files = res.json.files.filter((file) => file.filename);
  return {
    paths: files.map((file) => file.filename!),
    patches: files.slice(0, PATCH_FILES).map((file) => ({
      path: file.filename!,
      patch: (file.patch ?? file.status ?? "").slice(0, PATCH_CHARS),
    })),
  };
}

export async function resolveReviewJob(input: {
  owner: string;
  repo: string;
  token: string;
  defaultBranch: string;
  defaultSha: string;
  item: JobListItem | { kind: "default" };
  signal?: AbortSignal;
}): Promise<GithubResult<ReviewJob>> {
  const token = input.token.trim();
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  if (input.item.kind === "default") {
    return { ok: true, data: defaultReviewJob(input.defaultBranch, input.defaultSha) };
  }
  try {
    if (input.item.kind === "pull" && input.item.number) {
      const res = await githubRequest<GhPull>(
        "GET",
        `/repos/${owner}/${repo}/pulls/${input.item.number}`,
        token,
        undefined,
        input.signal,
      );
      if (res.status >= 400) return mapStatus(res.status, res.remaining, res.json.message);
      const sha = res.json.head?.sha || "";
      const head = res.json.head?.ref || input.item.head;
      const base = res.json.base?.ref || input.defaultBranch;
      const [issueComments, reviewComments, compare] = await Promise.all([
        loadComments(
          `/repos/${owner}/${repo}/issues/${input.item.number}/comments?per_page=20`,
          token,
          input.signal,
        ),
        loadComments(
          `/repos/${owner}/${repo}/pulls/${input.item.number}/comments?per_page=20`,
          token,
          input.signal,
        ),
        loadCompare({
          owner: input.owner,
          repo: input.repo,
          token,
          base,
          head,
          signal: input.signal,
        }),
      ]);
      return {
        ok: true,
        data: {
          kind: "pull",
          title: res.json.title || `PR #${input.item.number}`,
          head,
          sha,
          base,
          number: input.item.number,
          body: res.json.body ?? "",
          comments: [...issueComments, ...reviewComments].slice(0, COMMENT_CAP),
          comparePaths: compare.paths,
          patches: compare.patches,
        },
      };
    }
    if (input.item.kind === "branch") {
      const name = input.item.head;
      const res = await githubRequest<GhBranch>(
        "GET",
        `/repos/${owner}/${repo}/branches/${encodeURIComponent(name)}`,
        token,
        undefined,
        input.signal,
      );
      if (res.status >= 400) {
        return mapStatus(
          res.status,
          res.remaining,
          !Array.isArray(res.json) ? (res.json as { message?: string }).message : undefined,
        );
      }
      const sha = res.json.commit?.sha || "";
      const compare = await loadCompare({
        owner: input.owner,
        repo: input.repo,
        token,
        base: input.defaultBranch,
        head: name,
        signal: input.signal,
      });
      return {
        ok: true,
        data: {
          kind: "branch",
          title: name,
          head: name,
          sha,
          base: input.defaultBranch,
          number: null,
          body: "",
          comments: [],
          comparePaths: compare.paths,
          patches: compare.patches,
        },
      };
    }
    if (input.item.kind === "issue" && input.item.number) {
      const res = await githubRequest<GhIssue>(
        "GET",
        `/repos/${owner}/${repo}/issues/${input.item.number}`,
        token,
        undefined,
        input.signal,
      );
      if (res.status >= 400) {
        return mapStatus(
          res.status,
          res.remaining,
          (res.json as { message?: string }).message,
        );
      }
      const comments = await loadComments(
        `/repos/${owner}/${repo}/issues/${input.item.number}/comments?per_page=20`,
        token,
        input.signal,
      );
      return {
        ok: true,
        data: {
          kind: "issue",
          title: res.json.title || `Issue #${input.item.number}`,
          head: input.defaultBranch,
          sha: input.defaultSha,
          base: input.defaultBranch,
          number: input.item.number,
          body: res.json.body ?? "",
          comments,
          comparePaths: [],
          patches: [],
        },
      };
    }
    return fail("Unknown job.", "invalid");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not load job.", "network");
  }
}
