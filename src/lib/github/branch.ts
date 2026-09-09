export const QUARRY_BRANCH_PREFIX = "quarry/";

const DEFAULT_NAMES = new Set(["main", "master", "trunk", "production", "prod"]);

export function makeFixBranchName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${QUARRY_BRANCH_PREFIX}fix-${stamp}`;
}

export function isProtectedBaseBranch(branch: string, defaultBranch: string): boolean {
  const name = branch.trim().replace(/^refs\/heads\//, "").toLowerCase();
  const def = defaultBranch.trim().replace(/^refs\/heads\//, "").toLowerCase();
  return name === def || DEFAULT_NAMES.has(name);
}

/** Only quarry/* branches, never the repo default or other protected names. */
export function assertWritableFixBranch(
  branch: string,
  defaultBranch: string,
): string {
  const name = branch.trim().replace(/^refs\/heads\//, "");
  if (isProtectedBaseBranch(name, defaultBranch)) {
    throw new Error("Refusing to write to the default branch.");
  }
  if (!name.startsWith(QUARRY_BRANCH_PREFIX)) {
    throw new Error("Fixes must land on a quarry/* branch.");
  }
  if (name.includes("..") || name.includes("\\") || name.includes(" ")) {
    throw new Error("Invalid branch name.");
  }
  return name;
}

export function isSafeRepoPath(path: string): boolean {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..")) return false;
  if (trimmed === ".git" || trimmed.startsWith(".git/")) return false;
  if (/(^|\/)\.env($|\.|\/)/i.test(trimmed)) return false;
  return true;
}
