export type DiffRow = {
  type: "ctx" | "add" | "del";
  text: string;
};

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function applySearchReplace(
  current: string,
  oldText: string,
  newText: string,
): { ok: true; next: string } | { ok: false; error: string } {
  const oldNorm = oldText.replace(/\r\n/g, "\n");
  const curNorm = current.replace(/\r\n/g, "\n");
  const insert = newText.replace(/\r\n/g, "\n");
  if (!oldNorm) {
    if (!insert) return { ok: false, error: "old_string is empty." };
    const prefix = insert.endsWith("\n") ? insert : `${insert}\n`;
    return { ok: true, next: `${prefix}${curNorm}` };
  }
  const first = curNorm.indexOf(oldNorm);
  if (first < 0) return { ok: false, error: "old_string was not found in the file." };
  const second = curNorm.indexOf(oldNorm, first + oldNorm.length);
  if (second >= 0) {
    return { ok: false, error: "old_string matched more than once. Include more context." };
  }
  return { ok: true, next: curNorm.slice(0, first) + newText.replace(/\r\n/g, "\n") + curNorm.slice(first + oldNorm.length) };
}

export function generateUnifiedDiff(path: string, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.join("\n") === b.join("\n")) return "";
  const rows = diffRows(a, b);
  const body = rows
    .map((row) => (row.type === "add" ? `+${row.text}` : row.type === "del" ? `-${row.text}` : ` ${row.text}`))
    .join("\n");
  return [`--- a/${path}`, `+++ b/${path}`, "@@", body].join("\n");
}

export function diffRows(beforeLines: string[], afterLines: string[]): DiffRow[] {
  const cap = 2500;
  if (beforeLines.length > cap || afterLines.length > cap) {
    return [
      ...beforeLines.slice(0, cap).map((text) => ({ type: "del" as const, text })),
      ...afterLines.slice(0, cap).map((text) => ({ type: "add" as const, text })),
    ];
  }
  const n = beforeLines.length;
  const m = afterLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        beforeLines[i] === afterLines[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      out.push({ type: "ctx", text: beforeLines[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: "del", text: beforeLines[i]! });
      i += 1;
    } else {
      out.push({ type: "add", text: afterLines[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: beforeLines[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ type: "add", text: afterLines[j]! });
    j += 1;
  }
  return out;
}

export function applyUnifiedHunk(current: string, hunkBody: string): { ok: true; next: string } | { ok: false; error: string } {
  const lines = splitLines(current);
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of splitLines(hunkBody)) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith("-")) oldLines.push(line.slice(1));
    else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      oldLines.push(text);
      newLines.push(text);
    }
  }
  if (oldLines.length === 0 && newLines.length === 0) {
    return { ok: false, error: "Empty hunk." };
  }
  if (oldLines.length === 0) {
    const joined = lines.concat(newLines).join("\n");
    return { ok: true, next: joined };
  }
  const idx = indexOfLines(lines, oldLines);
  if (idx < 0) return { ok: false, error: "Hunk context did not match the file." };
  const next = [...lines.slice(0, idx), ...newLines, ...lines.slice(idx + oldLines.length)];
  return { ok: true, next: next.join("\n") };
}

function indexOfLines(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export type PatchOp =
  | { kind: "update"; path: string; hunk: string }
  | { kind: "add"; path: string; content: string }
  | { kind: "delete"; path: string };

export function parseApplyPatch(text: string): PatchOp[] {
  const ops: PatchOp[] = [];
  const blocks = text.split(/^\*\*\* Begin Patch\s*$/m);
  for (const block of blocks) {
    const end = block.search(/^\*\*\* End Patch\s*$/m);
    const body = (end >= 0 ? block.slice(0, end) : block).trim();
    if (!body) continue;
    const add = body.match(/^\*\*\* Add File:\s*(.+)$/m);
    const del = body.match(/^\*\*\* Delete File:\s*(.+)$/m);
    const upd = body.match(/^\*\*\* Update File:\s*(.+)$/m);
    if (add) {
      const path = add[1]!.trim();
      const afterHeader = body.slice(body.indexOf(add[0]) + add[0].length);
      const content = splitLines(afterHeader)
        .map((line) => (line.startsWith("+") ? line.slice(1) : line))
        .join("\n")
        .replace(/^\n/, "");
      ops.push({ kind: "add", path, content });
    } else if (del) {
      ops.push({ kind: "delete", path: del[1]!.trim() });
    } else if (upd) {
      const path = upd[1]!.trim();
      const hunk = body.slice(body.indexOf(upd[0]) + upd[0].length).trim();
      ops.push({ kind: "update", path, hunk });
    }
  }
  if (ops.length === 0) {
    const fence = text.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
    const raw = fence?.[1] ?? text;
    const file = raw.match(/^\+\+\+\s+(?:b\/)?(.+)$/m);
    if (file) {
      ops.push({ kind: "update", path: file[1]!.trim(), hunk: raw });
    }
  }
  return ops;
}
