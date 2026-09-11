import { githubRequest } from "./client.ts";
import { isSafeRepoPath } from "./branch.ts";
import type { GithubResult } from "./types.ts";
import type { FileChange } from "./write.ts";

type GitRef = { object?: { sha?: string }; message?: string };
type GitCommit = { sha?: string; tree?: { sha?: string }; message?: string };
type GitBlob = { sha?: string; message?: string };
type GitTree = { sha?: string; message?: string };

function fail(error: string): GithubResult<never> {
  return { ok: false, error, code: "network" };
}

async function resolveSha(
  owner: string,
  repo: string,
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const res = await githubRequest<GitRef>(
    "GET",
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(ref)}`,
    token,
    undefined,
    signal,
  );
  return res.status < 400 ? res.json.object?.sha ?? null : null;
}

async function waitForSha(
  owner: string,
  repo: string,
  token: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sha = await resolveSha(owner, repo, token, ref, signal);
    if (sha) return sha;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export type SeedResult = {
  commitSha: string;
  branch: string;
  files: string[];
};

/** Write files onto a branch of a repo we just created. May update the default branch. */
export async function seedRepoFiles(input: {
  owner: string;
  repo: string;
  token: string;
  branch: string;
  message: string;
  files: FileChange[];
  signal?: AbortSignal;
}): Promise<GithubResult<SeedResult>> {
  const token = input.token.trim();
  if (!token) return fail("A GitHub token with contents:write is required.");
  const files = input.files.filter(
    (file) => isSafeRepoPath(file.path) && file.content.length > 0,
  );
  if (files.length === 0) return fail("No safe files to seed.");

  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const branch = input.branch.trim() || "main";

  try {
    const blobs = [];
    for (const file of files) {
      const blobRes = await githubRequest<GitBlob>(
        "POST",
        `/repos/${owner}/${repo}/git/blobs`,
        token,
        { content: file.content, encoding: "utf-8" },
        input.signal,
      );
      const sha = blobRes.json.sha;
      if (blobRes.status >= 400 || !sha) {
        return fail(blobRes.json.message || `Could not write blob for ${file.path}.`);
      }
      blobs.push({
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha,
      });
    }

    const parentSha = await waitForSha(owner, repo, token, branch, input.signal);
    let baseTree: string | undefined;
    if (parentSha) {
      const commitRes = await githubRequest<GitCommit>(
        "GET",
        `/repos/${owner}/${repo}/git/commits/${parentSha}`,
        token,
        undefined,
        input.signal,
      );
      baseTree = commitRes.json.tree?.sha;
      if (commitRes.status >= 400 || !baseTree) {
        return fail(commitRes.json.message || "Could not read the seed commit tree.");
      }
    }

    const treeRes = await githubRequest<GitTree>(
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      token,
      baseTree ? { base_tree: baseTree, tree: blobs } : { tree: blobs },
      input.signal,
    );
    const treeSha = treeRes.json.sha;
    if (treeRes.status >= 400 || !treeSha) {
      return fail(treeRes.json.message || "Could not create the seed tree.");
    }

    const newCommit = await githubRequest<GitCommit>(
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      token,
      {
        message: input.message,
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
      },
      input.signal,
    );
    const commitSha = newCommit.json.sha;
    if (newCommit.status >= 400 || !commitSha) {
      return fail(newCommit.json.message || "Could not create the seed commit.");
    }

    if (parentSha) {
      const patchRef = await githubRequest<GitRef>(
        "PATCH",
        `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        token,
        { sha: commitSha },
        input.signal,
      );
      if (patchRef.status >= 400) {
        return fail(patchRef.json.message || "Could not update the default branch.");
      }
    } else {
      const refCreate = await githubRequest<GitRef>(
        "POST",
        `/repos/${owner}/${repo}/git/refs`,
        token,
        { ref: `refs/heads/${branch}`, sha: commitSha },
        input.signal,
      );
      if (refCreate.status >= 400) {
        return fail(
          refCreate.json.message ||
            "Could not create the default branch. Check that the token can write contents.",
        );
      }
    }

    return {
      ok: true,
      data: {
        commitSha,
        branch,
        files: files.map((file) => file.path),
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return fail(err instanceof Error ? err.message : "Could not seed the repository.");
  }
}
