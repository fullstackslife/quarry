import type { RepoBundle } from "@/lib/github/types";
import { completeChat } from "@/lib/llm/complete";
import { parseReview } from "./parse";
import { buildReviewMessages, buildSynthesisMessages } from "./prompt";
import {
  checkpointId,
  clearCheckpoint,
  completedBatchCount,
  loadCheckpoint,
  pendingBatchIndexes,
  saveCheckpoint,
  writeBatchResult,
  type QueueCheckpoint,
} from "./checkpoint";
import {
  BATCH_MAX_CHARS,
  compactBatchForMerge,
  clampLmStudioConcurrency,
  markPartialReview,
  mergeReviewResults,
  queueReviewBatches,
  runConcurrentIndexes,
  type ReviewQueueProgress,
} from "./queue";
import type { ReviewLens, ReviewResult } from "./types";

export type QueuedReviewTarget = "lmstudio" | "grok";

export type RunQueuedReviewInput = {
  bundle: RepoBundle;
  selected: string[];
  contents: Record<string, string>;
  lens: ReviewLens;
  target: QueuedReviewTarget;
  lmStudioUrl: string;
  model: string;
  temperature: number;
  maxFiles: number;
  maxChars: number;
  concurrency?: number;
  jobDigest?: string;
  contextDigest?: string;
  signal: AbortSignal;
  existingCheckpoint?: QueueCheckpoint | null;
  onCheckpoint: (job: QueueCheckpoint | null) => void;
  onProgress: (progress: ReviewQueueProgress | null) => void;
  onStream: (text: string) => void;
  loadContents: (
    paths: string[],
    base: Record<string, string>,
  ) => Promise<Record<string, string>>;
  /** Shared GPU slots so catalog repos cannot exceed Parallel N together. */
  limitSlot?: <T>(work: () => Promise<T>) => Promise<T>;
};

export type RunQueuedReviewOutcome = {
  status: "complete" | "paused" | "incomplete";
  result: ReviewResult | null;
  message?: string;
  providerLabel: string;
};

