import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  ExternalLink,
  GitFork,
  History,
  Loader2,
  Settings2,
  Square,
  Star,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileList } from "@/components/quarry/file-list";
import { QuarryMark } from "@/components/quarry/mark";
import { Report } from "@/components/quarry/report";
import { SettingsSheet } from "@/components/quarry/settings-sheet";
import { fetchFileContents, openRepo } from "@/lib/github/api";
import { parseRepoInput } from "@/lib/github/parse";
import { pickSmartFiles } from "@/lib/github/select";
import type { RepoBundle } from "@/lib/github/types";
import { loadHistory, pushHistory } from "@/lib/history";
import { getGrokAvailability } from "@/lib/llm/availability";
import { completeChat } from "@/lib/llm/complete";
import { probeLmStudio, type LmStatus } from "@/lib/llm/lmstudio";
import { parseReview } from "@/lib/review/parse";
import { buildReviewMessages } from "@/lib/review/prompt";
import {
  LENSES,
  type ReviewLens,
  type ReviewRecord,
  type ReviewResult,
} from "@/lib/review/types";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "@/lib/settings";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SUGGESTED = [
  "colinhacks/zod",
  "sindresorhus/ky",
  "porsager/postgres",
  "unjs/ofetch",
];

type Phase = "idle" | "loading" | "ready" | "reviewing";

function languageShare(languages: Record<string, number>) {
  const total = Object.values(languages).reduce((sum, n) => sum + n, 0) || 1;
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, bytes]) => ({
      name,
      pct: Math.round((bytes / total) * 100),
    }));
}

