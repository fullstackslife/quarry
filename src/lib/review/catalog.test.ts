import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessibleRepo } from "../github/repos.ts";
import { catalogSessionLabel, planCatalogRepos } from "./catalog.ts";

function repo(
  fullName: string,
  extra: Partial<AccessibleRepo> = {},
): AccessibleRepo {
  const [owner, name] = fullName.split("/");
  return {
    owner: owner!,
    repo: name!,
    fullName,
    private: false,
    description: null,
    language: "TypeScript",
    pushedAt: "2026-09-01T00:00:00Z",
    htmlUrl: `https://github.com/${fullName}`,
    fork: false,
    archived: false,
    ...extra,
  };
}

test("planCatalogRepos skips archived and forks by default", () => {
  const names = planCatalogRepos([
    repo("acme/live", { pushedAt: "2026-09-10T00:00:00Z" }),
    repo("acme/old", { archived: true }),
    repo("acme/forked", { fork: true }),
  ]);
  assert.deepEqual(names, ["acme/live"]);
});

test("planCatalogRepos can include forks and skip already-reviewed trees", () => {
  const names = planCatalogRepos(
    [
      repo("acme/fresh", { pushedAt: "2026-09-10T00:00:00Z" }),
      repo("acme/stale", { pushedAt: "2026-08-01T00:00:00Z" }),
      repo("acme/forked", { fork: true, pushedAt: "2026-09-11T00:00:00Z" }),
    ],
    {
      skipForks: false,
      skipReviewedSincePush: true,
      lastReviewedAt: {
        "acme/stale": Date.parse("2026-08-15T00:00:00Z"),
      },
    },
  );
  assert.deepEqual(names, ["acme/forked", "acme/fresh"]);
});

test("catalogSessionLabel treats 0 as the full catalog", () => {
  assert.equal(catalogSessionLabel(0, 244), "all 244");
  assert.equal(catalogSessionLabel(12, 244), "12 of 244");
});
