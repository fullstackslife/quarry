import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressIssueComment,
  findingIssueTitle,
  formatFindingIssue,
  resolveIssueComment,
} from "./issues.ts";
import type { Finding } from "../review/types.ts";

const finding: Finding = {
  id: "token-leak",
  severity: "high",
  category: "security",
  title: "Token written to logs",
  detail: "The auth handler prints the bearer token.",
  file: "src/lib/auth/server.ts",
  evidence: "console.log(token)",
};

test("findingIssueTitle prefixes quarry and severity", () => {
  assert.match(findingIssueTitle(finding), /^\[quarry\] high:/);
  assert.match(findingIssueTitle(finding), /Token written to logs/);
});

test("formatFindingIssue cites file and evidence", () => {
  const spec = formatFindingIssue(finding);
  assert.match(spec.body, /src\/lib\/auth\/server\.ts/);
  assert.match(spec.body, /console\.log\(token\)/);
  assert.match(spec.body, /Opened from a Quarry review/);
});

test("address and resolve comments are distinct", () => {
  assert.match(addressIssueComment("PR incoming"), /addressing/);
  assert.match(addressIssueComment("PR incoming"), /PR incoming/);
  assert.match(resolveIssueComment(), /Closed by Quarry/);
  assert.match(resolveIssueComment("Shipped in #12"), /Shipped in #12/);
});
