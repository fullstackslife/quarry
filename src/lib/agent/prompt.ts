import { AGENT_TOOLS } from "./parse.ts";
import type { Finding } from "../review/types.ts";

export function buildAgentSystemPrompt(): string {
  const tools = AGENT_TOOLS.map((tool) => `- ${tool.name}: ${tool.hint}`).join("\n");
  return [
    "You are Quarry's coding agent, working like Cursor on a GitHub repository snapshot.",
    "Explore with glob/grep/read_file before editing. Prefer str_replace or apply_patch over rewriting whole files.",
    "Do not invent files or APIs. Keep unrelated code. Never write secrets or .env files.",
    "Call one or more tools, then stop and wait for results. When the work is done, call done.",
    "Tool format (JSON args, no markdown fence around the XML):",
    '<tool name="grep">{"pattern":"foo","glob":"src/**"}</tool>',
    "Available tools:",
    tools,
  ].join("\n");
}

export function buildAgentTask(input: {
  owner: string;
  repo: string;
  jobLabel?: string;
  paths: string[];
  findings?: Finding[];
  instruction: string;
}): string {
  const findings = (input.findings ?? [])
    .map(
      (finding) =>
        `- ${finding.severity} ${finding.category}: ${finding.title}\n  ${finding.detail}${finding.file ? `\n  File: ${finding.file}` : ""}${finding.evidence ? `\n  Evidence: ${finding.evidence}` : ""}`,
    )
    .join("\n");
  return [
    `# ${input.owner}/${input.repo}`,
    input.jobLabel ? `Job: ${input.jobLabel}` : "",
    "",
    "## Task",
    input.instruction,
    findings ? "## Findings\n" + findings : "",
    "",
    "## Known paths (excerpt)",
    input.paths.slice(0, 80).join("\n") || "(none loaded yet)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
