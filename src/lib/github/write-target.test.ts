import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFixWriteTarget } from "./write-target.ts";

test("nested fix branch when reviewing default or a feature branch", () => {
  const target = resolveFixWriteTarget({
    defaultBranch: "main",
    jobHead: "main",
    jobBase: "main",
    now: new Date("2026-09-09T13:38:00.000Z"),
  });
  assert.equal(target.mode, "create");
  assert.equal(target.branch.startsWith("quarry/fix-"), true);
  assert.equal(target.prBase, "main");
});

test("updates the same quarry/* head instead of opening a second branch", () => {
  const target = resolveFixWriteTarget({
    defaultBranch: "main",
    jobHead: "quarry/fix-existing",
    jobBase: "main",
  });
  assert.equal(target.mode, "update");
  assert.equal(target.branch, "quarry/fix-existing");
  assert.equal(target.prBase, "main");
});

test("nested PR targets the reviewed pull request base", () => {
  const target = resolveFixWriteTarget({
    defaultBranch: "main",
    jobHead: "feat/login",
    jobBase: "develop",
    now: new Date("2026-09-09T13:38:00.000Z"),
  });
  assert.equal(target.mode, "create");
  assert.equal(target.prBase, "develop");
  assert.equal(target.parentRef, "feat/login");
});
