import { useState } from "react";
import { Check, Loader2, MessageSquarePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JobListItem, ReviewJob } from "@/lib/github/jobs";

export function IssuesPanel({
  job,
  issues,
  hasToken,
  busy,
  error,
  note,
  onSelect,
  onCreate,
  onAddress,
  onResolve,
}: {
  job: ReviewJob;
  issues: JobListItem[];
  hasToken: boolean;
  busy: boolean;
  error: string | null;
  note: string | null;
  onSelect: (item: JobListItem) => void;
  onCreate: (title: string, body: string) => void;
  onAddress: (item: JobListItem, extra: string) => void;
  onResolve: (item: JobListItem, extra: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState("");
  const active = job.kind === "issue" ? job.number : null;

  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Issues
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Open a ticket, comment while Quarry works it, then close it when the
        work is done. Selecting an issue still sets the review job.
      </p>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onCreate(title.trim(), body.trim());
          setTitle("");
          setBody("");
        }}
      >
        <Label htmlFor="issue-title">New issue</Label>
        <Input
          id="issue-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          disabled={!hasToken || busy}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Optional body"
          rows={3}
          disabled={!hasToken || busy}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={!hasToken || busy || !title.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          Open issue
        </Button>
      </form>

      {!hasToken ? (
        <p className="mt-3 text-sm text-warn">
          Issues write needs a GitHub token (classic <code>repo</code>, or
          fine-grained Issues: Write).
        </p>
      ) : null}

      {issues.length ? (
        <ul className="mt-4 max-h-52 space-y-1 overflow-y-auto scroll-thin">
          {issues.map((item) => {
            const selected = active === item.number;
            return (
              <li
                key={item.id}
                className={`rounded-lg px-2 py-2 ${selected ? "bg-secondary" : ""}`}
              >
                <button
                  type="button"
                  className="w-full truncate text-left text-sm"
                  disabled={busy}
                  onClick={() => onSelect(item)}
                >
                  #{item.number} {item.title}
                </button>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || !item.number}
                    onClick={() => onAddress(item, extra)}
                  >
                    <MessageSquarePlus />
                    Address
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || !item.number}
                    onClick={() => onResolve(item, extra)}
                  >
                    <Check />
                    Resolve
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No open issues.</p>
      )}

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="issue-note">Note on address / resolve</Label>
        <textarea
          id="issue-note"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Optional comment posted with Address or Resolve"
          rows={2}
          disabled={!hasToken || busy}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}
