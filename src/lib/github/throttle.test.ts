import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubRetryDelayMs,
  isEmptyRepoError,
  isGithubThrottle,
  isRetryableRolloutError,
} from "./throttle.ts";

test("isGithubThrottle catches abuse and primary rate limits", () => {
  assert.equal(isGithubThrottle(429, "10", ""), true);
  assert.equal(isGithubThrottle(403, "0", "API rate limit exceeded"), true);
  assert.equal(
    isGithubThrottle(403, "40", "You have triggered an abuse detection mechanism."),
    true,
  );
  assert.equal(isGithubThrottle(404, "40", "Not Found"), false);
});

test("githubRetryDelayMs prefers Retry-After then reset epoch", () => {
  assert.equal(
    githubRetryDelayMs({
      status: 403,
      remaining: "20",
      message: "abuse detection",
      retryAfter: "8",
      reset: null,
      attempt: 1,
    }),
    8000,
  );
  const now = 1_700_000_000_000;
  assert.equal(
    githubRetryDelayMs({
      status: 403,
      remaining: "0",
      message: "rate limit",
      retryAfter: null,
      reset: String(Math.floor(now / 1000) + 12),
      attempt: 1,
      now,
    }),
    12_500,
  );
});

test("rollout error classifiers", () => {
  assert.equal(
    isRetryableRolloutError(
      "You have triggered an abuse detection mechanism. Please wait a few minutes before you try again.",
    ),
    true,
  );
  assert.equal(
    isRetryableRolloutError("GitHub rate limit reached. Add a read-only personal access token in Settings."),
    true,
  );
  assert.equal(isRetryableRolloutError("Repository not found. Private repos need a GitHub token in Settings."), false);
  assert.equal(isEmptyRepoError("Git Repository is empty."), true);
});
