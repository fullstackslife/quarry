import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkpointId,
  completedBatchCount,
  pendingBatchIndexes,
  writeBatchResult,
  type QueueCheckpoint,
} from "./checkpoint.ts";

function job(): QueueCheckpoint {
  return {
    id: "o/r::full::a.ts|b.ts",
    updatedAt: 1,
    owner: "o",
    repo: "r",
    lens: "full",
    model: "m",
    selected: ["a.ts", "b.ts"],
    batches: [["a.ts"], ["b.ts"]],
    results: [null, null],
  };
}

test("checkpointId is stable for the same selection", () => {
  assert.equal(
    checkpointId({ owner: "o", repo: "r", lens: "full", selected: ["a", "b"] }),
    checkpointId({ owner: "o", repo: "r", lens: "full", selected: ["a", "b"] }),
  );
});

test("writeBatchResult records a slot and pending skips it", () => {
  const next = writeBatchResult(job(), 0, {
    kind: "prose",
    markdown: "done",
  });
  assert.equal(completedBatchCount(next), 1);
  assert.deepEqual(pendingBatchIndexes(next), [1]);
  assert.equal(next.results[0]?.result.kind, "prose");
});
