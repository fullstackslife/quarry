import { githubRequest } from "./client.ts";
import type { GithubErrorCode, GithubResult } from "./types.ts";

export const ACCESSIBLE_REPO_PAGE_SIZE = 100;
export const ACCESSIBLE_REPO_MAX_PAGES = 30;

export type AccessibleRepo = {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  htmlUrl: string;
  fork: boolean;
  archived: boolean;
};

export type AccessibleRepoList = {
  login: string | null;
  repos: AccessibleRepo[];
  truncated: boolean;
};

type GhUser = { login?: string; message?: string };

type GhRepoRow = {
  name?: string;
  full_name?: string;
  description?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  html_url?: string;
  private?: boolean;
  fork?: boolean;
  archived?: boolean;
  owner?: { login?: string };
  message?: string;
};

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

export function mapAccessibleRepo(row: GhRepoRow): AccessibleRepo | null {
  const owner = row.owner?.login?.trim() || "";
  const repo = row.name?.trim() || "";
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    fullName: row.full_name?.trim() || `${owner}/${repo}`,
    private: Boolean(row.private),
    description: row.description ?? null,
    language: row.language ?? null,
    pushedAt: row.pushed_at ?? null,
    htmlUrl: row.html_url || `https://github.com/${owner}/${repo}`,
    fork: Boolean(row.fork),
    archived: Boolean(row.archived),
  };
}

export function filterAccessibleRepos(
  repos: AccessibleRepo[],
  query: string,
  visibility: "all" | "private" | "public",
  extra?: {
    owner?: string;
    language?: string;
    pins?: string[];
    pinnedOnly?: boolean;
    stale?: boolean;
    lastReviewedAt?: Record<string, number>;
  },
): AccessibleRepo[] {
  const needle = query.trim().toLowerCase();
  const owner = extra?.owner?.trim().toLowerCase();
  const language = extra?.language?.trim().toLowerCase();
  const pins = new Set((extra?.pins ?? []).map((item) => item.toLowerCase()));
  return repos.filter((item) => {
    if (visibility === "private" && !item.private) return false;
    if (visibility === "public" && item.private) return false;
    if (owner && item.owner.toLowerCase() !== owner) return false;
    if (language && (item.language ?? "").toLowerCase() !== language) return false;
    if (extra?.pinnedOnly && !pins.has(item.fullName.toLowerCase())) return false;
    if (extra?.stale) {
      const last = extra.lastReviewedAt?.[item.fullName.toLowerCase()] ?? 0;
      const pushed = item.pushedAt ? Date.parse(item.pushedAt) : 0;
      if (!pushed || pushed <= last) return false;
    }
    if (!needle) return true;
    return (
      item.fullName.toLowerCase().includes(needle) ||
      (item.description ?? "").toLowerCase().includes(needle) ||
      (item.language ?? "").toLowerCase().includes(needle)
    );
  });
}

function reposQuery(page: number): string {
  const affiliation = encodeURIComponent(
    "owner,collaborator,organization_member",
  );
  return `/user/repos?per_page=${ACCESSIBLE_REPO_PAGE_SIZE}&page=${page}&sort=pushed&direction=desc&affiliation=${affiliation}`;
}

export async function listAccessibleRepos(input: {
  token: string;
  signal?: AbortSignal;
}): Promise<GithubResult<AccessibleRepoList>> {
  const token = input.token.trim();
  if (!token) {
    return fail(
      "Add a GitHub token in Settings to list repositories you can access.",
      "unauthorized",
    );
  }

  try {
    const userRes = await githubRequest<GhUser>(
      "GET",
      "/user",
      token,
      undefined,
      input.signal,
    );
    const login =
      userRes.status < 400 && userRes.json.login
        ? userRes.json.login
        : null;

    const repos: AccessibleRepo[] = [];
    let truncated = false;

    for (let page = 1; page <= ACCESSIBLE_REPO_MAX_PAGES; page += 1) {
      const res = await githubRequest<GhRepoRow[] | { message?: string }>(
        "GET",
        reposQuery(page),
        token,
        undefined,
        input.signal,
      );
      if (res.status >= 400) {
        const message =
          !Array.isArray(res.json) && res.json.message
            ? res.json.message
            : undefined;
        if (res.status === 401) {
          return fail("GitHub rejected the access token.", "unauthorized");
        }
        if (res.status === 403 && res.remaining === "0") {
          return fail(
            "GitHub rate limit reached. Wait, then refresh the repo list.",
            "rate_limit",
          );
        }
        if (res.status === 403) {
          return fail(
            message ||
              "This token cannot list repositories. Fine-grained tokens need Metadata read on the repos you want to see. Classic tokens need the repo scope.",
            "unauthorized",
          );
        }
        return fail(message || `GitHub error ${res.status}`, "network");
      }
      if (!Array.isArray(res.json)) {
        return fail("GitHub returned an unexpected repo list.", "network");
      }
      for (const row of res.json) {
        const mapped = mapAccessibleRepo(row);
        if (mapped) repos.push(mapped);
      }
      if (res.json.length < ACCESSIBLE_REPO_PAGE_SIZE) {
        truncated = false;
        break;
      }
      if (page === ACCESSIBLE_REPO_MAX_PAGES) truncated = true;
    }

    repos.sort((a, b) => Number(b.private) - Number(a.private));

    return { ok: true, data: { login, repos, truncated } };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message =
      err instanceof Error ? err.message : "Could not list GitHub repositories.";
    return fail(message, "network");
  }
}
