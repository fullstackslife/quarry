import type { Playbook } from "../playbook.ts";
import type { ReviewLens } from "./types.ts";
import { isRetryableRolloutError } from "../github/throttle.ts";

const KEY = "quarry.rollout.v1";

export type RolloutRepoStatus = "pending" | "running" | "done" | "error" | "skipped";

export type RolloutRepoState = {
  status: RolloutRepoStatus;
  error?: string;
};

export type RolloutJob = {
  id: string;
  updatedAt: number;
  repos: string[];
  lens: ReviewLens;
  playbook: Playbook;
  states: Record<string, RolloutRepoState>;
  current: string | null;
  source?: "watchlist" | "catalog";
  batchSize?: number;
  /** User hit Stop. Do not auto-resume on reload. */
  pausedByUser?: boolean;
};

export function createRollout(
  repos: string[],
  lens: ReviewLens,
  playbook: Playbook,
  extra?: { source?: "watchlist" | "catalog"; batchSize?: number },
): RolloutJob {
  const unique = [...new Set(repos.map((item) => item.trim()).filter(Boolean))];
  const states: Record<string, RolloutRepoState> = {};
  for (const repo of unique) states[repo] = { status: "pending" };
  return {
    id: `rollout-${Date.now()}`,
    updatedAt: Date.now(),
    repos: unique,
    lens,
    playbook,
    states,
    current: null,
    source: extra?.source ?? "watchlist",
    batchSize: extra?.batchSize,
    pausedByUser: false,
  };
}

export function nextPendingRepo(job: RolloutJob): string | null {
  return (
    job.repos.find((repo) => (job.states[repo]?.status ?? "pending") === "pending") ??
    null
  );
}

export function runningRepos(job: RolloutJob): string[] {
  return job.repos.filter((repo) => job.states[repo]?.status === "running");
}

export function claimNextPendingRepo(
  job: RolloutJob,
): { job: RolloutJob; repo: string } | null {
  const repo = nextPendingRepo(job);
  if (!repo) return null;
  return { job: markRolloutRepo(job, repo, "running"), repo };
}

export function rolloutCounts(job: RolloutJob): {
  done: number;
  error: number;
  pending: number;
  skipped: number;
  total: number;
} {
  let done = 0;
  let error = 0;
  let pending = 0;
  let skipped = 0;
  for (const repo of job.repos) {
    const status = job.states[repo]?.status ?? "pending";
    if (status === "done") done += 1;
    else if (status === "error") error += 1;
    else if (status === "skipped") skipped += 1;
    else pending += 1;
  }
  return { done, error, pending, skipped, total: job.repos.length };
}

export function isRolloutFinished(job: RolloutJob): boolean {
  return job.repos.every((repo) => {
    const status = job.states[repo]?.status ?? "pending";
    return status === "done" || status === "error" || status === "skipped";
  });
}

export function markRolloutRepo(
  job: RolloutJob,
  repo: string,
  status: RolloutRepoStatus,
  error?: string,
): RolloutJob {
  const next: RolloutJob = {
    ...job,
    updatedAt: Date.now(),
    states: {
      ...job.states,
      [repo]: error ? { status, error } : { status },
    },
  };
  next.current = runningRepos(next).join(", ") || null;
  saveRollout(next);
  return next;
}

export function recoverInterruptedRepos(job: RolloutJob): RolloutJob {
  let changed = false;
  const states = { ...job.states };
  for (const repo of job.repos) {
    if (states[repo]?.status === "running") {
      states[repo] = { status: "pending" };
      changed = true;
    }
  }
  if (!changed) return job;
  const next: RolloutJob = {
    ...job,
    updatedAt: Date.now(),
    current: null,
    states,
  };
  saveRollout(next);
  return next;
}

export function setRolloutPausedByUser(job: RolloutJob, paused: boolean): RolloutJob {
  const next: RolloutJob = {
    ...job,
    updatedAt: Date.now(),
    pausedByUser: paused,
  };
  saveRollout(next);
  return next;
}

export function requeueRetryableErrors(job: RolloutJob): RolloutJob {
  let changed = false;
  const states = { ...job.states };
  for (const repo of job.repos) {
    const state = states[repo];
    if (state?.status === "error" && isRetryableRolloutError(state.error)) {
      states[repo] = { status: "pending" };
      changed = true;
    }
  }
  if (!changed) return job;
  const next: RolloutJob = {
    ...job,
    updatedAt: Date.now(),
    pausedByUser: false,
    current: null,
    states,
  };
  saveRollout(next);
  return next;
}

export function rolloutErrorSummary(
  job: RolloutJob,
): { message: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const repo of job.repos) {
    const state = job.states[repo];
    if (state?.status !== "error") continue;
    const message = state.error || "Review failed.";
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count);
}

export function retryableErrorCount(job: RolloutJob): number {
  let count = 0;
  for (const repo of job.repos) {
    const state = job.states[repo];
    if (state?.status === "error" && isRetryableRolloutError(state.error)) {
      count += 1;
    }
  }
  return count;
}

export function loadRollout(): RolloutJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RolloutJob;
    if (!parsed?.id || !Array.isArray(parsed.repos) || !parsed.states) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRollout(job: RolloutJob) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify({ ...job, updatedAt: Date.now() }));
}

export function clearRollout() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
