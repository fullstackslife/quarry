import { useMemo, useState } from "react";
import { Loader2, Lock, Pin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccessibleRepo } from "@/lib/github/repos";
import { filterAccessibleRepos } from "@/lib/github/repos";
import type { ReviewIndex } from "@/lib/history";

export type AccessibleReposState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      login: string | null;
      repos: AccessibleRepo[];
      truncated: boolean;
    };

function formatPushed(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AccessibleReposPanel({
  state,
  onPick,
  onRefresh,
  onOpenSettings,
  pins,
  onTogglePin,
  lastReviewed,
}: {
  state: AccessibleReposState;
  onPick: (source: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  pins: string[];
  onTogglePin: (fullName: string) => void;
  lastReviewed: Record<string, ReviewIndex>;
}) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<"all" | "private" | "public">(
    "all",
  );
  const [owner, setOwner] = useState("");
  const [language, setLanguage] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [stale, setStale] = useState(false);

  const owners = state.status === "ready"
    ? [...new Set(state.repos.map((item) => item.owner))].sort()
    : [];
  const languages = state.status === "ready"
    ? [...new Set(state.repos.map((item) => item.language).filter(Boolean) as string[])].sort()
    : [];

  const lastReviewedAt = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(lastReviewed)) out[key] = value.savedAt;
    return out;
  }, [lastReviewed]);

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    return filterAccessibleRepos(state.repos, query, visibility, {
      owner: owner || undefined,
      language: language || undefined,
      pins,
      pinnedOnly,
      stale,
      lastReviewedAt,
    });
  }, [state, query, visibility, owner, language, pins, pinnedOnly, stale, lastReviewedAt]);

  if (state.status === "idle") return null;

  const privateCount =
    state.status === "ready"
      ? state.repos.filter((item) => item.private).length
      : 0;

  return (
    <div className="mt-8 rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Your repositories
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.status === "ready"
              ? state.login
                ? `Signed in as ${state.login}. ${state.repos.length} repos this token can see${
                    privateCount ? ` · ${privateCount} private` : ""
                  }.`
                : `${state.repos.length} repos this token can see.`
              : "Listing repos the GitHub token can access, including private."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          Refresh
        </Button>
      </div>

      {state.status === "loading" ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading repositories…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="mt-4 text-sm text-danger">
          {state.error}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onOpenSettings}
          >
            Open Settings
          </button>
        </p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="mt-4 flex flex-col gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, language, or description"
              aria-label="Filter repositories"
            />
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["private", "Private"],
                  ["public", "Public"],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={visibility === id ? "secondary" : "ghost"}
                  onClick={() => setVisibility(id)}
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={pinnedOnly ? "secondary" : "ghost"}
                onClick={() => setPinnedOnly((value) => !value)}
              >
                Pinned
              </Button>
              <Button
                type="button"
                size="sm"
                variant={stale ? "secondary" : "ghost"}
                onClick={() => setStale((value) => !value)}
              >
                Pushed since last review
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-10 rounded-md border border-border bg-background px-2 text-sm"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                aria-label="Owner"
              >
                <option value="">All owners</option>
                {owners.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border border-border bg-background px-2 text-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Language"
              >
                <option value="">All languages</option>
                {languages.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {state.repos.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              This token cannot see any repositories. Grant it access to the
              repos you want to review, then refresh.
            </p>
          ) : (
            <ul className="mt-3 max-h-80 space-y-0.5 overflow-y-auto scroll-thin pr-1">
              {visible.map((item) => {
                const reviewed = lastReviewed[item.fullName.toLowerCase()];
                const pinned = pins.includes(item.fullName);
                return (
                  <li key={item.fullName} className="flex items-start gap-1">
                    <button
                      type="button"
                      className="mt-2 p-2 text-muted-foreground hover:text-foreground"
                      aria-label={pinned ? "Unpin" : "Pin"}
                      onClick={() => onTogglePin(item.fullName)}
                    >
                      <Pin className={`size-3.5 ${pinned ? "fill-current" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPick(item.fullName)}
                      className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm">{item.fullName}</span>
                          {item.private ? (
                            <Badge variant="warn" className="gap-1">
                              <Lock className="size-3" />
                              Private
                            </Badge>
                          ) : null}
                          {reviewed?.score != null ? (
                            <Badge variant="outline">{reviewed.score}</Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[item.language, formatPushed(item.pushedAt), item.description]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {visible.length === 0 && state.repos.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No repositories match that filter.
            </p>
          ) : null}
          {state.truncated ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing the first {state.repos.length} repositories. Filter or
              paste owner/repo for anything else.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
