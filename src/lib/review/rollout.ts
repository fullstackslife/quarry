import type { Playbook } from "../playbook.ts";
import type { ReviewLens } from "./types.ts";

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
};

export function createRollout(
  repos: string[],
  lens: ReviewLens,
  playbook: Playbook,
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
  };
}

export function nextPendingRepo(job: RolloutJob): string | null {
  return (
    job.repos.find((repo) => (job.states[repo]?.status ?? "pending") === "pending") ??
    null
  );
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
  return nextPendingRepo(job) === null;
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
    current: status === "running" ? repo : job.current === repo ? null : job.current,
    states: {
      ...job.states,
      [repo]: error ? { status, error } : { status },
    },
  };
  saveRollout(next);
  return next;
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
