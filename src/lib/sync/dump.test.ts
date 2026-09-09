import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOperatorDump,
  parseOperatorDump,
  exportOperatorDumpJson,
} from "./dump.ts";
import { emptyPlaybook } from "../playbook.ts";
import type { ReviewRecord } from "../review/types.ts";

const sample: ReviewRecord = {
  id: "rev-1",
  savedAt: 1,
  owner: "acme",
  repo: "warbot",
  description: null,
  stars: 0,
  language: "TypeScript",
  lens: "full",
  providerLabel: "LM Studio",
  result: { kind: "prose", markdown: "ok" },
};

test("operator dump round-trips without settings tokens", () => {
  const dump = buildOperatorDump({
    history: [sample],
    watchlist: ["acme/warbot", "acme/warbot"],
    playbooks: { "acme/warbot": { lens: "security", include: ["src/**"], ignore: [] } },
    defaultPlaybook: emptyPlaybook(),
  });
  const parsed = parseOperatorDump(exportOperatorDumpJson(dump));
  assert.equal(parsed.history.length, 1);
  assert.deepEqual(parsed.watchlist, ["acme/warbot"]);
  assert.equal(parsed.playbooks["acme/warbot"]?.lens, "security");
  assert.ok(!JSON.stringify(parsed).includes("githubToken"));
});
