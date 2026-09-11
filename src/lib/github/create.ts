import { githubRequest } from "./client.ts";
import type { GithubErrorCode, GithubResult } from "./types.ts";

export type RepoOwnerOption = {
  login: string;
  kind: "user" | "org";
};

export type CreatedRepo = {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  defaultBranch: string;
};

type GhUser = { login?: string; message?: string };
type GhOrg = { login?: string };
type GhCreated = {
  name?: string;
  full_name?: string;
  html_url?: string;
  private?: boolean;
  default_branch?: string;
  owner?: { login?: string };
  message?: string;
  errors?: { message?: string }[];
};

function fail(error: string, code: GithubErrorCode): GithubResult<never> {
  return { ok: false, error, code };
}

export function slugifyRepoName(input: string): string {
  const trimmed = input.trim();
  const leaf = trimmed.includes("/")
    ? (trimmed.split("/").pop() ?? trimmed)
    : trimmed;
  return leaf
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
}

export function parseOwnerRepoName(input: string): {
  owner: string | null;
  name: string;
} {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, "");
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (match) {
    return { owner: match[1], name: slugifyRepoName(match[2]) };
  }
  return { owner: null, name: slugifyRepoName(trimmed) };
}

export function isValidRepoName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (/\.git$/i.test(name)) return false;
  return /^[A-Za-z0-9._-]+$/.test(name) && name.length <= 100;
}

function mapCreateFailure(
  status: number,
  remaining: string | null,
  json: GhCreated,
): GithubResult<never> {
  const detail =
    json.errors?.map((item) => item.message).filter(Boolean).join(" ") ||
    json.message;
  if (status === 401) {
    return fail("GitHub rejected the access token.", "unauthorized");
  }
  if (status === 403 && remaining === "0") {
    return fail(
      "GitHub rate limit reached. Wait, then try creating the repository again.",
      "rate_limit",
    );
  }
  if (status === 403) {
    return fail(
      detail ||
        "This token cannot create repositories. A classic token with the repo scope can. Fine-grained tokens often cannot create new repos.",
      "unauthorized",
    );
  }
  if (status === 404) {
    return fail(
      detail ||
        "Could not create that repository. Check the owner name and that the token can create repos there.",
      "not_found",
    );
  }
  if (status === 422) {
    return fail(
      detail || "GitHub rejected that repository name. It may already exist.",
      "invalid",
    );
  }
  return fail(detail || `GitHub error ${status}`, "network");
}

export async function listRepoOwners(input: {
  token: string;
  signal?: AbortSignal;
}): Promise<GithubResult<RepoOwnerOption[]>> {
  const token = input.token.trim();
  if (!token) {
    return fail(
      "Add a GitHub token in Settings to create repositories.",
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
    if (userRes.status >= 400 || !userRes.json.login) {
      if (userRes.status === 401) {
        return fail("GitHub rejected the access token.", "unauthorized");
      }
      return fail(
        userRes.json.message || "Could not read the GitHub user for this token.",
        "network",
      );
    }
    const owners: RepoOwnerOption[] = [
      { login: userRes.json.login, kind: "user" },
    ];
    const orgsRes = await githubRequest<GhOrg[] | { message?: string }>(
      "GET",
      "/user/orgs?per_page=100",
      token,
      undefined,
      input.signal,
    );
    if (orgsRes.status < 400 && Array.isArray(orgsRes.json)) {
      for (const org of orgsRes.json) {
        const login = org.login?.trim();
        if (login) owners.push({ login, kind: "org" });
      }
    }
    return { ok: true, data: owners };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(
      err instanceof Error ? err.message : "Could not list GitHub owners.",
      "network",
    );
  }
}

export async function createGithubRepo(input: {
  token: string;
  name: string;
  owner?: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
  signal?: AbortSignal;
}): Promise<GithubResult<CreatedRepo>> {
  const token = input.token.trim();
  if (!token) {
    return fail(
      "Add a GitHub token in Settings to create repositories.",
      "unauthorized",
    );
  }
  const name = slugifyRepoName(input.name);
  if (!isValidRepoName(name)) {
    return fail(
      "Use a repository name with letters, numbers, dots, underscores, or hyphens.",
      "invalid",
    );
  }

  const body = {
    name,
    description: input.description?.trim() || undefined,
    private: input.private !== false,
    auto_init: input.autoInit !== false,
  };

  try {
    const me = await githubRequest<GhUser>(
      "GET",
      "/user",
      token,
      undefined,
      input.signal,
    );
    if (me.status === 401) {
      return fail("GitHub rejected the access token.", "unauthorized");
    }
    const login = me.json.login?.trim() || "";
    const ownerLogin = input.owner?.trim() || login;
    const isUser =
      !ownerLogin || ownerLogin.toLowerCase() === login.toLowerCase();
    const path = isUser
      ? "/user/repos"
      : `/orgs/${encodeURIComponent(ownerLogin)}/repos`;

    const res = await githubRequest<GhCreated>(
      "POST",
      path,
      token,
      body,
      input.signal,
    );
    if (res.status >= 400) {
      return mapCreateFailure(res.status, res.remaining, res.json);
    }
    const owner = res.json.owner?.login?.trim() || ownerLogin || login;
    const repo = res.json.name?.trim() || name;
    if (!owner || !repo) {
      return fail("GitHub created a repository but returned no name.", "network");
    }
    return {
      ok: true,
      data: {
        owner,
        repo,
        fullName: res.json.full_name?.trim() || `${owner}/${repo}`,
        htmlUrl: res.json.html_url || `https://github.com/${owner}/${repo}`,
        private: Boolean(res.json.private),
        defaultBranch: res.json.default_branch?.trim() || "main",
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(
      err instanceof Error ? err.message : "Could not create the repository.",
      "network",
    );
  }
}
