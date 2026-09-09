import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertWritableFixBranch,
  isProtectedBaseBranch,
  isSafeRepoPath,
  makeFixBranchName,
} from "./branch.ts";

test("makeFixBranchName always uses the quarry/ prefix", () => {
  assert.equal(makeFixBranchName(new Date("2026-09-09T13:38:00.000Z")).startsWith("quarry/fix-"), true);
});

test("refuses default and main-like branch names", () => {
  assert.equal(isProtectedBaseBranch("main", "develop"), true);
  assert.equal(isProtectedBaseBranch("develop", "develop"), true);
  assert.equal(isProtectedBaseBranch("quarry/fix-1", "main"), false);
  assert.throws(() => assertWritableFixBranch("main", "main"), /default branch/);
  assert.throws(() => assertWritableFixBranch("feature/x", "main"), /quarry\/\*/);
  assert.equal(assertWritableFixBranch("quarry/fix-1", "main"), "quarry/fix-1");
});

test("rejects path traversal in repo files", () => {
  assert.equal(isSafeRepoPath("src/lib/foo.ts"), true);
  assert.equal(isSafeRepoPath("../secrets"), false);
  assert.equal(isSafeRepoPath(".git/config"), false);
  assert.equal(isSafeRepoPath("/etc/passwd"), false);
  assert.equal(isSafeRepoPath(".env"), false);
  assert.equal(isSafeRepoPath(".env.local"), false);
});
