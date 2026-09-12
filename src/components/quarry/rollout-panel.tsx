import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaybookEditor } from "@/components/quarry/playbook-editor";
import {
  CATALOG_BATCH_SIZES,
  catalogSessionLabel,
  DEFAULT_CATALOG_BATCH_SIZE,
  planCatalogRepos,
} from "@/lib/review/catalog";
import type { AccessibleRepo } from "@/lib/github/repos";
import type { Playbook } from "@/lib/playbook";
import type { ReviewQueueProgress } from "@/lib/review/queue";
import {
  isRolloutFinished,
  retryableErrorCount,
  rolloutCounts,
  rolloutErrorSummary,
  type RolloutJob,
} from "@/lib/review/rollout";

export function RolloutPanel({
  playbook,
  onPlaybook,
  pinCount,
  catalogRepos,
  catalogTruncated,
  lastReviewedAt,
  tokenReady,
  modelReady,
  searching,
  searchError,
  searchNote,
  onSearchPin,
  rollout,
  rolloutBusy,
  streamText,
  queueProgress,
  onStart,
  onStartCatalog,
  onResume,
  onStop,
  onDismiss,
  onRetryGithub,
}: {
  playbook: Playbook;
  onPlaybook: (playbook: Playbook) => void;
  pinCount: number;
  catalogRepos: AccessibleRepo[];
  catalogTruncated: boolean;
  lastReviewedAt: Record<string, number>;
  tokenReady: boolean;
  modelReady: boolean;
  searching: boolean;
  searchError: string | null;
  searchNote: string | null;
  onSearchPin: (query: string) => void;
  rollout: RolloutJob | null;
  rolloutBusy: boolean;
  streamText: string;
  queueProgress: ReviewQueueProgress | null;
  onStart: () => void;
  onStartCatalog: (repos: string[], batchSize: number) => void;
  onResume: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onRetryGithub: () => void;
}) {
  const [query, setQuery] = useState("warbot");
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_CATALOG_BATCH_SIZE);
  const [skipArchived, setSkipArchived] = useState(true);
  const [skipForks, setSkipForks] = useState(true);
  const [skipReviewed, setSkipReviewed] = useState(true);
  const unfinished = rollout && !isRolloutFinished(rollout);
  const counts = rollout ? rolloutCounts(rollout) : null;
  const retryable = rollout ? retryableErrorCount(rollout) : 0;
  const errorSummary = rollout ? rolloutErrorSummary(rollout) : [];
  const planned = planCatalogRepos(catalogRepos, {
    skipArchived,
    skipForks,
    skipReviewedSincePush: skipReviewed,
    lastReviewedAt,
  });

  return (
    <div className="mt-8 space-y-4">
      <PlaybookEditor
        playbook={playbook}
        onChange={onPlaybook}
        idPrefix="campaign-playbook"
        title="Campaign playbook"
        hint="Review-only. Up to four in-flight LM Studio completions. Catalog keeps going until every eligible repo is done — Stop is the only pause."
      />

      <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Find and pin
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Live GitHub code search across repositories this token can see. Hits
          are added to the watchlist.
        </p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchPin(query);
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="warbot"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Code search query"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={searching || !tokenReady}
          >
            {searching ? <Loader2 className="animate-spin" /> : null}
            Find and pin
          </Button>
        </form>
        {!tokenReady ? (
          <p className="mt-2 text-sm text-muted-foreground">
            A GitHub token is required to search code.
          </p>
        ) : null}
        {searchError ? (
          <p className="mt-2 text-sm text-danger">{searchError}</p>
        ) : null}
        {searchNote ? (
          <p className="mt-2 text-sm text-muted-foreground">{searchNote}</p>
        ) : null}
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Catalog batches
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Review the whole GitHub base this token can see, newest push first.
          It will not stop after 8 / 12 / 20 unless you pick a session size.
          No branches are written.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {catalogRepos.length
            ? `${planned.length} eligible of ${catalogRepos.length} listed${
                catalogTruncated ? " (list truncated)" : ""
              }. This run will take ${catalogSessionLabel(batchSize, planned.length)}.`
            : "Refresh Your repositories first so the catalog can load."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATALOG_BATCH_SIZES.map((size) => (
            <Button
              key={size}
              type="button"
              size="sm"
              variant={batchSize === size ? "secondary" : "ghost"}
              onClick={() => setBatchSize(size)}
            >
              {size <= 0 ? "All" : `${size} / session`}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={skipArchived}
              onChange={(e) => setSkipArchived(e.target.checked)}
            />
            Skip archived
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={skipForks}
              onChange={(e) => setSkipForks(e.target.checked)}
            />
            Skip forks
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={skipReviewed}
              onChange={(e) => setSkipReviewed(e.target.checked)}
            />
            Skip if reviewed since last push
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {rolloutBusy ? (
          <Button type="button" variant="secondary" onClick={onStop}>
            <Square />
            Stop rollout
          </Button>
        ) : unfinished ? (
          <Button type="button" onClick={onResume} disabled={!modelReady}>
            Resume {rollout?.source === "catalog" ? "catalog" : "pinned"} (
            {counts?.pending} left)
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onStart}
            disabled={!modelReady || pinCount < 1}
          >
            Review pinned ({pinCount})
          </Button>
        )}
        {!rolloutBusy && !unfinished ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onStartCatalog(planned, batchSize)}
            disabled={!modelReady || planned.length < 1}
          >
            Review catalog ({catalogSessionLabel(batchSize, planned.length)})
          </Button>
        ) : null}
        {rollout && !rolloutBusy ? (
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Clear campaign
          </Button>
        ) : null}
        {!rolloutBusy && retryable > 0 ? (
          <Button type="button" variant="secondary" onClick={onRetryGithub} disabled={!modelReady}>
            Retry GitHub errors ({retryable})
          </Button>
        ) : null}
      </div>

      {rollout ? (
        <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Rollout
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {counts
              ? `${counts.done} done · ${counts.error} error · ${counts.skipped} skipped · ${counts.pending} waiting of ${counts.total}`
              : null}
            {rollout.current ? ` · now ${rollout.current}` : null}
          </p>
          {errorSummary.length ? (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {errorSummary.slice(0, 4).map((item) => (
                <li key={item.message}>
                  {item.count}× {item.message}
                </li>
              ))}
            </ul>
          ) : null}
          {queueProgress ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {queueProgress.phase === "merge"
                ? "Merging file batches…"
                : `File batch ${queueProgress.batch}/${queueProgress.total}`}
              {queueProgress.paths.length
                ? ` · ${queueProgress.paths.join(", ")}`
                : ""}
            </p>
          ) : null}
          {streamText ? (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {streamText.slice(-2400)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