function formatStars(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function QuarryApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  const [lmStatus, setLmStatus] = useState<LmStatus>({ state: "unknown" });
  const [grokAvailable, setGrokAvailable] = useState<boolean | null>(null);
  const [source, setSource] = useState("");
  const [lens, setLens] = useState<ReviewLens>("full");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RepoBundle | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("overview");
  const [streamText, setStreamText] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [providerLabel, setProviderLabel] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const next = loadSettings();
    setSettings(next);
    setHistory(loadHistory());
    void getGrokAvailability().then((value) => setGrokAvailable(value.grok));
  }, []);

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  const resolvedTarget = useMemo<"lmstudio" | "grok" | null>(() => {
    if (settings.provider === "lmstudio") return "lmstudio";
    if (settings.provider === "grok") return grokAvailable ? "grok" : null;
    if (lmStatus.state === "online") return "lmstudio";
    if (grokAvailable) return "grok";
    if (grokAvailable === null && settings.provider === "auto") return "grok";
    return null;
  }, [settings.provider, lmStatus, grokAvailable]);

  async function loadRepo(raw: string, keepResult?: ReviewResult) {
    const identity = parseRepoInput(raw);
    if (!identity) {
      setError("Use owner/repo or a full GitHub URL.");
      return;
    }
    abortRef.current?.abort();
    setError(null);
    if (!keepResult) {
      setResult(null);
      setStreamText("");
    }
    setPhase("loading");
    setSource(`${identity.owner}/${identity.repo}`);
    try {
      const res = await openRepo({
        source: raw,
        token: settings.githubToken || undefined,
        lens,
        maxFiles: settings.maxFiles,
        maxChars: settings.maxChars,
      });
      if (!res.ok) {
        setPhase(bundle ? "ready" : "idle");
        setError(res.error);
        return;
      }
      setBundle(res.data);
      setSelected(res.data.selected);
      setContents(res.data.contents);
      setPhase("ready");
      if (keepResult) {
        setResult(keepResult);
        setTab("review");
      } else {
        setTab("overview");
      }
    } catch (err) {
      setPhase(bundle ? "ready" : "idle");
      setError(err instanceof Error ? err.message : "Could not open that repository.");
    }
  }

  function togglePath(path: string) {
    setSelected((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    );
  }

  function applySmart() {
    if (!bundle) return;
    setSelected(
      pickSmartFiles(bundle.files, lens, settings.maxFiles, settings.maxChars),
    );
  }

  async function ensureContents(paths: string[]) {
    if (!bundle) return contents;
    const missing = paths.filter((path) => !contents[path]);
    if (missing.length === 0) return contents;
    const res = await fetchFileContents({
      owner: bundle.meta.owner,
      repo: bundle.meta.repo,
      paths: missing,
      token: settings.githubToken || undefined,
    });
    if (!res.ok) {
      throw new Error(res.error);
    }
    const merged = { ...contents, ...res.data };
    setContents(merged);
    return merged;
  }

  async function runReview() {
    if (!bundle) return;
    if (!resolvedTarget) {
      setError(
        "No model is available. Connect LM Studio in Settings, or wait for hosted review.",
      );
      setSettingsOpen(true);
      return;
    }
    let target = resolvedTarget;
    let lmModels: string[] =
      lmStatus.state === "online" ? lmStatus.models : [];
    if (settings.provider === "lmstudio" && lmStatus.state !== "online") {
      const status = await probeLmStudio(settings.lmStudioUrl);
      setLmStatus(status);
      if (status.state !== "online") {
        setError(status.reason);
        setSettingsOpen(true);
        return;
      }
      lmModels = status.models;
      target = "lmstudio";
      if (!settings.lmStudioModel && status.models[0]) {
        updateSettings({ ...settings, lmStudioModel: status.models[0] });
      }
    }

    const paths = selected.slice(0, settings.maxFiles);
    if (paths.length === 0) {
      setError("Select at least one file to review.");
      setTab("files");
      return;
    }
    if (target !== "lmstudio" && target !== "grok") {
      setError("No model is available.");
      return;
    }

    setError(null);
    setResult(null);
    setStreamText("");
    setPhase("reviewing");
    setTab("review");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const loaded = await ensureContents(paths);
      const model =
        target === "lmstudio"
          ? settings.lmStudioModel || lmModels[0] || ""
          : "grok-4.5";
      if (target === "lmstudio" && !model) {
        throw new Error("Pick a loaded LM Studio model in Settings.");
      }

      const budget =
        target === "grok"
          ? Math.min(Math.max(settings.maxChars, 48_000), 140_000)
          : settings.maxChars;

      const messages = buildReviewMessages({
        meta: bundle.meta,
        languages: bundle.languages,
        allPaths: bundle.files.map((file) => file.path),
        contents: loaded,
        selected: paths,
        lens,
        maxChars: budget,
      });

      const label =
        target === "lmstudio" ? `LM Studio · ${model}` : "Grok 4.5";
      setProviderLabel(label);

      const text = await completeChat({
        target,
        lmStudioUrl: settings.lmStudioUrl,
        model,
        messages,
        temperature: settings.temperature,
        signal: controller.signal,
        onDelta: (chunk) => setStreamText((prev) => prev + chunk),
      });

      const parsed = parseReview(text);
      setResult(parsed);
      setPhase("ready");
      const record: ReviewRecord = {
        id: `${bundle.meta.owner}/${bundle.meta.repo}-${Date.now()}`,
        savedAt: Date.now(),
        owner: bundle.meta.owner,
        repo: bundle.meta.repo,
        description: bundle.meta.description,
        stars: bundle.meta.stars,
        language: bundle.meta.language,
        lens,
        providerLabel: label,
        result: parsed,
      };
      setHistory((current) => pushHistory(record, current));
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase("ready");
        return;
      }
      const message = err instanceof Error ? err.message : "Review failed.";
      setError(message);
      setPhase("ready");
    }
  }

  function cancelReview() {
    abortRef.current?.abort();
    setPhase("ready");
  }

  function reset() {
    abortRef.current?.abort();
    setBundle(null);
    setSelected([]);
    setContents({});
    setResult(null);
    setStreamText("");
    setError(null);
    setPhase("idle");
    setTab("overview");
  }

  const langs = bundle ? languageShare(bundle.languages) : [];
  const modelChip =
    lmStatus.state === "online"
      ? `LM Studio · ${settings.lmStudioModel || lmStatus.models[0] || "ready"}`
      : grokAvailable
        ? "Grok ready"
        : grokAvailable === false
          ? "No model"
          : "Checking";

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="safe-px safe-pt sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="flex min-h-11 items-center gap-2.5"
            >
              <QuarryMark className="size-7" />
              <span className="font-display text-lg tracking-tight">{APP_NAME}</span>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              {lmStatus.state === "online" || grokAvailable !== null ? (
                <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex">
                  {lmStatus.state === "online" ? (
                    <Wifi className="size-3.5 text-ok" />
                  ) : (
                    <WifiOff className="size-3.5" />
                  )}
                  {modelChip}
                </span>
              ) : null}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setHistoryOpen(true)}
                aria-label="History"
              >
                <History />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
              >
                <Settings2 />
              </Button>
            </div>
          </div>
        </header>

        <main className="safe-px safe-pb mx-auto flex w-full max-w-6xl flex-1 flex-col py-6 md:py-10">
          {phase === "idle" || (phase === "loading" && !bundle) ? (
            <Landing
              source={source}
              setSource={setSource}
              loading={phase === "loading"}
              error={error}
              onSubmit={() => void loadRepo(source)}
              onPick={(item) => void loadRepo(item)}
              lmStatus={lmStatus}
              grokAvailable={grokAvailable}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : bundle ? (
            <Workspace
              bundle={bundle}
              langs={langs}
              source={source}
              setSource={setSource}
              loading={phase === "loading"}
              reviewing={phase === "reviewing"}
              error={error}
              lens={lens}
              setLens={setLens}
              tab={tab}
              setTab={setTab}
              selected={selected}
              contents={contents}
              onToggle={togglePath}
              onSmart={applySmart}
              onLoad={() => void loadRepo(source)}
              onReview={() => void runReview()}
              onCancel={cancelReview}
              onReset={reset}
              result={result}
              streamText={streamText}
              providerLabel={providerLabel}
              resolvedTarget={resolvedTarget}
            />
          ) : null}
        </main>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        lmStatus={lmStatus}
        grokAvailable={grokAvailable}
        onLmStatus={setLmStatus}
      />

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        records={history}
        onOpen={(record) => {
          setHistoryOpen(false);
          setSource(`${record.owner}/${record.repo}`);
          setResult(record.result);
          setLens(record.lens);
          setProviderLabel(record.providerLabel);
          setTab("review");
          if (!bundle || bundle.meta.owner !== record.owner || bundle.meta.repo !== record.repo) {
            void loadRepo(`${record.owner}/${record.repo}`, record.result);
          } else {
            setPhase("ready");
          }
        }}
      />
    </TooltipProvider>
  );
}

