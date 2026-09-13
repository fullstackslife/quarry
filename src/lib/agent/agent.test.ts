import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentCalls } from "./parse.ts";
import { executeAgentTool, type AgentHost } from "./tools.ts";
import { runCodingAgent } from "./run.ts";

function host(contents: Record<string, string>, paths?: string[]): AgentHost {
  const store = { ...contents };
  return {
    paths: paths ?? Object.keys(store),
    contents: store,
    loadFile: async (path) => store[path] ?? "",
    writeFile: (path, content) => {
      store[path] = content;
    },
  };
}

test("parseAgentCalls reads XML tool tags", () => {
  const calls = parseAgentCalls(
    '<tool name="grep">{"pattern":"foo","glob":"src/**"}</tool>\n<tool name="done">{"summary":"ok"}</tool>',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.name, "grep");
  assert.equal(calls[0]?.args.pattern, "foo");
  assert.equal(calls[1]?.name, "done");
});

test("parseAgentCalls recovers equals-sign JSON from small models", () => {
  const calls = parseAgentCalls(
    String.raw`<tool name="str_replace">{"path":"source/utils/is.ts","old_string":"","new_string="// quarry ping.\n"}</tool>`,
  );
  assert.equal(calls[0]?.name, "str_replace");
  assert.equal(calls[0]?.args.path, "source/utils/is.ts");
  assert.equal(calls[0]?.args.new_string, "// quarry ping.\n");
});

test("executeAgentTool greps and patches", async () => {
  const h = host({ "src/a.ts": "const x = 1;\nconst y = 2;\n" }, ["src/a.ts"]);
  const grep = await executeAgentTool(h, {
    name: "grep",
    args: { pattern: "const y" },
  });
  assert.match(grep, /src\/a\.ts:2/);
  const replaced = await executeAgentTool(h, {
    name: "str_replace",
    args: { path: "src/a.ts", old_string: "const y = 2;", new_string: "const y = 3;" },
  });
  assert.match(replaced, /Updated/);
  assert.match(h.contents["src/a.ts"] ?? "", /const y = 3;/);
});

test("runCodingAgent loops tools then collects drafts", async () => {
  const h = host({ "src/a.ts": "export const a = 1;\n" }, ["src/a.ts"]);
  let n = 0;
  const result = await runCodingAgent({
    messages: [{ role: "user", content: "bump a" }],
    host: h,
    complete: async () => {
      n += 1;
      if (n === 1) {
        return '<tool name="str_replace">{"path":"src/a.ts","old_string":"export const a = 1;","new_string":"export const a = 2;"}</tool>';
      }
      return '<tool name="done">{"summary":"bumped"}</tool>';
    },
    signal: new AbortController().signal,
  });
  assert.equal(result.summary, "bumped");
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.content.includes("a = 2"), true);
});
