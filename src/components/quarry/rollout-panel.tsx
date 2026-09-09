import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaybookEditor } from "@/components/quarry/playbook-editor";
import type { Playbook } from "@/lib/playbook";
import type { ReviewQueueProgress } from "@/lib/review/queue";
import {
  isRolloutFinished,
  rolloutCounts,
  type RolloutJob,
} from "@/lib/review/rollout";

export function RolloutPanel({
  playbook,
  onPlaybook,
  pinCount,
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
  onResume,
  onStop,
  onDismiss,
}: {
  playbook: Playbook;
  onPlaybook: (playbook: Playbook) => void;
  pinCount: number;
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
  onResume: () => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState("warbot");
  const unfinished = rollout && !isRolloutFinished(rollout);
  const counts = rollout ? rolloutCounts(rollout) : null;

  return (
    <div className="mt-8 space-y-4">
      <PlaybookEditor
        playbook={playbook}
        onChange={onPlaybook}
        idPrefix="campaign-playbook"
        title="Campaign playbook"
        hint="Used for every pinned repo unless that repo has its own playbook. Repos run one at a time on your local model."
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

      <div className="flex flex-wrap items-center gap-2">
        {rolloutBusy ? (
          <Button type="button" variant="secondary" onClick={onStop}>
            <Square />
            Stop rollout
          </Button>
        ) : unfinished ? (
          <Button type="button" onClick={onResume} disabled={!modelReady}>
            Resume pinned ({counts?.pending} left)
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
        {rollout && !rolloutBusy ? (
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Clear campaign
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
