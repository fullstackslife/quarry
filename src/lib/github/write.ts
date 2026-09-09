import type { GithubResult } from "./types";
import { githubRequest } from "./client";
import { assertWritableFixBranch, isSafeRepoPath } from "./branch";
import { resolveFixWriteTarget } from "./write-target";

type GitRef = { object?: { sha?: string }; message?: string };
type GitCommit = { sha?: string; tree?: { sha?: string }; message?: string };
type GitBlob = { sha?: string; message?: string };
type GitTree = { sha?: string; message?: string };
type Pull = {
  html_url?: string;
  number?: number;
  message?: string;
  body?: string;
  errors?: { message?: string }[];
};
type PullList = { html_url?: string; number?: number; head?: { ref?: string } }[];

function fail(error: string): GithubResult<never> {
  return { ok: false, error, code: "network" };
}

export type FileChange = {
  path: string;
  content: string;
};

export type BranchPushResult = {
  branch: string;
  base: string;
  commitSha: string;
  files: string[];
  prUrl: string | null;
  prNumber: number | null;
  mode: "update" | "create";
};

async function resolveSha(
  owner: string,
  repo: string,
  token: string,
  ref: string,
): Promise<string | null> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const res = await githubRequest<GitRef>(
    "GET",
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(ref)}`,
    token,
  );
  return res.status < 400 ? res.json.object?.sha ?? null : null;
}

async function findPullForHead(
  owner: string,
  repo: string,
  ownerLogin: string,
  token: string,
  head: string,
): Promise<{ number: number; html_url: string; body: string } | null> {
  const res = await githubRequest<PullList | { message?: string }>(
    "GET",
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${ownerLogin}:${head}`)}&per_page=5`,
    token,
  );
  if (res.status >= 400 || !Array.isArray(res.json)) return null;
  const match = res.json.find((item) => item.head?.ref === head) ?? res.json[0];
  if (!match?.number) return null;
  const detail = await githubRequest<Pull>(
    "GET",
    `/repos/${owner}/${repo}/pulls/${match.number}`,
    token,
  );
  return {
    number: match.number,
    html_url: match.html_url || detail.json.html_url || "",
    body: detail.json.body ?? "",
  };
}

export async function commitFilesOnNewBranch(input: {
  owner: string;
  repo: string;
  token: string;
  defaultBranch: string;
  branch: string;
  message: string;
  files: FileChange[];
  prTitle: string;
  prBody: string;
}): Promise<GithubResult<BranchPushResult>> {
  return commitJobFixes({
    ...input,
    jobHead: input.defaultBranch,
    jobBase: input.defaultBranch,
    parentSha: null,
    branchOverride: input.branch,
  });
}

export async function commitJobFixes(input: {
  owner: string;
  repo: string;
  token: string;
  defaultBranch: string;
  jobHead: string;
  jobBase: string;
  parentSha: string | null;
  message: string;
  files: FileChange[];
  prTitle: string;
  prBody: string;
  branchOverride?: string;
}): Promise<GithubResult<BranchPushResult>> {
  const token = input.token.trim();
  if (!token) return fail("A GitHub token with contents:write is required.");

  let target;
  try {
    target = resolveFixWriteTarget({
      defaultBranch: input.defaultBranch,
      jobHead: input.jobHead,
      jobBase: input.jobBase,
    });
    if (input.branchOverride) {
      target = {
        ...target,
        branch: assertWritableFixBranch(input.branchOverride, input.defaultBranch),
        mode: "create" as const,
      };
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Invalid branch.");
  }

  const files = input.files.filter(
    (file) => isSafeRepoPath(file.path) && file.content.length > 0,
  );
  if (files.length === 0) return fail("No safe file changes to commit.");

  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const prBase = target.prBase.trim() || input.defaultBranch.trim();

  try {
    const parentSha =
      input.parentSha ||
      (await resolveSha(owner, repo, token, target.mode === "update" ? target.branch : target.parentRef)) ||
      (await resolveSha(owner, repo, token, input.defaultBranch));
    if (!parentSha) return fail("Could not resolve the parent commit.");

    const commitRes = await githubRequest<GitCommit>(
      "GET",
      `/repos/${owner}/${repo}/git/commits/${parentSha}`,
      token,
    );
    const baseTree = commitRes.json.tree?.sha;
    if (commitRes.status >= 400 || !baseTree) {
      return fail(commitRes.json.message || "Could not read the base commit tree.");
    }

    const blobs = [];
    for (const file of files) {
      const blobRes = await githubRequest<GitBlob>(
        "POST",
        `/repos/${owner}/${repo}/git/blobs`,
        token,
        { content: file.content, encoding: "utf-8" },
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

    const treeRes = await githubRequest<GitTree>(
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      token,
      { base_tree: baseTree, tree: blobs },
    );
    const treeSha = treeRes.json.sha;
    if (treeRes.status >= 400 || !treeSha) {
      return fail(treeRes.json.message || "Could not create the git tree.");
    }

    const newCommit = await githubRequest<GitCommit>(
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      token,
      {
        message: input.message,
        tree: treeSha,
        parents: [parentSha],
      },
    );
    const commitSha = newCommit.json.sha;
    if (newCommit.status >= 400 || !commitSha) {
      return fail(newCommit.json.message || "Could not create the commit.");
    }

    if (target.mode === "update") {
      const patchRef = await githubRequest<GitRef>(
        "PATCH",
        `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(target.branch)}`,
        token,
        { sha: commitSha },
      );
      if (patchRef.status >= 400) {
        return fail(patchRef.json.message || "Could not update the quarry branch.");
      }
    } else {
      const refCreate = await githubRequest<GitRef>(
        "POST",
        `/repos/${owner}/${repo}/git/refs`,
        token,
        { ref: `refs/heads/${target.branch}`, sha: commitSha },
      );
      if (refCreate.status >= 400) {
        return fail(
          refCreate.json.message ||
            "Could not create the quarry branch. Check that the token can write contents.",
        );
      }
    }

    const existing = await findPullForHead(owner, repo, input.owner, token, target.branch);
    let prUrl = existing?.html_url ?? null;
    let prNumber = existing?.number ?? null;

    if (existing) {
      const body = [existing.body.trim(), "", input.prBody].filter(Boolean).join("\n");
      await githubRequest<Pull>(
        "PATCH",
        `/repos/${owner}/${repo}/pulls/${existing.number}`,
        token,
        { body },
      );
    } else {
      const pullRes = await githubRequest<Pull>(
        "POST",
        `/repos/${owner}/${repo}/pulls`,
        token,
        {
          title: input.prTitle,
          body: input.prBody,
          head: target.branch,
          base: prBase,
        },
      );
      if (pullRes.status < 400) {
        prUrl = pullRes.json.html_url ?? null;
        prNumber = pullRes.json.number ?? null;
      }
    }

    return {
      ok: true,
      data: {
        branch: target.branch,
        base: prBase,
        commitSha,
        files: files.map((file) => file.path),
        prUrl,
        prNumber,
        mode: target.mode,
      },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "GitHub write failed.");
  }
}