function Landing({
  source,
  setSource,
  loading,
  error,
  onSubmit,
  onPick,
  lmStatus,
  grokAvailable,
  onOpenSettings,
}: {
  source: string;
  setSource: (value: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: () => void;
  onPick: (source: string) => void;
  lmStatus: LmStatus;
  grokAvailable: boolean | null;
  onOpenSettings: () => void;
}) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center pb-10">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Public repos. Local models.
      </p>
      <h1 className="mt-4 font-display text-4xl leading-none tracking-tight md:text-6xl">
        See the work as it actually is.
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
        Paste a public GitHub URL. Quarry reads the source and writes a structured
        review — using your LM Studio model, or Grok if no local server is running.
      </p>

      <form
        className="mt-8 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="github.com/owner/repo"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 text-base"
          aria-label="GitHub repository"
        />
        <Button type="submit" size="lg" disabled={loading} className="sm:min-w-28">
          {loading ? <Loader2 className="animate-spin" /> : null}
          Open
        </Button>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-danger">
          {error}{" "}
          {/token|rate/i.test(error) ? (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={onOpenSettings}
            >
              Open Settings
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTED.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="h-10 rounded-full border border-border px-3.5 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {lmStatus.state === "online" ? (
          <span className="inline-flex items-center gap-2 text-ok">
            <Wifi className="size-4" />
            LM Studio connected
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex min-h-11 items-center gap-2 text-left"
          >
            <WifiOff className="size-4" />
            {grokAvailable === false
              ? "Connect LM Studio in Settings to run reviews."
              : "Point Quarry at LM Studio in Settings. Until then, reviews use Grok."}
          </button>
        )}
      </div>
    </section>
  );
}

