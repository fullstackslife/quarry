import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFileTree, filterTree } from "./tree.ts";
import { grepContents, grepPaths } from "./grep.ts";
import {
  applySearchReplace,
  applyUnifiedHunk,
  generateUnifiedDiff,
  parseApplyPatch,
} from "./patch.ts";
import { acceptedChanges, upsertDraft } from "./buffer.ts";

test("buildFileTree nests directories", () => {
  const tree = buildFileTree(["src/a.ts", "src/lib/b.ts", "README.md"]);
  assert.equal(tree[0]?.name, "src");
  assert.equal(tree[0]?.kind, "dir");
  assert.equal(tree[1]?.name, "README.md");
  const lib = tree[0]?.children?.find((child) => child.name === "lib");
  assert.equal(lib?.kind, "dir");
  assert.equal(lib?.children?.[0]?.path, "src/lib/b.ts");
});

test("filterTree keeps matching files and parents", () => {
  const tree = buildFileTree(["src/a.ts", "docs/note.md"]);
  const filtered = filterTree(tree, "note");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.name, "docs");
});

test("grepContents finds lines and respects glob", () => {
  const hits = grepContents({
    contents: {
      "src/a.ts": "export const foo = 1;\nexport const bar = 2;",
      "README.md": "foo is mentioned",
    },
    pattern: "foo",
    glob: "src/**",
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.path, "src/a.ts");
  assert.equal(hits[0]?.line, 1);
});

test("grepPaths matches file names", () => {
  const hits = grepPaths({
    paths: ["src/auth.ts", "src/lib/session.ts", "README.md"],
    pattern: "auth|session",
  });
  assert.deepEqual(hits, ["src/auth.ts", "src/lib/session.ts"]);
});

test("applySearchReplace updates a unique snippet", () => {
  const res = applySearchReplace("a\nb\nc\n", "b", "B");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.next, "a\nB\nc\n");
});

test("applySearchReplace prepends when old_string is empty", () => {
  const res = applySearchReplace("export const a = 1;\n", "", "// ping");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.next.startsWith("// ping\n"), true);
});

test("applySearchReplace rejects duplicate snippets", () => {
  const res = applySearchReplace("b\nb\n", "b", "B");
  assert.equal(res.ok, false);
});

test("unified hunk applies with context", () => {
  const current = ["keep", "old", "tail"].join("\n");
  const res = applyUnifiedHunk(current, [" keep", "-old", "+next", " tail"].join("\n"));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.next, "keep\nnext\ntail");
});

test("parseApplyPatch reads update blocks", () => {
  const ops = parseApplyPatch(`*** Begin Patch
*** Update File: src/a.ts
@@
 const x = 1;
-const y = 2;
+const y = 3;
*** End Patch`);
  assert.equal(ops.length, 1);
  assert.equal(ops[0]?.kind, "update");
  if (ops[0]?.kind === "update") assert.equal(ops[0].path, "src/a.ts");
});

test("generateUnifiedDiff marks changed lines", () => {
  const diff = generateUnifiedDiff("a.ts", "one\ntwo\n", "one\nTWO\n");
  assert.match(diff, /--- a\/a\.ts/);
  assert.match(diff, /-two/);
  assert.match(diff, /\+TWO/);
});

test("upsertDraft drops unchanged files and collects accepted changes", () => {
  let drafts = upsertDraft([], "a.ts", "old", "old");
  assert.equal(drafts.length, 0);
  drafts = upsertDraft(drafts, "a.ts", "old", "new");
  assert.equal(acceptedChanges(drafts)[0]?.content, "new");
});
