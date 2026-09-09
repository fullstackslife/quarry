import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFileChanges } from "./parse.ts";

test("parseFileChanges reads files array from fenced JSON", () => {
  const text = '```json\n{"files":[{"path":"src/a.ts","content":"export const a = 1;"}]}\n```';
  const files = parseFileChanges(text);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, "src/a.ts");
  assert.equal(files[0]?.content.includes("export const a"), true);
});

test("parseFileChanges drops unsafe paths", () => {
  const files = parseFileChanges(
    JSON.stringify({
      files: [
        { path: "../x.ts", content: "nope" },
        { path: "src/ok.ts", content: "ok" },
      ],
    }),
  );
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/ok.ts"],
  );
});
