import type { ReviewRecord } from "@/lib/review/types";

const KEY = "quarry.history.v1";
const LIMIT = 10;

export function loadHistory(): ReviewRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReviewRecord[];
    return Array.isArray(parsed) ? parsed.slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveHistory(records: ReviewRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
}

export function pushHistory(record: ReviewRecord, current: ReviewRecord[]) {
  const next = [record, ...current.filter((item) => item.id !== record.id)].slice(0, LIMIT);
  saveHistory(next);
  return next;
}
