import { Copy, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Finding, FindingSeverity, ReviewResult } from "@/lib/review/types";
import { reviewToMarkdown } from "@/lib/review/parse";
import { cn } from "@/lib/utils";

const SEVERITY_VARIANT: Record<
  FindingSeverity,
  "danger" | "warn" | "info" | "ok" | "outline"
> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
  info: "outline",
};

const SEVERITY_ORDER: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

function scoreTone(score: number) {
  if (score >= 78) return "text-ok";
  if (score >= 50) return "text-warn";
  return "text-danger";
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="rounded-xl bg-card p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[finding.severity]}>
          {finding.severity}
        </Badge>
        <Badge variant="outline">{finding.category}</Badge>
      </div>
      <h3 className="mt-3 text-base font-medium leading-snug">{finding.title}</h3>
      {finding.file ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">{finding.file}</p>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {finding.detail}
      </p>
      {finding.evidence ? (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-foreground/90">
          {finding.evidence}
        </pre>
      ) : null}
    </article>
  );
}

export function Report({
  owner,
  repo,
  result,
  streamText,
  reviewing,
  queueProgress,
}: {
  owner: string;
  repo: string;
  result: ReviewResult | null;
  streamText: string;
  reviewing: boolean;
  queueProgress?: {
    phase: "files" | "merge";
    batch: number;
    total: number;
    paths: string[];
  } | null;
}) {
  if (reviewing) {
    const label =
      queueProgress?.phase === "merge"
        ? `Merging ${queueProgress.total} batch reviews`
        : queueProgress && queueProgress.total > 1
          ? `Queue ${queueProgress.batch} of ${queueProgress.total}`
          : "Reading the cut";
    return (
      <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)] md:p-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {queueProgress?.paths.length ? (
          <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {queueProgress.paths.join(" · ")}
          </p>
        ) : null}
        {queueProgress && queueProgress.total > 1 ? (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{
                width: `${Math.round(
                  ((queueProgress.phase === "merge"
                    ? queueProgress.total
                    : queueProgress.batch - 1) /
                    queueProgress.total) *
                    100,
                )}%`,
              }}
            />
          </div>
        ) : null}
        <pre className="mt-4 max-h-[50vh] overflow-auto scroll-thin font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {streamText || "Waiting for the first tokens…"}
          <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-primary motion-safe:animate-pulse" />
        </pre>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl bg-card px-5 py-10 text-center shadow-[var(--shadow-border)]">
        <FileWarning className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 font-display text-xl">No review yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Choose a lens and run a review. The model only sees the files you
          selected.
        </p>
      </div>
    );
  }

  if (result.kind === "prose") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <CopyButton
            text={result.markdown}
            label="Copy"
          />
        </div>
        <article className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)] md:p-6">
          <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {result.markdown}
          </pre>
        </article>
      </div>
    );
  }

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: result.findings.filter((item) => item.severity === severity),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)] md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {result.verdict}
            </p>
            <h2 className="mt-2 font-display text-2xl leading-tight tracking-tight md:text-3xl">
              {result.headline}
            </h2>
          </div>
          <div className="text-right">
            <p className={cn("font-display text-5xl tabular-nums leading-none", scoreTone(result.score))}>
              {result.score}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">/ 100</p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {result.summary}
        </p>
        {result.stack.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {result.stack.map((item) => (
              <Badge key={item} variant="outline">
                {item}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-5">
          <CopyButton
            text={reviewToMarkdown(owner, repo, result)}
            label="Copy markdown"
          />
        </div>
      </section>

      {grouped.map((group) => (
        <section key={group.severity} className="space-y-3">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.severity} · {group.items.length}
          </h3>
          <div className="grid gap-3">
            {group.items.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        </section>
      ))}

      {result.strengths.length ? (
        <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Strengths
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {result.strengths.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-ok" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.questions.length ? (
        <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Open questions
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
            {result.questions.map((item) => (
              <li key={item}>— {item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        toast("Copied to clipboard");
      }}
    >
      <Copy />
      {label}
    </Button>
  );
}
