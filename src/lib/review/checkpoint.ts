import type { ReviewLens, ReviewResult } from "./types";

const KEY = "quarry.queue.checkpoint.v1";

export type CheckpointBatch = {
  index: number;
  paths: string[];
  result: ReviewResult;
};

export type QueueCheckpoint = {
  id: string;
  updatedAt: number;
  owner: string;
  repo: string;
  lens: ReviewLens;
  model: string;
  selected: string[];
  batches: string[][];
  results: Array<CheckpointBatch | null>;
};

export function checkpointId(input: {
  owner: string;
  repo: string;
  lens: ReviewLens;
  selected: string[];
}): string {
  return `${input.owner}/${input.repo}::${input.lens}::${input.selected.join("|")}`;
}

export function completedBatchCount(job: QueueCheckpoint): number {
  return job.results.filter(Boolean).length;
}

export function pendingBatchIndexes(job: QueueCheckpoint): number[] {
  return job.batches
    .map((_, index) => index)
    .filter((index) => !job.results[index]);
}

export function loadCheckpoint(): QueueCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QueueCheckpoint;
    if (!parsed?.id || !Array.isArray(parsed.batches) || !Array.isArray(parsed.results)) {
      return null;
    }
    if (parsed.results.length !== parsed.batches.length) {
      parsed.results = parsed.batches.map((_, i) => parsed.results[i] ?? null);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCheckpoint(job: QueueCheckpoint) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...job, updatedAt: Date.now() }),
    );
  } catch {
    // Quota — keep going; in-memory ref still has the work.
  }
}

export function clearCheckpoint() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function writeBatchResult(
  job: QueueCheckpoint,
  index: number,
  result: ReviewResult,
): QueueCheckpoint {
  const results = job.results.slice();
  results[index] = {
    index,
    paths: job.batches[index] ?? [],
    result,
  };
  const next = { ...job, results, updatedAt: Date.now() };
  saveCheckpoint(next);
  return next;
}

export function checkpointMatchesRepo(
  job: QueueCheckpoint | null,
  owner: string,
  repo: string,
): boolean {
  return Boolean(job && job.owner === owner && job.repo === repo);
}
