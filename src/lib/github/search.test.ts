import assert from "node:assert/strict";
import { test } from "node:test";
import {
  queryHasSearchQualifier,
  reposFromCodeSearchItems,
  scopedCodeSearchQueries,
} from "./search.ts";

test("reposFromCodeSearchItems dedupes by full name", () => {
  const repos = reposFromCodeSearchItems([
    {
      path: "src/warbot.ts",
      repository: { full_name: "acme/bot", owner: { login: "acme" }, name: "bot" },
    },
    {
      path: "README.md",
      repository: { full_name: "acme/bot", owner: { login: "acme" }, name: "bot" },
    },
    {
      path: "pkg/warbot.go",
      repository: { owner: { login: "acme" }, name: "core" },
    },
    { repository: {} },
  ]);
  assert.deepEqual(repos, ["acme/bot", "acme/core"]);
});

test("scopedCodeSearchQueries pins user and orgs unless the query is already qualified", () => {
  assert.equal(queryHasSearchQualifier("warbot org:acme"), true);
  assert.deepEqual(scopedCodeSearchQueries("warbot org:acme", "me", ["acme"]), [
    "warbot org:acme",
  ]);
  assert.deepEqual(scopedCodeSearchQueries("warbot", "me", ["Acme", "me", "labs"]), [
    "warbot user:me",
    "warbot org:Acme",
    "warbot org:labs",
  ]);
});
