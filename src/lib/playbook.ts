import type { ReviewLens } from "./review/types.ts";

export type Playbook = {
  lens: ReviewLens | null;
  include: string[];
  ignore: string[];
};

const KEY = "quarry.playbooks.v1";
const DEFAULT_KEY = "quarry.playbook.default.v1";

export function playbookKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

export function emptyPlaybook(): Playbook {
  return { lens: null, include: [], ignore: [] };
}

export function normalizePlaybook(value: Partial<Playbook> | null | undefined): Playbook {
  return {
    lens: value?.lens ?? null,
    include: Array.isArray(value?.include) ? value.include.map(String) : [],
    ignore: Array.isArray(value?.ignore) ? value.ignore.map(String) : [],
  };
}

export function playbookHasOverrides(playbook: Playbook | null | undefined): boolean {
  if (!playbook) return false;
  return Boolean(playbook.lens || playbook.include.length || playbook.ignore.length);
}

export function resolvePlaybook(
  perRepo: Playbook | null | undefined,
  campaignDefault: Playbook,
): Playbook {
  return playbookHasOverrides(perRepo) ? (perRepo as Playbook) : campaignDefault;
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ":::GLOBSTAR:::")
    .replace(/\*/g, "[^/]*")
    .replace(/:::GLOBSTAR:::/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function pathMatchesAny(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    if (!trimmed.includes("*")) {
      return (
        normalized === trimmed ||
        normalized.startsWith(`${trimmed.replace(/\/$/, "")}/`)
      );
    }
    return globToRegExp(trimmed).test(normalized);
  });
}

export function loadPlaybooks(): Record<string, Playbook> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<Playbook>>;
    const out: Record<string, Playbook> = {};
    for (const [id, value] of Object.entries(parsed)) {
      out[id] = normalizePlaybook(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function savePlaybooks(playbooks: Record<string, Playbook>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(playbooks));
}

export function upsertPlaybook(
  playbooks: Record<string, Playbook>,
  owner: string,
  repo: string,
  playbook: Playbook,
): Record<string, Playbook> {
  const next = { ...playbooks, [playbookKey(owner, repo)]: playbook };
  savePlaybooks(next);
  return next;
}

export function loadDefaultPlaybook(): Playbook {
  if (typeof window === "undefined") return emptyPlaybook();
  try {
    const raw = window.localStorage.getItem(DEFAULT_KEY);
    if (!raw) return emptyPlaybook();
    return normalizePlaybook(JSON.parse(raw) as Partial<Playbook>);
  } catch {
    return emptyPlaybook();
  }
}

export function saveDefaultPlaybook(playbook: Playbook) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEFAULT_KEY, JSON.stringify(normalizePlaybook(playbook)));
}
