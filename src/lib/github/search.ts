import type { GithubErrorCode, GithubResult } from "./types.ts";

export const CODE_SEARCH_PAGE_SIZE = 50;
export const CODE_SEARCH_MAX_PAGES = 1;
export const CODE_SEARCH_MAX_ORGS = 8;

export type CodeSearchHit = {
  name?: string;
  path?: string;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
  };
};

export function reposFromCodeSearchItems(items: CodeSearchHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const owner = item.repository?.owner?.login?.trim() || "";
    const name = item.repository?.name?.trim() || "";
    const full = item.repository?.full_name?.trim() || (owner && name ? `${owner}/${name}` : "");
    const key = full.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

export function queryHasSearchQualifier(query: string): boolean {
  return /\b(user|org|orgs|repo):/i.test(query);
}

export function scopedCodeSearchQueries(
  query: string,
  login: string | null,
  orgs: string[],
): string[] {
  const q = query.trim();
  if (!q) return [];
  if (queryHasSearchQualifier(q) || !login) return [q];
  const loginKey = login.toLowerCase();
  const uniqueOrgs = [...new Set(orgs.map((item) => item.trim()).filter(Boolean))]
    .filter((org) => org.toLowerCase() !== loginKey)
    .slice(0, CODE_SEARCH_MAX_ORGS);
  return [`${q} user:${login}`, ...uniqueOrgs.map((org) => `${q} org:${org}`)];
}

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

export type CodeSearchSuccess = {
  repos: string[];
  truncated: boolean;
  total: number;
};

export async function searchCodeRepos(input: {
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

  try {
    const res = await fetch("/api/github-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, token }),
      signal: input.signal,
    });
    const json = (await res.json()) as {
      error?: string;
      repos?: string[];
      truncated?: boolean;
      total?: number;
    };
    if (!res.ok) {
      const code: GithubErrorCode =
        res.status === 401
          ? "unauthorized"
          : res.status === 403
            ? "rate_limit"
            : res.status === 422
              ? "invalid"
              : "network";
      return fail(json.error || `GitHub search failed (${res.status}).`, code);
    }
    return {
      ok: true,
      data: {
        repos: Array.isArray(json.repos) ? json.repos : [],
        truncated: Boolean(json.truncated),
        total: Number(json.total) || 0,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("abort")) {
      return fail("Code search was cancelled.", "network");
    }
    if (message.toLowerCase().includes("failed to fetch")) {
      return fail(
        "Could not reach Quarry’s search proxy. Leave the app running and try again.",
        "network",
      );
    }
    return fail(message || "Code search failed.", "network");
  }
}
