import { useMemo, useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Finding, StructuredReview } from "@/lib/review/types";
import type { BranchPushResult } from "@/lib/github/write";

function defaultSelected(findings: Finding[]): string[] {
  return findings
    .filter((finding) => finding.file && finding.severity !== "info")
    .map((finding) => finding.id);
}

export function ApplyFixesPanel({
  result,
  defaultBranch,
  applying,
  progress,
  applyResult,
  applyError,
  hasToken,
  writeHint,
  onApply,
}: {
  result: StructuredReview;
  defaultBranch: string;
  applying: boolean;
  progress: string | null;
  applyResult: BranchPushResult | null;
  applyError: string | null;
  hasToken: boolean;
  writeHint?: string;
  onApply: (findingIds: string[]) => void;
}) {
  const [ids, setIds] = useState(() => defaultSelected(result.findings));
  const selected = useMemo(
    () => result.findings.filter((finding) => ids.includes(finding.id)),
    [result.findings, ids],
  );
  const fileCount = new Set(selected.map((finding) => finding.file).filter(Boolean)).size;

  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Improve in the workspace
          </p>
          <h3 className="mt-1 font-display text-xl tracking-tight">
            Draft patches, then commit on quarry/*
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {writeHint ||
              `Quarry searches the tree, reads related files, and proposes diffs the way an editor agent would. You accept hunks in Workspace, then Quarry commits on quarry/* from the current ${defaultBranch} tip and opens a pull request. ${defaultBranch} is not updated.`}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => onApply(ids)}
          disabled={applying || selected.length === 0}
        >
          {applying ? <Loader2 className="animate-spin" /> : <GitBranch />}
          {applying ? "Drafting…" : `Draft ${fileCount} file${fileCount === 1 ? "" : "s"}`}
        </Button>
      </div>
      {!hasToken ? (
        <p className="mt-3 text-sm text-warn">
          Drafts work without a write token. Add Contents write and Pull
          requests write in Settings before committing.
        </p>
      ) : null}
      <ul className="mt-4 space-y-2">
        {result.findings.map((finding) => (
          <li key={finding.id}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={ids.includes(finding.id)}
                disabled={!finding.file}
                onChange={() =>
                  setIds((current) =>
                    current.includes(finding.id)
                      ? current.filter((id) => id !== finding.id)
                      : [...current, finding.id],
                  )
                }
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{finding.title}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {finding.file ?? "No file path — skipped"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {progress ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">{progress}</p>
      ) : null}
      {applyError ? <p className="mt-3 text-sm text-danger">{applyError}</p> : null}
      {applyResult ? (
        <p className="mt-3 text-sm">
          Pushed <code>{applyResult.branch}</code> from {applyResult.base}.{" "}
          {applyResult.prUrl ? (
            <a
              href={applyResult.prUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Open pull request
            </a>
          ) : (
            "Create a PR from that branch if the token cannot open one."
          )}
        </p>
      ) : null}
    </section>
  );
}
