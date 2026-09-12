import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATCH_MAX_FILES,
  clampLmStudioConcurrency,
  createSlotLimiter,
  LM_STUDIO_DEFAULT_CONCURRENCY,
  LM_STUDIO_MAX_CONCURRENCY,
  mergeReviewResults,
  queueReviewBatches,
  runConcurrentIndexes,
} from "./queue.ts";
import type { StructuredReview } from "./types.ts";

test("queueReviewBatches packs by file count", () => {
  const paths = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
  const contents = Object.fromEntries(paths.map((path) => [path, "x".repeat(200)]));
  const batches = queueReviewBatches(paths, contents);
  assert.equal(batches.length, 3);
  assert.equal(batches[0]?.length, BATCH_MAX_FILES);
  assert.equal(batches.flat().length, 14);
});

test("queueReviewBatches splits when char budget is hit", () => {
  const paths = ["a.ts", "b.ts", "c.ts"];
  const contents = {
    "a.ts": "a".repeat(8_000),
    "b.ts": "b".repeat(8_000),
    "c.ts": "c".repeat(8_000),
  };
  const batches = queueReviewBatches(paths, contents);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], ["a.ts", "b.ts"]);
  assert.deepEqual(batches[1], ["c.ts"]);
});

test("mergeReviewResults keeps the higher severity duplicate", () => {
  const a: StructuredReview = {
    kind: "structured",
    headline: "A",
    summary: "First batch",
    score: 80,
    verdict: "solid",
    stack: ["ts"],
    findings: [
      {
        id: "token",
        severity: "medium",
        category: "security",
        title: "Token in localStorage",
        detail: "x",
        file: "src/lib/settings.ts",
        evidence: null,
      },
    ],
    strengths: ["typed"],
    questions: [],
  };
  const b: StructuredReview = {
    kind: "structured",
    headline: "B",
    summary: "Second batch",
    score: 40,
    verdict: "shaky",
    stack: ["ts", "vite"],
    findings: [
      {
        id: "token-2",
        severity: "high",
        category: "security",
        title: "Token in localStorage",
        detail: "worse",
        file: "src/lib/settings.ts",
        evidence: null,
      },
    ],
    strengths: ["typed"],
    questions: ["SSO?"],
  };
  const merged = mergeReviewResults([a, b]);
  assert.equal(merged.kind, "structured");
  if (merged.kind !== "structured") return;
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0]?.severity, "high");
  assert.equal(merged.stack.includes("vite"), true);
  assert.equal(merged.questions.length, 1);
});

test("clampLmStudioConcurrency never exceeds the GPU cap", () => {
  assert.equal(clampLmStudioConcurrency(undefined), LM_STUDIO_DEFAULT_CONCURRENCY);
  assert.equal(clampLmStudioConcurrency(1), 1);
  assert.equal(clampLmStudioConcurrency(2), 2);
  assert.equal(clampLmStudioConcurrency(8), LM_STUDIO_MAX_CONCURRENCY);
  assert.equal(clampLmStudioConcurrency(0), 1);
  assert.equal(clampLmStudioConcurrency(-3), 1);
});

test("createSlotLimiter never exceeds the cap", async () => {
  const limiter = createSlotLimiter(4);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      await limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      });
    }),
  );
  assert.equal(peak <= LM_STUDIO_MAX_CONCURRENCY, true);
  assert.equal(peak, 4);
});

test("runConcurrentIndexes runs every index", async () => {
  const seen: number[] = [];
  await runConcurrentIndexes({
    indexes: [0, 1, 2, 3],
    concurrency: 2,
    signal: new AbortController().signal,
    worker: async (index) => {
      seen.push(index);
    },
  });
  assert.deepEqual(seen.sort((a, b) => a - b), [0, 1, 2, 3]);
});
