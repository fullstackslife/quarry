import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isValidRepoName,
  parseOwnerRepoName,
  slugifyRepoName,
} from "./create.ts";
import { buildOnboardFiles, onboardPlaybook } from "./onboard.ts";

test("slugifyRepoName lowercases and strips junk", () => {
  assert.equal(slugifyRepoName("Acme Corp Portal"), "acme-corp-portal");
  assert.equal(slugifyRepoName("  Hello_World  "), "hello_world");
  assert.equal(slugifyRepoName("fullstackslife/New Client"), "new-client");
});

test("parseOwnerRepoName splits owner/repo", () => {
  assert.deepEqual(parseOwnerRepoName("acme/portal"), {
    owner: "acme",
    name: "portal",
  });
  assert.equal(parseOwnerRepoName("just-a-name").owner, null);
  assert.equal(parseOwnerRepoName("https://github.com/acme/site").owner, "acme");
});

test("isValidRepoName rejects empty and .git suffix", () => {
  assert.equal(isValidRepoName("ok-repo"), true);
  assert.equal(isValidRepoName(""), false);
  assert.equal(isValidRepoName(".."), false);
  assert.equal(isValidRepoName("foo.git"), false);
});

test("buildOnboardFiles writes a brief, playbook, and intake template", () => {
  const files = buildOnboardFiles({
    kind: "client",
    title: "Northwind",
    fullName: "acme/northwind",
    brief: "Rebuild the ordering desk.",
  });
  const paths = files.map((file) => file.path);
  assert.deepEqual(paths.sort(), [
    ".github/ISSUE_TEMPLATE/intake.md",
    ".quarry/playbook.json",
    "CONTRIBUTING.md",
    "README.md",
    "docs/brief.md",
  ]);
  const readme = files.find((file) => file.path === "README.md")?.content ?? "";
  assert.match(readme, /Northwind/);
  assert.match(readme, /Client engagement/);
  assert.match(readme, /Rebuild the ordering desk/);
  const playbookFile = files.find((file) => file.path === ".quarry/playbook.json");
  assert.match(playbookFile?.content ?? "", /"onboarding"/);
});

test("onboardPlaybook uses the onboarding lens", () => {
  const playbook = onboardPlaybook();
  assert.equal(playbook.lens, "onboarding");
  assert.ok(playbook.include.includes("docs/**"));
});
