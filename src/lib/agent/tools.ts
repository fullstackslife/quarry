import { isSafeRepoPath } from "../github/branch.ts";
import { pathMatchesAny } from "../playbook.ts";
import { grepContents, grepPaths } from "../workspace/grep.ts";
import { applySearchReplace, applyUnifiedHunk, parseApplyPatch } from "../workspace/patch.ts";
import { argNumber, argString, type AgentToolCall } from "./parse.ts";

export type AgentHost = {
  paths: string[];
  contents: Record<string, string>;
  loadFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => void;
};

const READ_MAX = 400;

function clip(text: string, max = 12_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated`;
}

export async function executeAgentTool(
  host: AgentHost,
  call: AgentToolCall,
): Promise<string> {
  switch (call.name) {
    case "glob": {
      const pattern = argString(call.args, "pattern") || "**";
      const hits = host.paths.filter((path) => pathMatchesAny(path, [pattern])).slice(0, 80);
      return hits.length ? hits.join("\n") : "No matching paths.";
    }
    case "grep": {
      const pattern = argString(call.args, "pattern");
      if (!pattern) return "pattern is required.";
      const glob = argString(call.args, "glob") || undefined;
      const max = argNumber(call.args, "max");
      const contentHits = grepContents({
        contents: host.contents,
        pattern,
        glob,
        max,
      });
      const pathHits = grepPaths({ paths: host.paths, pattern, glob, max: 20 });
      const lines = [
        ...contentHits.map((hit) => `${hit.path}:${hit.line}: ${hit.text}`),
        ...pathHits
          .filter((path) => !contentHits.some((hit) => hit.path === path))
          .map((path) => `${path}: path match`),
      ];
      return lines.length ? clip(lines.join("\n")) : "No matches in loaded files or paths.";
    }
    case "read_file": {
      const path = argString(call.args, "path").trim();
      if (!isSafeRepoPath(path)) return "Unsafe path.";
      let text = host.contents[path];
      if (!text) {
        try {
          text = await host.loadFile(path);
        } catch (err) {
          return err instanceof Error ? err.message : "Could not load file.";
        }
      }
      if (!text) return `File not found or empty: ${path}`;
      const lines = text.split(/\r?\n/);
      const start = Math.max(argNumber(call.args, "start") ?? 1, 1);
      const end = Math.min(argNumber(call.args, "end") ?? start + READ_MAX - 1, lines.length);
      const slice = lines.slice(start - 1, end);
      const numbered = slice.map((line, i) => `${String(start + i).padStart(4, " ")}|${line}`);
      return clip(`${path} (${start}-${end} of ${lines.length})\n${numbered.join("\n")}`);
    }
    case "str_replace": {
      const path = argString(call.args, "path").trim();
      if (!isSafeRepoPath(path)) return "Unsafe path.";
      let current = host.contents[path];
      if (current == null) {
        try {
          current = await host.loadFile(path);
        } catch (err) {
          return err instanceof Error ? err.message : "Could not load file.";
        }
      }
      if (current == null) return `File not found: ${path}`;
      const result = applySearchReplace(
        current,
        argString(call.args, "old_string") || argString(call.args, "old"),
        argString(call.args, "new_string") || argString(call.args, "new"),
      );
      if (!result.ok) return result.error;
      host.writeFile(path, result.next);
      return `Updated ${path}`;
    }
    case "apply_patch": {
      const patch = argString(call.args, "patch") || argString(call.args, "diff");
      if (!patch) return "patch is required.";
      const ops = parseApplyPatch(patch);
      if (ops.length === 0) return "Could not parse patch.";
      const notes: string[] = [];
      for (const op of ops) {
        if (!isSafeRepoPath(op.path)) {
          notes.push(`Skipped unsafe path ${op.path}`);
          continue;
        }
        if (op.kind === "delete") {
          host.writeFile(op.path, "");
          notes.push(`Deleted ${op.path} (empty file in draft)`);
          continue;
        }
        if (op.kind === "add") {
          host.writeFile(op.path, op.content);
          notes.push(`Added ${op.path}`);
          continue;
        }
        let current = host.contents[op.path] ?? "";
        if (!current) {
          try {
            current = await host.loadFile(op.path);
          } catch {
            current = "";
          }
        }
        const applied = applyUnifiedHunk(current, op.hunk);
        if (!applied.ok) {
          notes.push(`${op.path}: ${applied.error}`);
          continue;
        }
        host.writeFile(op.path, applied.next);
        notes.push(`Patched ${op.path}`);
      }
      return notes.join("\n") || "No ops applied.";
    }
    case "write_file": {
      const path = argString(call.args, "path").trim();
      const content = argString(call.args, "content");
      if (!isSafeRepoPath(path)) return "Unsafe path.";
      if (!content.trim()) return "content is required.";
      host.writeFile(path, content);
      return `Wrote ${path}`;
    }
    case "done":
      return argString(call.args, "summary") || "Done.";
    default:
      return "Unknown tool.";
  }
}
