import { pathMatchesAny } from "../playbook.ts";

export type GrepHit = {
  path: string;
  line: number;
  text: string;
};

export function compileSearch(pattern: string): RegExp | null {
  const raw = pattern.trim();
  if (!raw) return null;
  try {
    return new RegExp(raw, "i");
  } catch {
    return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

export function grepContents(input: {
  contents: Record<string, string>;
  pattern: string;
  glob?: string;
  max?: number;
}): GrepHit[] {
  const re = compileSearch(input.pattern);
  if (!re) return [];
  const max = Math.min(Math.max(input.max ?? 80, 1), 200);
  const glob = input.glob?.trim();
  const hits: GrepHit[] = [];
  const paths = Object.keys(input.contents).sort();
  for (const path of paths) {
    if (glob && !pathMatchesAny(path, [glob])) continue;
    const text = input.contents[path] ?? "";
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!re.test(line)) continue;
      hits.push({ path, line: i + 1, text: line.slice(0, 240) });
      if (hits.length >= max) return hits;
    }
  }
  return hits;
}

export function grepPaths(input: {
  paths: string[];
  pattern: string;
  glob?: string;
  max?: number;
}): string[] {
  const re = compileSearch(input.pattern);
  if (!re) return [];
  const max = Math.min(Math.max(input.max ?? 40, 1), 200);
  const glob = input.glob?.trim();
  const out: string[] = [];
  for (const path of input.paths) {
    if (glob && !pathMatchesAny(path, [glob])) continue;
    if (!re.test(path)) continue;
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}
