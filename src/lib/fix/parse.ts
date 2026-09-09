import { extractJson } from "../review/parse.ts";
import { isSafeRepoPath } from "../github/branch.ts";
import type { FileChange } from "../github/write.ts";

export function parseFileChanges(text: string): FileChange[] {
  const json = extractJson(text);
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const raw = Array.isArray(obj.files)
    ? obj.files
    : Array.isArray(obj.changes)
      ? obj.changes
      : obj.path && obj.content
        ? [obj]
        : [];
  const out: FileChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const path = typeof rec.path === "string" ? rec.path.trim() : "";
    const content = typeof rec.content === "string" ? rec.content : "";
    if (!isSafeRepoPath(path) || !content.trim()) continue;
    out.push({ path, content });
  }
  return out;
}
