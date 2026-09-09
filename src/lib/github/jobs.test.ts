import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultReviewJob, extractMentionedPaths, formatJobDigest } from "./jobs.ts";

test("extractMentionedPaths finds known files in issue text", () => {
  const known = ["src/lib/auth/server.ts", "README.md", "src/lib/github/write.ts"];
  const paths = extractMentionedPaths(
    "Fix the token leak in `src/lib/auth/server.ts` and glance at README.md",
    known,
  );
  assert.equal(paths.includes("src/lib/auth/server.ts"), true);
  assert.equal(paths.includes("README.md"), true);
});

test("defaultReviewJob uses the default branch as head and base", () => {
  const job = defaultReviewJob("main", "abc123def");
  assert.equal(job.kind, "default");
  assert.equal(job.head, "main");
  assert.equal(job.base, "main");
  assert.equal(job.sha, "abc123def");
});

test("formatJobDigest includes kind and changed paths", () => {
  const text = formatJobDigest({
    kind: "pull",
    title: "Harden writes",
    head: "quarry/fix-1",
    sha: "aaaaaaaa",
    base: "main",
    number: 4,
    body: "Do not touch main.",
    comments: ["@me: looks good"],
    comparePaths: ["src/lib/github/write.ts"],
    patches: [{ path: "src/lib/github/write.ts", patch: "+assertWritable" }],
  });
  assert.match(text, /Job: pull/);
  assert.match(text, /src\/lib\/github\/write.ts/);
});
