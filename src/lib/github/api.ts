import { parseRepoInput } from "./parse";
import { listReviewableFiles, pickSmartFiles } from "./select";
import { githubRequest } from "./client";
import type {
  FileEntry,
  GithubResult,
  RepoBundle,
  RepoMeta,
} from "./types";
import type { ReviewLens } from "@/lib/review/types";
import type { Playbook } from "@/lib/playbook";

type GhResponse<T> = {
  status: number;
  json: T;
  remaining: string | null;
};

async function gh<T>(
  path: string,
  token: string | undefined,
): Promise<GhResponse<T>> {
  return githubRequest<T>("GET", path, token);
}

function fail(
  error: string,
  code: "invalid" | "not_found" | "rate_limit" | "unauthorized" | "network",
): GithubResult<never> {
  return { ok: false, error, code };
}

function mapStatus(
  status: number,
  remaining: string | null,
  message?: string,
  token?: string,
) {
  if (status === 404) {
    return fail(
      token
        ? "Repository not found, or this token cannot access it."
        : "Repository not found. Private repos need a GitHub token in Settings.",
      "not_found",
    );
  }
  if (status === 401) {
    return fail("GitHub rejected the access token.", "unauthorized");
  }
  if (status === 403 && remaining === "0") {
    return fail(
      "GitHub rate limit reached. Add a read-only personal access token in Settings.",
      "rate_limit",
    );
  }
  if (status === 403) {
    return fail(
      message || "GitHub refused the request. A token in Settings usually fixes this.",
      "rate_limit",
    );
  }
  return fail(message || `GitHub error ${status}`, "network");
}

function isGithubDownloadHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "github.com" ||
      host.endsWith(".github.com") ||
      host === "raw.githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}
function decodeBase64(content: string): string {
  const cleaned = content.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

type GhRepo = {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id: string | null } | null;
  default_branch: string;
  pushed_at: string | null;
  homepage: string | null;
  html_url: string;
  topics?: string[];
  owner: { login: string; avatar_url: string };
  private: boolean;
  message?: string;
};

type GitRef = { object?: { sha?: string }; message?: string };

type GhTree = {
  truncated?: boolean;
  tree?: { path: string; type: string; sha: string; size?: number }[];
  message?: string;
};

function blobsFromTree(tree: GhTree): FileEntry[] {
  return (tree.tree ?? [])
    .filter((node) => node.type === "blob" && node.path)
    .map((node) => ({
      path: node.path,
      size: node.size ?? 0,
      sha: node.sha,
    }));
}

type GhContent = {
  path?: string;
  content?: string;
  encoding?: string;
  download_url?: string | null;
  size?: number;
  message?: string;
};

async function loadContents(
  owner: string,
  repo: string,
  paths: string[],
  token: string | undefined,
  ref?: string,
): Promise<Record<string, string>> {
    const unique = [...new Set(paths)].slice(0, 2000);
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const pairs = await mapPool(unique, 10, async (path) => {
    const encoded = path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const { status, json } = await gh<GhContent>(
      `/repos/${owner}/${repo}/contents/${encoded}${refQuery}`,
      token,
    );
    if (status >= 400) return [path, ""] as const;
    let text = "";
    if (json.encoding === "base64" && json.content) {
      text = decodeBase64(json.content);
    } else if (json.download_url) {
      const headers: Record<string, string> = {};
      if (token && isGithubDownloadHost(json.download_url)) {
        headers.Authorization = `Bearer ${token}`;
        headers.Accept = "application/vnd.github.raw";
      }
      const raw = await fetch(json.download_url, { headers });
      if (raw.ok) text = await raw.text();
    }
    if (text.length > 80_000) {
      text = `${text.slice(0, 80_000)}\n\n/* truncated after 80KB */\n`;
    }
    return [path, text] as const;
  });

  const contents: Record<string, string> = {};
  for (const [path, text] of pairs) {
    if (text) contents[path] = text;
  }
  return contents;
}

