import { parseFileChanges } from "../fix/parse.ts";
import type { FileChange } from "../github/write.ts";
import { parseAgentCalls } from "./parse.ts";
import { executeAgentTool, type AgentHost } from "./tools.ts";

export type AgentLogItem = {
  role: "assistant" | "tool";
  text: string;
};

export async function runCodingAgent(input: {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  host: AgentHost;
  complete: (messages: { role: string; content: string }[]) => Promise<string>;
  maxSteps?: number;
  signal: AbortSignal;
  onProgress?: (label: string) => void;
}): Promise<{ summary: string; changes: FileChange[]; log: AgentLogItem[] }> {
  const maxSteps = Math.min(Math.max(input.maxSteps ?? 10, 1), 16);
  const messages = [...input.messages];
  const log: AgentLogItem[] = [];
  let summary = "";
  const originals = { ...input.host.contents };

  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    input.onProgress?.(`Agent step ${step}/${maxSteps}`);
    const text = await input.complete(messages);
    log.push({ role: "assistant", text: text.slice(0, 8_000) });
    messages.push({ role: "assistant", content: text });

    const calls = parseAgentCalls(text);
    if (calls.length === 0) {
      const parsed = parseFileChanges(text);
      for (const file of parsed) {
        input.host.writeFile(file.path, file.content);
      }
      summary = text.slice(0, 500);
      break;
    }

    const done = calls.find((call) => call.name === "done");
    const work = calls.filter((call) => call.name !== "done");
    const results: string[] = [];
    for (const call of work) {
      input.onProgress?.(`${call.name} · step ${step}`);
      results.push(`# ${call.name}\n${await executeAgentTool(input.host, call)}`);
    }
    if (done) {
      summary = (done.args.summary as string) || "Done.";
      if (results.length === 0) break;
    }
    if (results.length === 0) break;
    const toolText = results.join("\n\n");
    log.push({ role: "tool", text: toolText.slice(0, 8_000) });
    messages.push({
      role: "user",
      content: `Tool results:\n${toolText}\nContinue with more tools, or call done.`,
    });
  }

  const changes: FileChange[] = [];
  const seen = new Set<string>();
  for (const [path, content] of Object.entries(input.host.contents)) {
    if (content === originals[path]) continue;
    if (!content.trim()) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    changes.push({ path, content });
  }
  return { summary: summary || "Agent finished.", changes, log };
}