function Workspace({
  bundle,
  langs,
  source,
  setSource,
  loading,
  reviewing,
  error,
  lens,
  setLens,
  tab,
  setTab,
  selected,
  contents,
  onToggle,
  onSmart,
  onLoad,
  onReview,
  onCancel,
  onReset,
  result,
  streamText,
  providerLabel,
  resolvedTarget,
}: {
  bundle: RepoBundle;
  langs: { name: string; pct: number }[];
  source: string;
  setSource: (value: string) => void;
  loading: boolean;
  reviewing: boolean;
  error: string | null;
  lens: ReviewLens;
  setLens: (lens: ReviewLens) => void;
  tab: string;
  setTab: (tab: string) => void;
  selected: string[];
  contents: Record<string, string>;
  onToggle: (path: string) => void;
  onSmart: () => void;
  onLoad: () => void;
  onReview: () => void;
  onCancel: () => void;
  onReset: () => void;
  result: ReviewResult | null;
  streamText: string;
  providerLabel: string;
  resolvedTarget: "lmstudio" | "grok" | null;
}) {
  const { meta } = bundle;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad();
        }}
      >
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/repo"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="GitHub repository"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            Open
          </Button>
          <Button type="button" variant="ghost" onClick={onReset} aria-label="Close repo">
            <X />
          </Button>
        </div>
      </form>

      <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)] md:p-6">
        <div className="flex items-start gap-4">
          {meta.avatarUrl ? (
            <img
              src={meta.avatarUrl}
              alt=""
              className="size-12 rounded-xl outline outline-1 -outline-offset-1 outline-foreground/10"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="size-12 rounded-xl bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-display text-2xl tracking-tight md:text-3xl">
                {meta.owner}/{meta.repo}
              </h1>
              <a
                href={meta.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-4" />
                <span className="sr-only">Open on GitHub</span>
              </a>
            </div>
            {meta.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {meta.description}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Star className="size-3.5" />
                {formatStars(meta.stars)}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <GitFork className="size-3.5" />
                {formatStars(meta.forks)}
              </span>
              {meta.language ? <span>{meta.language}</span> : null}
              {meta.license ? <span>{meta.license}</span> : null}
            </div>
          </div>
        </div>
        {langs.length ? (
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="flex h-full w-full">
              {langs.map((lang, i) => (
                <span
                  key={lang.name}
                  className={cn(
                    "h-full",
                    i === 0 ? "bg-primary" : i === 1 ? "bg-ok/80" : "bg-info/60",
                  )}
                  style={{ width: `${Math.max(lang.pct, 2)}%` }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lens
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LENSES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLens(item.id)}
                className={cn(
                  "h-10 rounded-full px-3.5 text-sm transition-colors duration-150",
                  lens === item.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {providerLabel && result ? (
            <Badge variant="outline">{providerLabel}</Badge>
          ) : resolvedTarget === "grok" ? (
            <Badge variant="outline">Will use Grok</Badge>
          ) : resolvedTarget === "lmstudio" ? (
            <Badge variant="ok">Will use LM Studio</Badge>
          ) : (
            <Badge variant="warn">No model</Badge>
          )}
          {reviewing ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button type="button" onClick={onReview} disabled={loading}>
              Review {selected.length} files
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="flex-1">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview" className="flex-1 sm:flex-none">
            Overview
          </TabsTrigger>
          <TabsTrigger value="files" className="flex-1 sm:flex-none">
            Files
          </TabsTrigger>
          <TabsTrigger value="review" className="flex-1 sm:flex-none">
            Review
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="lg:grid lg:grid-cols-[minmax(0,280px)_1fr] lg:gap-6">
          <div className="hidden max-h-[70vh] lg:block">
            <FileList
              files={bundle.files}
              selected={selected}
              contents={contents}
              onToggle={onToggle}
              onSmart={onSmart}
              listedTruncated={bundle.listedTruncated}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
              <h2 className="font-display text-xl tracking-tight">What will be read</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Quarry sends the selected files, a tree excerpt, and repo metadata
                to the model. Nothing is stored on a server — history lives in this
                browser.
              </p>
              <ul className="mt-4 space-y-1.5 font-mono text-xs text-muted-foreground">
                {selected.slice(0, 12).map((path) => (
                  <li key={path} className="truncate">
                    {path}
                  </li>
                ))}
                {selected.length > 12 ? (
                  <li>+ {selected.length - 12} more</li>
                ) : null}
              </ul>
            </div>
            {bundle.treeTruncated ? (
              <p className="text-sm text-muted-foreground">
                GitHub truncated the git tree. Very large monorepos may hide files.
              </p>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="files" className="h-[70vh] rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
          <FileList
            files={bundle.files}
            selected={selected}
            contents={contents}
            onToggle={onToggle}
            onSmart={onSmart}
            listedTruncated={bundle.listedTruncated}
          />
        </TabsContent>
        <TabsContent value="review">
          <Report
            owner={meta.owner}
            repo={meta.repo}
            result={result}
            streamText={streamText}
            reviewing={reviewing}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HistorySheet({
  open,
  onOpenChange,
  records,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: ReviewRecord[];
  onOpen: (record: ReviewRecord) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-y-0 right-0 left-auto flex h-dvh w-full max-w-md flex-col rounded-none border-y-0 border-r-0 p-0">
        <div className="safe-px safe-pt flex items-start justify-between gap-4 pb-4 pt-6">
          <div>
            <DialogTitle>History</DialogTitle>
            <DialogDescription className="mt-1">
              Reviews stay on this device.
            </DialogDescription>
          </div>
          <DialogClose />
        </div>
        <div className="safe-px safe-pb flex-1 overflow-y-auto scroll-thin pb-10">
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="space-y-2">
              {records.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(record)}
                    className="flex min-h-14 w-full flex-col rounded-xl bg-muted px-4 py-3 text-left transition-colors duration-150 hover:bg-secondary"
                  >
                    <span className="font-medium">
                      {record.owner}/{record.repo}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {new Date(record.savedAt).toLocaleString()}
                      <span>{record.lens}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