export async function openRepo(input: {
  source: string;
  token?: string;
  lens?: ReviewLens;
  maxFiles?: number;
  maxChars?: number;
  playbook?: Playbook | null;
}): Promise<GithubResult<RepoBundle>> {
  const identity = parseRepoInput(input.source);
  if (!identity) {
    return fail("Use owner/repo or a GitHub URL.", "invalid");
  }

  const token = input.token?.trim() || undefined;
  const lens = input.lens ?? "full";
  const maxFiles = Math.min(Math.max(input.maxFiles ?? 16, 4), 24);
  const maxChars = Math.min(Math.max(input.maxChars ?? 48_000, 8_000), 160_000);

  try {
    const repoRes = await gh<GhRepo>(
      `/repos/${identity.owner}/${identity.repo}`,
      token,
    );
    if (repoRes.status >= 400) {
      return mapStatus(
        repoRes.status,
        repoRes.remaining,
        repoRes.json.message,
        token,
      );
    }
    if (repoRes.json.private && !token) {
      return fail(
        "This repository is private. Add a GitHub token in Settings with access to it.",
        "unauthorized",
      );
    }

    const repo = repoRes.json;
    const meta: RepoMeta = {
      owner: repo.owner.login,
      repo: repo.name,
      description: repo.description,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      license: repo.license?.spdx_id ?? null,
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at,
      homepage: repo.homepage,
      avatarUrl: repo.owner.avatar_url,
      htmlUrl: repo.html_url,
      topics: repo.topics ?? [],
      private: Boolean(repo.private),
    };

    const [langRes, treeRes] = await Promise.all([
      gh<Record<string, number>>(
        `/repos/${meta.owner}/${meta.repo}/languages`,
        token,
      ),
      gh<GhTree>(
        `/repos/${meta.owner}/${meta.repo}/git/trees/${encodeURIComponent(meta.defaultBranch)}?recursive=1`,
        token,
      ),
    ]);

    if (treeRes.status >= 400) {
      return mapStatus(
        treeRes.status,
        treeRes.remaining,
        treeRes.json.message,
        token,
      );
    }

    const languages = langRes.status < 400 ? langRes.json : {};
    const refRes = await gh<GitRef>(
      `/repos/${meta.owner}/${meta.repo}/git/ref/heads/${encodeURIComponent(meta.defaultBranch)}`,
      token,
    );
    const headSha = refRes.json.object?.sha || meta.defaultBranch;
    const blobs = blobsFromTree(treeRes.json);

    const listed = listReviewableFiles(blobs, 2000);
    const selected = pickSmartFiles(blobs, lens, maxFiles, maxChars, {
      playbook: input.playbook,
    });
    const contents = await loadContents(meta.owner, meta.repo, selected, token, headSha);

    return {
      ok: true,
      data: {
        meta,
        languages,
        files: listed,
        selected,
        contents,
        treeTruncated: Boolean(treeRes.json.truncated),
        listedTruncated: blobs.length > listed.length,
        headSha,
        headRef: meta.defaultBranch,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error talking to GitHub.";
    return fail(message, "network");
  }
}

export async function fetchFileContents(input: {
  owner: string;
  repo: string;
  paths: string[];
  token?: string;
  ref?: string;
}): Promise<GithubResult<Record<string, string>>> {
  if (!input.owner || !input.repo || !input.paths.length) {
    return fail("Nothing to fetch.", "invalid");
  }
  try {
    const contents = await loadContents(
      input.owner,
      input.repo,
      input.paths,
      input.token?.trim() || undefined,
      input.ref,
    );
    return { ok: true, data: contents };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load files.";
    return fail(message, "network");
  }
}

export async function loadBundleAtRef(input: {
  owner: string;
  repo: string;
  token?: string;
  ref: string;
  sha: string;
  lens: ReviewLens;
  maxFiles: number;
  maxChars: number;
  extraPaths?: string[];
  playbook?: Playbook | null;
}): Promise<GithubResult<{ files: FileEntry[]; selected: string[]; contents: Record<string, string>; treeTruncated: boolean; listedTruncated: boolean }>> {
  const token = input.token?.trim() || undefined;
  try {
    const treeRes = await gh<GhTree>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(input.sha)}?recursive=1`,
      token,
    );
    if (treeRes.status >= 400) {
      return mapStatus(treeRes.status, treeRes.remaining, treeRes.json.message, token);
    }
    const blobs = blobsFromTree(treeRes.json);
    const listed = listReviewableFiles(blobs, 2000);
    const selected = pickSmartFiles(blobs, input.lens, input.maxFiles, input.maxChars, {
      extraPaths: input.extraPaths,
      playbook: input.playbook,
    });
    const contents = await loadContents(input.owner, input.repo, selected, token, input.sha);
    return {
      ok: true,
      data: {
        files: listed,
        selected,
        contents,
        treeTruncated: Boolean(treeRes.json.truncated),
        listedTruncated: blobs.length > listed.length,
      },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not load that ref.", "network");
  }
}
