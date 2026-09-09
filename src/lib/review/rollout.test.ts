import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlaybook } from "../playbook.ts";
import {
  createRollout,
  isRolloutFinished,
  markRolloutRepo,
  nextPendingRepo,
  rolloutCounts,
} from "./rollout.ts";

test("createRollout dedupes repos and starts pending", () => {
  const job = createRollout(
    ["acme/bot", " acme/bot ", "acme/core"],
    "security",
    emptyPlaybook(),
  );
  assert.deepEqual(job.repos, ["acme/bot", "acme/core"]);
  assert.equal(nextPendingRepo(job), "acme/bot");
  assert.equal(isRolloutFinished(job), false);
});

test("markRolloutRepo advances cursor and counts", () => {
  let job = createRollout(["a/one", "a/two"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "running");
  assert.equal(job.current, "a/one");
  job = markRolloutRepo(job, "a/one", "done");
  assert.equal(nextPendingRepo(job), "a/two");
  job = markRolloutRepo(job, "a/two", "error", "not found");
  assert.equal(isRolloutFinished(job), true);
  assert.deepEqual(rolloutCounts(job), {
    done: 1,
    error: 1,
    pending: 0,
    skipped: 0,
    total: 2,
  });
});

test("paused repo returns to pending so resume can continue", () => {
  let job = createRollout(["a/one"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "running");
  job = markRolloutRepo(job, "a/one", "pending");
  assert.equal(nextPendingRepo(job), "a/one");
  assert.equal(job.current, null);
});
