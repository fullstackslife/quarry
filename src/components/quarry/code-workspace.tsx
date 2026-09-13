import { useMemo, useState } from "react";
import { Check, GitBranch, Loader2, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileTree } from "@/components/quarry/file-tree";
import { DiffView } from "@/components/quarry/diff-view";
import type { AgentLogItem } from "@/lib/agent/run";
import type { DraftFile } from "@/lib/workspace/buffer";
import { grepContents, grepPaths } from "@/lib/workspace/grep";
import { cn } from "@/lib/utils";

export function CodeWorkspace({
  paths,
  contents,
  drafts,
  openPath,
  onOpenPath,
  agentBusy,
  agentProgress,
  agentLog,
  committing,
  hasToken,
  draftError,
  onToggleDraft,
  onDiscardDraft,
  onCommitDrafts,
  onRunAgent,
  modelLabel,
}: {
  paths: string[];
  contents: Record<string, string>;
  drafts: DraftFile[];
  openPath: string | null;
  onOpenPath: (path: string) => void;
  agentBusy: boolean;
  agentProgress: string | null;
  agentLog: AgentLogItem[];
  committing: boolean;
  hasToken: boolean;
  draftError: string | null;
  onToggleDraft: (path: string, accepted: boolean) => void;
  onDiscardDraft: (path: string) => void;
  onCommitDrafts: () => void;
  onRunAgent: (instruction: string) => void;
  modelLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["src", "app", "lib"]));
  const [instruction, setInstruction] = useState("");
  const [showLog, setShowLog] = useState(false);
  const dirty = useMemo(() => new Set(drafts.map((item) => item.path)), [drafts]);
  const loaded = useMemo(() => new Set(Object.keys(contents)), [contents]);
  const acceptedCount = drafts.filter((item) => item.accepted).length;
  const draft = drafts.find((item) => item.path === openPath) ?? null;
  const fileText = openPath ? (draft?.proposed ?? contents[openPath] ?? "") : "";

  const searchHits = useMemo(() => {
    const q = query.trim();
    if (!q || q.length < 2) return [];
    const contentHits = grepContents({ contents, pattern: q, max: 24 });
    if (contentHits.length) return contentHits.map((hit) => `${hit.path}:${hit.line} ${hit.text}`);
    return grepPaths({ paths, pattern: q, max: 16 }).map((path) => `${path}: path`);
  }, [contents, paths, query]);

  function toggleDir(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="flex h-[min(78vh,820px)] min-h-[28rem] flex-col overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-border)] lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-border lg:w-72 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files or symbols"
            className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            aria-label="Search workspace"
          />
        </div>
        {searchHits.length ? (
          <ul className="max-h-32 overflow-y-auto border-b border-border px-2 py-2 text-[11px]">
            {searchHits.map((hit) => {
              const path = hit.split(":")[0] ?? "";
              return (
                <li key={hit}>
                  <button
                    type="button"
                    className="block w-full truncate rounded px-1 py-1 text-left font-mono text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => onOpenPath(path)}
                  >
                    {hit}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <FileTree
          paths={paths}
          query={query}
          expanded={expanded}
          onToggleDir={toggleDir}
          activePath={openPath}
          dirty={dirty}
          loaded={loaded}
          onOpen={onOpenPath}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <p className="truncate font-mono text-xs text-muted-foreground">
            {openPath || "Open a file from the tree"}
          </p>
          <div className="flex gap-2">
            {drafts.length ? (
              <Button
                type="button"
                size="sm"
                onClick={onCommitDrafts}
                disabled={committing || acceptedCount === 0 || !hasToken}
              >
                {committing ? <Loader2 className="animate-spin" /> : <GitBranch />}
                Commit {acceptedCount} on quarry/*
              </Button>
            ) : null}
          </div>
        </div>

        {drafts.length ? (
          <ul className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
            {drafts.map((item) => (
              <li key={item.path}>
                <label
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px]",
                    openPath === item.path ? "bg-secondary" : "bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={item.accepted}
                    onChange={() => onToggleDraft(item.path, !item.accepted)}
                  />
                  <button type="button" onClick={() => onOpenPath(item.path)}>
                    {item.path.split("/").pop()}
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard ${item.path}`}
                    onClick={() => onDiscardDraft(item.path)}
                  >
                    <X className="size-3" />
                  </button>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {draft ? (
            <DiffView draft={draft} />
          ) : fileText ? (
            <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-5 text-foreground/90">
              {fileText.split(/\r?\n/).slice(0, 400).map((line, i) => (
                <div key={i}>
                  <span className="mr-3 inline-block w-8 text-right text-muted-foreground">
                    {i + 1}
                  </span>
                  {line}
                </div>
              ))}
            </pre>
          ) : (
            <p className="px-2 py-8 text-sm text-muted-foreground">
              Search the tree, open a file, then describe an improvement. Quarry
              greps and patches like an editor agent, then you accept the diff
              before it lands on a quarry/* branch.
            </p>
          )}
        </div>

        {draftError ? (
          <p className="px-4 pb-2 text-sm text-danger">{draftError}</p>
        ) : null}
        {agentProgress ? (
          <p className="px-4 pb-2 font-mono text-xs text-muted-foreground">{agentProgress}</p>
        ) : null}

        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = instruction.trim();
            if (!text || agentBusy) return;
            onRunAgent(text);
            setInstruction("");
            setShowLog(true);
          }}
        >
          <label className="text-xs font-medium text-muted-foreground">
            Composer{modelLabel ? ` · ${modelLabel}` : ""}
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="Fix the auth token leak in src/…, add a test, or improve the selected finding."
            className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowLog((on) => !on)}
            >
              {showLog ? "Hide agent log" : "Show agent log"}
            </button>
            <Button type="submit" size="sm" disabled={agentBusy || !instruction.trim()}>
              {agentBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {agentBusy ? "Working…" : "Improve"}
            </Button>
          </div>
        </form>

        {showLog && agentLog.length ? (
          <ol className="max-h-40 overflow-auto border-t border-border px-3 py-2 text-[11px]">
            {agentLog.map((item, i) => (
              <li key={i} className="mb-2 whitespace-pre-wrap text-muted-foreground">
                <span className="font-medium text-foreground">
                  {item.role === "tool" ? "tool" : "model"}
                </span>
                {" · "}
                {item.text.slice(0, 600)}
              </li>
            ))}
          </ol>
        ) : null}

        {draft ? (
          <div className="flex gap-2 border-t border-border px-3 py-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onToggleDraft(draft.path, true)}
            >
              <Check />
              Keep
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onDiscardDraft(draft.path)}
            >
              Discard
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
