import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LM_STUDIO_URL,
  isAllowedLmStudioUrl,
  resolveLmStudioBaseUrl,
  toNativeLmStudioUrl,
  toOpenAiBaseUrl,
  pickReviewModel,
} from "./lmstudio-url.ts";

test("toOpenAiBaseUrl adds /v1 and rewrites /api/v1", () => {
  assert.equal(toOpenAiBaseUrl("http://100.66.236.13:1234"), "http://100.66.236.13:1234/v1");
  assert.equal(toOpenAiBaseUrl("http://100.66.236.13:1234/v1/"), "http://100.66.236.13:1234/v1");
  assert.equal(
    toOpenAiBaseUrl("http://100.66.236.13:1234/api/v1"),
    "http://100.66.236.13:1234/v1",
  );
});

test("toNativeLmStudioUrl strips /v1", () => {
  assert.equal(toNativeLmStudioUrl("http://100.66.236.13:1234/v1"), "http://100.66.236.13:1234");
  assert.equal(toNativeLmStudioUrl("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
});

test("pickReviewModel uses loaded coder over a stale settings id", () => {
  assert.equal(
    pickReviewModel(
      ["qwen2.5-coder-7b-instruct", "text-embedding-nomic-embed-text-v1.5"],
      ["google/gemma-4-e4b", "qwen2.5-coder-7b-instruct"],
      "google/gemma-4-e4b",
    ),
    "qwen2.5-coder-7b-instruct",
  );
  assert.equal(
    pickReviewModel(["qwen/qwen3.5-9b"], ["qwen2.5-coder-7b-instruct"], ""),
    "qwen/qwen3.5-9b",
  );
});

test("allows loopback, LAN, and Tailscale, rejects public and file URLs", () => {
  assert.equal(isAllowedLmStudioUrl("http://127.0.0.1:1234/v1"), true);
  assert.equal(isAllowedLmStudioUrl("http://localhost:1234/v1"), true);
  assert.equal(isAllowedLmStudioUrl("http://192.168.1.10:1234/v1"), true);
  assert.equal(isAllowedLmStudioUrl("http://100.66.236.13:1234"), true);
  assert.equal(isAllowedLmStudioUrl("http://machine.ts.net:1234/v1"), true);
  assert.equal(isAllowedLmStudioUrl("http://8.8.8.8:1234/v1"), false);
  assert.equal(isAllowedLmStudioUrl("file:///etc/passwd"), false);
});

test("resolveLmStudioBaseUrl prefers env, then allowed settings, then default", () => {
  assert.equal(
    resolveLmStudioBaseUrl("http://127.0.0.1:9999/v1", "http://100.66.236.13:1234"),
    "http://100.66.236.13:1234/v1",
  );
  assert.equal(
    resolveLmStudioBaseUrl("http://100.66.236.13:1234", undefined),
    "http://100.66.236.13:1234/v1",
  );
  assert.equal(
    resolveLmStudioBaseUrl("http://8.8.8.8:1234/v1", undefined),
    DEFAULT_LM_STUDIO_URL,
  );
});
