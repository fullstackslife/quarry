export const AGENT_TOOLS = [
  {
    name: "glob",
    hint: "List repo paths matching a glob. Args: { pattern }",
  },
  {
    name: "grep",
    hint: "Search file contents (and paths). Args: { pattern, glob?, max? }",
  },
  {
    name: "read_file",
    hint: "Read a file. Args: { path, start?, end? } (1-based lines)",
  },
  {
    name: "str_replace",
    hint: "Replace one unique snippet. Args: { path, old_string, new_string }",
  },
  {
    name: "apply_patch",
    hint: "Apply a Begin Patch / Update File hunk. Args: { patch }",
  },
  {
    name: "write_file",
    hint: "Write a new file or a small full replacement. Args: { path, content }",
  },
  {
    name: "done",
    hint: "Finish. Args: { summary }",
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];

export type AgentToolCall = {
  name: AgentToolName;
  args: Record<string, unknown>;
};

const TOOL_NAMES = new Set<string>(AGENT_TOOLS.map((tool) => tool.name));

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function parseAgentCalls(text: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const xml = [...text.matchAll(/<tool\s+name="([a-z_]+)"\s*>([\s\S]*?)<\/tool>/gi)];
  for (const match of xml) {
    const name = match[1]?.toLowerCase() ?? "";
    if (!TOOL_NAMES.has(name)) continue;
    calls.push({ name: name as AgentToolName, args: parseArgs(match[2] ?? "") });
  }
  const fences = [
    ...text.matchAll(/```tool\s+([a-z_]+)\s*([\s\S]*?)```/gi),
    ...text.matchAll(/```json\s*tool\s+([a-z_]+)\s*([\s\S]*?)```/gi),
  ];
  for (const match of fences) {
    const name = match[1]?.toLowerCase() ?? "";
    if (!TOOL_NAMES.has(name)) continue;
    calls.push({ name: name as AgentToolName, args: parseArgs(match[2] ?? "") });
  }
  if (calls.length === 0) {
    const jsonCall = text.match(
      /\{[^{}]*"name"\s*:\s*"(glob|grep|read_file|str_replace|apply_patch|write_file|done)"[^{}]*\}/,
    );
    if (jsonCall) {
      try {
        const obj = JSON.parse(jsonCall[0]) as { name?: string; arguments?: unknown; args?: unknown };
        const name = obj.name?.toLowerCase() ?? "";
        if (TOOL_NAMES.has(name)) {
          calls.push({
            name: name as AgentToolName,
            args: asRecord(obj.arguments ?? obj.args),
          });
        }
      } catch {
        // ignore
      }
    }
  }
  return calls;
}

function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const normalized = trimmed.replace(/"([A-Za-z_]+)"\s*=\s*/g, '"$1":');
  try {
    return asRecord(JSON.parse(normalized));
  } catch {
    return recoverArgs(normalized);
  }
}

function recoverArgs(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = [
    "path",
    "pattern",
    "glob",
    "old_string",
    "new_string",
    "old",
    "new",
    "content",
    "patch",
    "summary",
  ];
  for (const key of keys) {
    const patterns = [
      new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`),
      new RegExp(`"${key}"\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`),
      new RegExp(`${key}=\\s*"((?:\\\\.|[^"\\\\])*)"`),
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match?.[1] && match?.[1] !== "") continue;
      if (match[1] == null) continue;
      out[key] = match[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
      break;
    }
  }
  return out;
}

export function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export function argNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
