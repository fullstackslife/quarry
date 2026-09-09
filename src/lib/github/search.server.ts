import {
  CODE_SEARCH_MAX_PAGES,
  CODE_SEARCH_PAGE_SIZE,
  reposFromCodeSearchItems,
  scopedCodeSearchQueries,
  type CodeSearchHit,
  type CodeSearchSuccess,
} from "./search";
import type { GithubErrorCode, GithubResult } from "./types";

const UA = "Quarry-Reviewer (https://github.com/fullstackslife/quarry)";

type SearchJson = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: CodeSearchHit[];
  message?: string;
  documentation_url?: string;
};

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

async function gh<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ status: number; json: T; remaining: string | null }> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    },
    signal,
  });
  const remaining = res.headers.get("x-ratelimit-remaining");
  let json = {} as T;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = { message: text } as T;
    }
  }
  return { status: res.status, json, remaining };
}

function mapSearchStatus(
  status: number,
  remaining: string | null,
  message?: string,
): GithubResult<never> | null {
  if (status < 400) return null;
  if (status === 401) return fail("GitHub rejected the access token.", "unauthorized");
  if (status === 403 && remaining === "0") {
    return fail(
      "GitHub search rate limit reached. Wait about a minute, then try again.",
      "rate_limit",
    );
  }
  if (status === 403) {
    return fail(
      message ||
        "GitHub blocked code search for this token. Classic `repo` scope (or fine-grained Contents: Read) is required.",
      "unauthorized",
    );
  }
  if (status === 422) {
    return fail(message || "GitHub rejected that search query.", "invalid");
  }
  return fail(message || `GitHub error ${status}`, "network");
}

export async function searchCodeReposOnGithub(input: {
  query: string;
  token: string;
  signal?: AbortSignal;
}): Promise<GithubResult<CodeSearchSuccess>> {
  const query = input.query.trim();
  if (!query) return fail("Enter a search query.", "invalid");
  const token = input.token.trim();
  if (!token) {
    return fail("Add a GitHub token in Settings to search code.", "unauthorized");
  }

  const userRes = await gh<{ login?: string; message?: string }>(
    "/user",
    token,
    input.signal,
  );
  const userErr = mapSearchStatus(
    userRes.status,
    userRes.remaining,
    userRes.json.message,
  );
  if (userErr) return userErr;
  const login = userRes.json.login?.trim() || null;

  const orgRes = await gh<{ login?: string }[]>(
    "/user/orgs?per_page=100",
    token,
    input.signal,
  );
  const orgs =
    orgRes.status < 400
      ? (orgRes.json ?? []).map((row) => row.login?.trim() || "").filter(Boolean)
      : [];

  const queries = scopedCodeSearchQueries(query, login, orgs);
  const seen = new Set<string>();
  const repos: string[] = [];
  let total = 0;
  let truncated = false;

  for (const q of queries) {
    for (let page = 1; page <= CODE_SEARCH_MAX_PAGES; page += 1) {
      const path = `/search/code?q=${encodeURIComponent(q)}&per_page=${CODE_SEARCH_PAGE_SIZE}&page=${page}`;
      let res: { status: number; json: SearchJson; remaining: string | null };
      try {
        res = await gh<SearchJson>(path, token, input.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error talking to GitHub.";
        return fail(message, "network");
      }
      const mapped = mapSearchStatus(res.status, res.remaining, res.json.message);
      if (mapped) return mapped;

      total += res.json.total_count ?? 0;
      if (res.json.incomplete_results) truncated = true;
      for (const name of reposFromCodeSearchItems(res.json.items ?? [])) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        repos.push(name);
      }
      const count = res.json.items?.length ?? 0;
      if (count < CODE_SEARCH_PAGE_SIZE) break;
      if (page * CODE_SEARCH_PAGE_SIZE < (res.json.total_count ?? 0)) truncated = true;
    }
  }

  return { ok: true, data: { repos, truncated, total } };
}
