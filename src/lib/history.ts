import type { ReviewRecord } from "./review/types.ts";
import { reviewToMarkdown } from "./review/parse.ts";

const KEY = "quarry.history.v1";
export const HISTORY_LIMIT = 100;

export type ReviewIndex = {
  savedAt: number;
  score: number | null;
};

export function loadHistory(): ReviewRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReviewRecord[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveHistory(records: ReviewRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
}

export function pushHistory(record: ReviewRecord, current: ReviewRecord[]) {
  const next = [record, ...current.filter((item) => item.id !== record.id)].slice(
    0,
    HISTORY_LIMIT,
  );
  saveHistory(next);
  return next;
}

export function lastReviewIndex(records: ReviewRecord[]): Record<string, ReviewIndex> {
  const out: Record<string, ReviewIndex> = {};
  for (const record of records) {
    const key = `${record.owner}/${record.repo}`.toLowerCase();
    if (out[key]) continue;
    out[key] = {
      savedAt: record.savedAt,
      score: record.result.kind === "structured" ? record.result.score : null,
    };
  }
  return out;
}

export function exportHistoryJson(records: ReviewRecord[]): string {
  return `${JSON.stringify(records, null, 2)}\n`;
}

export function parseHistoryImport(raw: string): ReviewRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("History JSON must be an array.");
  return parsed.filter((item) => item && typeof item === "object") as ReviewRecord[];
}

export function exportHistoryMarkdown(records: ReviewRecord[]): string {
  return records
    .map((record) => {
      if (record.result.kind === "structured") {
        return reviewToMarkdown(record.owner, record.repo, record.result);
      }
      return `# ${record.owner}/${record.repo}\n\n${record.result.markdown}`;
    })
    .join("\n\n---\n\n");
}
