import type { Finding, FindingSeverity, ReviewResult, StructuredReview } from "./types";

export const BATCH_MAX_FILES = 6;
export const BATCH_MAX_CHARS = 16_000;
export const FILE_MAX_CHARS = 6_000;
/** Hard cap — matches LM Studio Parallel 4 on a single loaded coder. */
export const LM_STUDIO_MAX_CONCURRENCY = 4;
/** Fill the Parallel 4 slots. Drop to 1–2 if another model is also in RAM. */
export const LM_STUDIO_DEFAULT_CONCURRENCY = 4;
export const LM_STUDIO_CONCURRENCY_CHOICES = [1, 2, 4] as const;

export function clampLmStudioConcurrency(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return LM_STUDIO_DEFAULT_CONCURRENCY;
  return Math.min(LM_STUDIO_MAX_CONCURRENCY, Math.max(1, n));
}

export type SlotLimiter = {
  run<T>(work: () => Promise<T>): Promise<T>;
};

/** Global in-flight cap so file batches and catalog repos share the same 4 pings. */
export function createSlotLimiter(limit: number): SlotLimiter {
  const cap = Math.max(1, Math.min(LM_STUDIO_MAX_CONCURRENCY, Math.floor(limit) || 1));
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire() {
    while (active >= cap) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    active += 1;
  }

  function release() {
    active -= 1;
    waiters.shift()?.();
  }

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export type ReviewQueueProgress = {
  phase: "files" | "merge";
  batch: number;
  total: number;
  paths: string[];
};

export function fileReviewWeight(
  path: string,
  contents: Record<string, string>,
  sizes?: Record<string, number>,
): number {
  const body = contents[path];
  if (body) return Math.min(body.length, FILE_MAX_CHARS);
  const size = sizes?.[path];
  if (size) return Math.min(size, FILE_MAX_CHARS);
  return 800;
}

/** Pack selected paths into LM Studio-sized batches. */
export function queueReviewBatches(
  paths: string[],
  contents: Record<string, string>,
  sizes?: Record<string, number>,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let used = 0;

  for (const path of paths) {
    const size = fileReviewWeight(path, contents, sizes);
    const overflow =
      current.length > 0 &&
      (current.length >= BATCH_MAX_FILES || used + size > BATCH_MAX_CHARS);
    if (overflow) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(path);
    used += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function findingKey(finding: Finding): string {
  return `${finding.file ?? ""}::${finding.title}`.toLowerCase();
}

function mergeFindings(parts: StructuredReview[]): Finding[] {
  const byKey = new Map<string, Finding>();
  let index = 0;
  for (const part of parts) {
    for (const finding of part.findings) {
      const key = findingKey(finding);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...finding, id: finding.id || `finding-${++index}` });
        continue;
      }
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
        byKey.set(key, { ...finding, id: existing.id });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

function uniqueKeep(items: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

export function mergeStructuredReviews(parts: StructuredReview[]): StructuredReview {
  const findings = mergeFindings(parts).slice(0, 24);
  const scores = parts.map((part) => part.score);
  const score = scores.length
    ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length)
    : 50;
  const shaky = parts.filter((part) => part.verdict === "shaky").length;
  const solid = parts.filter((part) => part.verdict === "solid").length;
  const verdict: StructuredReview["verdict"] =
    shaky > parts.length / 2 || score < 50
      ? "shaky"
      : solid > parts.length / 2 && score >= 78
        ? "solid"
        : "mixed";

  const headline =
    parts.find((part) => part.headline)?.headline || "Queued review complete";
  const summary =
    parts
      .map((part) => part.summary)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ") || headline;

  return {
    kind: "structured",
    headline,
    summary,
    score,
    verdict,
    stack: uniqueKeep(parts.flatMap((part) => part.stack), 12),
    findings,
    strengths: uniqueKeep(parts.flatMap((part) => part.strengths), 10),
    questions: uniqueKeep(parts.flatMap((part) => part.questions), 8),
  };
}

export function mergeReviewResults(parts: ReviewResult[]): ReviewResult {
  const structured = parts.filter(
    (part): part is StructuredReview => part.kind === "structured",
  );
  if (structured.length === 0) {
    return {
      kind: "prose",
      markdown: parts
        .map((part) => (part.kind === "prose" ? part.markdown : ""))
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  return mergeStructuredReviews(structured);
}

export async function runConcurrentIndexes(input: {
  indexes: number[];
  concurrency: number;
  signal: AbortSignal;
  worker: (index: number) => Promise<void>;
}): Promise<void> {
  let cursor = 0;
  async function run() {
    while (!input.signal.aborted) {
      const position = cursor;
      cursor += 1;
      const index = input.indexes[position];
      if (index === undefined) return;
      await input.worker(index);
    }
  }
  const n = Math.max(1, Math.min(input.concurrency, input.indexes.length || 1));
  await Promise.all(Array.from({ length: input.indexes.length ? n : 0 }, () => run()));
}

export function markPartialReview(
  result: ReviewResult,
  done: number,
  total: number,
): ReviewResult {
  if (done >= total) return result;
  if (result.kind === "structured") {
    return {
      ...result,
      headline: `Partial ${done}/${total} — ${result.headline}`,
      summary: `Saved ${done} of ${total} file batches locally. Resume the queue to finish.\n\n${result.summary}`,
    };
  }
  return {
    kind: "prose",
    markdown: `Partial ${done}/${total} batches saved. Resume the queue to finish.\n\n${result.markdown}`,
  };
}

export function compactBatchForMerge(result: ReviewResult, paths: string[]): string {
  if (result.kind === "prose") {
    return `Files: ${paths.join(", ")}\n${result.markdown.slice(0, 1200)}`;
  }
  const findings = result.findings
    .slice(0, 8)
    .map(
      (finding) =>
        `- ${finding.severity} ${finding.category}: ${finding.title}${finding.file ? ` (${finding.file})` : ""}`,
    )
    .join("\n");
  return [
    `Score ${result.score} ${result.verdict}. ${result.headline}`,
    result.summary,
    findings,
    result.strengths.length ? `Strengths: ${result.strengths.slice(0, 4).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
