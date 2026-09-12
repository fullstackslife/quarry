import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlaybook } from "../playbook.ts";
import {
  createRollout,
  claimNextPendingRepo,
  isRolloutFinished,
  markRolloutRepo,
  nextPendingRepo,
  recoverInterruptedRepos,
  requeueRetryableErrors,
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

test("isRolloutFinished stays false while a repo is running", () => {
  let job = createRollout(["a/one"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "running");
  assert.equal(isRolloutFinished(job), false);
  job = markRolloutRepo(job, "a/one", "done");
  assert.equal(isRolloutFinished(job), true);
});

test("claimNextPendingRepo marks running so workers cannot steal the same repo", () => {
  let job = createRollout(["a/one", "a/two"], "full", emptyPlaybook());
  const first = claimNextPendingRepo(job);
  assert.ok(first);
  assert.equal(first.repo, "a/one");
  const second = claimNextPendingRepo(first.job);
  assert.ok(second);
  assert.equal(second.repo, "a/two");
  assert.equal(claimNextPendingRepo(second.job), null);
});

test("recoverInterruptedRepos returns stuck running repos to pending", () => {
  let job = createRollout(["a/one", "a/two"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "running");
  job = recoverInterruptedRepos(job);
  assert.equal(nextPendingRepo(job), "a/one");
  assert.equal(job.current, null);
});

test("requeueRetryableErrors returns abuse/rate-limit failures to pending", () => {
  let job = createRollout(["a/one", "a/two", "a/three"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "error", "You have triggered an abuse detection mechanism.");
  job = markRolloutRepo(job, "a/two", "error", "Repository not found. Private repos need a GitHub token in Settings.");
  job = markRolloutRepo(job, "a/three", "done");
  job = requeueRetryableErrors(job);
  assert.equal(job.states["a/one"]?.status, "pending");
  assert.equal(job.states["a/two"]?.status, "error");
  assert.equal(job.states["a/three"]?.status, "done");
});

test("paused repo returns to pending so resume can continue", () => {
  let job = createRollout(["a/one"], "full", emptyPlaybook());
  job = markRolloutRepo(job, "a/one", "running");
  job = markRolloutRepo(job, "a/one", "pending");
  assert.equal(nextPendingRepo(job), "a/one");
  assert.equal(job.current, null);
});
