import assert from "node:assert/strict";
import { test } from "node:test";
import { groupCampaigns } from "./campaigns.ts";
import type { ReviewRecord, StructuredReview } from "./types.ts";

function record(
  owner: string,
  repo: string,
  title: string,
): ReviewRecord {
  const result: StructuredReview = {
    kind: "structured",
    headline: "x",
    summary: "x",
    score: 70,
    verdict: "mixed",
    stack: [],
    findings: [
      {
        id: "a",
        severity: "high",
        category: "security",
        title,
        detail: "d",
        file: "src/a.ts",
        evidence: null,
      },
    ],
    strengths: [],
    questions: [],
  };
  return {
    id: `${owner}/${repo}`,
    savedAt: 1,
    owner,
    repo,
    description: null,
    stars: 0,
    language: "TypeScript",
    lens: "security",
    providerLabel: "test",
    result,
  };
}

test("groupCampaigns clusters the same finding title across repos", () => {
  const groups = groupCampaigns([
    record("acme", "one", "Token in localStorage"),
    record("acme", "two", "Token in localStorage"),
    record("acme", "one", "Token in localStorage"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.repos.length, 2);
  assert.equal(groups[0]?.count, 3);
});
