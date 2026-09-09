import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyPlaybook,
  pathMatchesAny,
  playbookHasOverrides,
  resolvePlaybook,
} from "./playbook.ts";

test("pathMatchesAny handles prefix and glob", () => {
  assert.equal(pathMatchesAny("src/lib/auth/server.ts", ["src/lib/auth"]), true);
  assert.equal(pathMatchesAny("src/lib/auth/server.ts", ["src/lib/auth/**"]), true);
  assert.equal(pathMatchesAny("src/lib/github/write.ts", ["src/lib/auth/**"]), false);
  assert.equal(pathMatchesAny("README.md", ["*.md"]), true);
});

test("playbookHasOverrides is false for an empty playbook", () => {
  assert.equal(playbookHasOverrides(emptyPlaybook()), false);
  assert.equal(playbookHasOverrides(undefined), false);
});

test("resolvePlaybook prefers a per-repo playbook with any field set", () => {
  const campaign = {
    lens: "security" as const,
    include: ["**/*warbot*"],
    ignore: ["dist/**"],
  };
  assert.deepEqual(resolvePlaybook(emptyPlaybook(), campaign), campaign);
  const perRepo = { lens: "quality" as const, include: [], ignore: [] };
  assert.equal(resolvePlaybook(perRepo, campaign).lens, "quality");
});
