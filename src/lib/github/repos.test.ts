import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterAccessibleRepos,
  mapAccessibleRepo,
  type AccessibleRepo,
} from "./repos.ts";

test("mapAccessibleRepo reads owner, privacy, and full name", () => {
  const mapped = mapAccessibleRepo({
    name: "quarry",
    full_name: "fullstackslife/quarry",
    private: true,
    description: "Local reviewer",
    language: "TypeScript",
    pushed_at: "2026-09-09T00:00:00Z",
    html_url: "https://github.com/fullstackslife/quarry",
    owner: { login: "fullstackslife" },
  });
  assert.equal(mapped?.fullName, "fullstackslife/quarry");
  assert.equal(mapped?.private, true);
  assert.equal(mapped?.owner, "fullstackslife");
});

test("mapAccessibleRepo skips incomplete rows", () => {
  assert.equal(mapAccessibleRepo({ name: "x" }), null);
  assert.equal(mapAccessibleRepo({ owner: { login: "a" } }), null);
});

test("filterAccessibleRepos matches name and hides public when asked", () => {
  const repos: AccessibleRepo[] = [
    {
      owner: "acme",
      repo: "secret",
      fullName: "acme/secret",
      private: true,
      description: "internal api",
      language: "Go",
      pushedAt: null,
      htmlUrl: "https://github.com/acme/secret",
      fork: false,
      archived: false,
    },
    {
      owner: "acme",
      repo: "website",
      fullName: "acme/website",
      private: false,
      description: "marketing",
      language: "TypeScript",
      pushedAt: null,
      htmlUrl: "https://github.com/acme/website",
      fork: false,
      archived: false,
    },
  ];
  assert.equal(filterAccessibleRepos(repos, "", "all").length, 2);
  assert.deepEqual(
    filterAccessibleRepos(repos, "", "private").map((item) => item.repo),
    ["secret"],
  );
  assert.equal(filterAccessibleRepos(repos, "internal", "all")[0]?.repo, "secret");
  assert.equal(filterAccessibleRepos(repos, "TypeScript", "all")[0]?.repo, "website");
});