export async function runQueuedReview(
  input: RunQueuedReviewInput,
): Promise<RunQueuedReviewOutcome> {
  const providerLabel =
    input.target === "lmstudio" ? `LM Studio · ${input.model}` : "Grok 4.5";
  const paths =
    input.target === "grok" ? input.selected.slice(0, input.maxFiles) : input.selected;
  if (paths.length === 0) {
    throw new Error("Select at least one file to review.");
  }
  if (input.target === "lmstudio" && !input.model) {
    throw new Error("Pick a loaded LM Studio model in Settings.");
  }

  const sizes = Object.fromEntries(
    input.bundle.files.map((file) => [file.path, file.size]),
  );
  const batches =
    input.target === "lmstudio"
      ? queueReviewBatches(paths, input.contents, sizes)
      : [paths];
  const id = checkpointId({
    owner: input.bundle.meta.owner,
    repo: input.bundle.meta.repo,
    lens: input.lens,
    selected: paths,
  });
  let job: QueueCheckpoint =
    input.existingCheckpoint && input.existingCheckpoint.id === id
      ? input.existingCheckpoint
      : {
          id,
          updatedAt: Date.now(),
          owner: input.bundle.meta.owner,
          repo: input.bundle.meta.repo,
          lens: input.lens,
          model: input.model,
          selected: paths,
          batches,
          results: batches.map(() => null),
        };
  if (job.batches.length !== batches.length) {
    job = {
      ...job,
      batches,
      results: batches.map((_, i) => job.results[i] ?? null),
    };
  }
  saveCheckpoint(job);
  input.onCheckpoint(job);

  const running = new Set<number>();
  const streamBuffers = new Map<number, string>();

  function publishProgress(current: QueueCheckpoint) {
    const runningPaths = [...running].flatMap((index) => current.batches[index] ?? []);
    const done = completedBatchCount(current);
    input.onCheckpoint(current);
    input.onProgress({
      phase: "files",
      batch: Math.min(current.batches.length, done + running.size),
      total: current.batches.length,
      paths: runningPaths,
    });
  }

  function partialOutcome(
    current: QueueCheckpoint,
    message: string,
    status: "paused" | "incomplete",
  ): RunQueuedReviewOutcome {
    const parts = current.results
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => item.result);
    return {
      status,
      providerLabel,
      message,
      result: parts.length
        ? markPartialReview(
            mergeReviewResults(parts),
            parts.length,
            current.batches.length,
          )
        : null,
    };
  }

  let loaded = input.contents;
  let fetchLock = Promise.resolve();
  async function loadLocked(batchPaths: string[]) {
    const previous = fetchLock;
    let release = () => {};
    fetchLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      loaded = await input.loadContents(batchPaths, loaded);
      return loaded;
    } finally {
      release();
    }
  }

  publishProgress(job);

  const takeSlot = input.limitSlot ?? (<T>(work: () => Promise<T>) => work());

  try {
    await runConcurrentIndexes({
      indexes: pendingBatchIndexes(job),
      concurrency:
        input.target === "lmstudio"
          ? clampLmStudioConcurrency(input.concurrency)
          : 1,
      signal: input.signal,
      worker: async (index) => {
        const batchPaths = job.batches[index] ?? [];
        running.add(index);
        publishProgress(job);
        const batchContents = await loadLocked(batchPaths);
        const budget =
          input.target === "grok"
            ? Math.min(Math.max(input.maxChars, 48_000), 140_000)
            : BATCH_MAX_CHARS;
        const messages = buildReviewMessages({
          meta: input.bundle.meta,
          languages: input.bundle.languages,
          allPaths: input.bundle.files.map((file) => file.path),
          contents: batchContents,
          selected: batchPaths,
          lens: input.lens,
          maxChars: budget,
          treeLimit: job.batches.length > 1 ? 60 : 80,
          findingHint: job.batches.length > 1 ? "Write 3 to 8 findings." : undefined,
          batch:
            job.batches.length > 1
              ? { index: index + 1, total: job.batches.length }
              : undefined,
          jobDigest: input.jobDigest,
          contextDigest: input.contextDigest,
        });
        const text = await takeSlot(() =>
          completeChat({
          target: input.target,
          lmStudioUrl: input.lmStudioUrl,
          model: input.model,
          messages,
          temperature: input.temperature,
          signal: input.signal,
          onDelta: (chunk) => {
            const next = (streamBuffers.get(index) ?? "") + chunk;
            streamBuffers.set(index, next);
            const body = [...streamBuffers.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([batch, value]) => `--- batch ${batch + 1} ---\n${value.slice(-1800)}`)
              .join("\n\n");
            input.onStream(body);
          },
        }),
        );
        const parsedBatch = parseReview(text);
        job = writeBatchResult(job, index, parsedBatch);
        running.delete(index);
        publishProgress(job);
      },
    });
  } catch (err) {
    if (input.signal.aborted) {
      return partialOutcome(
        job,
        "Queue paused. Completed batches are saved — Resume to continue.",
        "paused",
      );
    }
    const message = err instanceof Error ? err.message : "Review failed.";
    if (completedBatchCount(job) > 0) {
      return partialOutcome(
        job,
        `${message} Completed batches are saved — Resume to continue.`,
        "incomplete",
      );
    }
    throw err;
  }

  if (input.signal.aborted) {
    return partialOutcome(
      job,
      "Queue paused. Completed batches are saved — Resume to continue.",
      "paused",
    );
  }

  const batchResults = job.results
    .map((item) => item?.result)
    .filter((item): item is ReviewResult => Boolean(item));
  if (batchResults.length < job.batches.length) {
    return partialOutcome(
      job,
      `Saved ${batchResults.length} of ${job.batches.length} batches. Resume to finish.`,
      "incomplete",
    );
  }

  let parsed = mergeReviewResults(batchResults);
  if (
    input.target === "lmstudio" &&
    job.batches.length > 1 &&
    batchResults.length === job.batches.length
  ) {
    input.onProgress({
      phase: "merge",
      batch: job.batches.length,
      total: job.batches.length,
      paths: [],
    });
    input.onStream("");
    const notes = job.results.map((item, i) =>
      compactBatchForMerge(
        item?.result ?? { kind: "prose", markdown: "" },
        job.batches[i] ?? [],
      ),
    );
    let mergeBuf = "";
    try {
      const mergeText = await takeSlot(() =>
        completeChat({
        target: input.target,
        lmStudioUrl: input.lmStudioUrl,
        model: input.model,
        messages: buildSynthesisMessages({
          meta: input.bundle.meta,
          lens: input.lens,
          fileCount: paths.length,
          batchCount: job.batches.length,
          notes,
        }),
        temperature: Math.min(input.temperature, 0.3),
        signal: input.signal,
        onDelta: (chunk) => {
          mergeBuf += chunk;
          input.onStream(mergeBuf);
        },
      }),
      );
      const merged = parseReview(mergeText);
      if (merged.kind === "structured") parsed = merged;
    } catch {
      if (input.signal.aborted) {
        return partialOutcome(
          job,
          "Queue paused. Completed batches are saved — Resume to continue.",
          "paused",
        );
      }
    }
  }

  if (input.signal.aborted) {
    return partialOutcome(
      job,
      "Queue paused. Completed batches are saved — Resume to continue.",
      "paused",
    );
  }

  const stored = loadCheckpoint();
  if (stored?.id === job.id) clearCheckpoint();
  input.onCheckpoint(null);
  input.onProgress(null);
  return { status: "complete", result: parsed, providerLabel };
}
