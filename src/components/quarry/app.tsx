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
import { buildReviewMessages, buildSynthesisMessages } from "@/lib/review/prompt";
import {
  checkpointId,
  checkpointMatchesRepo,
  clearCheckpoint,
  completedBatchCount,
  loadCheckpoint,
  pendingBatchIndexes,
  saveCheckpoint,
  writeBatchResult,
  type QueueCheckpoint,
} from "@/lib/review/checkpoint";
import {
  BATCH_MAX_CHARS,
  compactBatchForMerge,
  LM_STUDIO_CONCURRENCY,
  markPartialReview,
  mergeReviewResults,
  queueReviewBatches,
  runConcurrentIndexes,
  type ReviewQueueProgress,
} from "@/lib/review/queue";
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
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
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
  const [queueProgress, setQueueProgress] = useState<ReviewQueueProgress | null>(
    null,
  );
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [providerLabel, setProviderLabel] = useState("");
  const [checkpoint, setCheckpoint] = useState<QueueCheckpoint | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const checkpointRef = useRef<QueueCheckpoint | null>(null);
  const runningRef = useRef<Set<number>>(new Set());
  const streamBuffers = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const next = loadSettings();
    setSettings(next);
    setHistory(loadHistory());
    const saved = loadCheckpoint();
    checkpointRef.current = saved;
    setCheckpoint(saved);
    void getGrokAvailability().then((value) => setGrokAvailable(value.grok));
    void probeLmStudio(next.lmStudioUrl).then((status) => {
      setLmStatus(status);
      if (status.state === "online" && !next.lmStudioModel && status.models[0]) {
        const seeded = { ...next, lmStudioModel: status.models[0] };
        setSettings(seeded);
        saveSettings(seeded);
      }
    });
  }, []);

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (phase !== "reviewing") return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [phase]);

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
      const saved = checkpointRef.current;
      if (
        !keepResult &&
        saved &&
        checkpointMatchesRepo(saved, res.data.meta.owner, res.data.meta.repo)
      ) {
        setSelected(saved.selected);
        setLens(saved.lens);
        const parts = saved.results
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => item.result);
        if (parts.length) {
          setResult(
            markPartialReview(
              mergeReviewResults(parts),
              parts.length,
              saved.batches.length,
            ),
          );
          setTab("review");
        } else {
          setTab("overview");
        }
      } else {
        setSelected(res.data.selected);
        if (keepResult) {
          setResult(keepResult);
          setTab("review");
        } else {
          setTab("overview");
        }
      }
      setContents(res.data.contents);
      setPhase("ready");
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

  function toggleAllListed() {
    if (!bundle) return;
    const listed = bundle.files.map((file) => file.path);
    const allOn =
      listed.length > 0 && listed.every((path) => selected.includes(path));
    setSelected(allOn ? [] : listed);
  }

  async function ensureContents(
    paths: string[],
    base: Record<string, string> = contents,
  ) {
    if (!bundle) return base;
    const missing = paths.filter((path) => !base[path]);
    if (missing.length === 0) return base;
    const res = await fetchFileContents({
      owner: bundle.meta.owner,
      repo: bundle.meta.repo,
      paths: missing,
      token: settings.githubToken || undefined,
    });
    if (!res.ok) {
      throw new Error(res.error);
    }
    const merged = { ...base, ...res.data };
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

    const paths =
      target === "grok" ? selected.slice(0, settings.maxFiles) : selected;
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
    setQueueProgress(null);
    setPhase("reviewing");
    setTab("review");

    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = new Set();
    streamBuffers.current = new Map();

    const sizes = Object.fromEntries(
      bundle.files.map((file) => [file.path, file.size]),
    );

    function publishProgress(job: QueueCheckpoint) {
      const runningPaths = [...runningRef.current].flatMap(
        (index) => job.batches[index] ?? [],
      );
      const done = completedBatchCount(job);
      setCheckpoint(job);
      setQueueProgress({
        phase: "files",
        batch: Math.min(job.batches.length, done + runningRef.current.size),
        total: job.batches.length,
        paths: runningPaths,
      });
    }

    function showSavedPartial(job: QueueCheckpoint, message?: string) {
      const parts = job.results
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => item.result);
      if (parts.length) {
        setResult(
          markPartialReview(
            mergeReviewResults(parts),
            parts.length,
            job.batches.length,
          ),
        );
        setTab("review");
      }
      setQueueProgress(null);
      setPhase("ready");
      if (message) setError(message);
    }

    try {
      const model =
        target === "lmstudio"
          ? settings.lmStudioModel || lmModels[0] || ""
          : "grok-4.5";
      if (target === "lmstudio" && !model) {
        throw new Error("Pick a loaded LM Studio model in Settings.");
      }

      const label =
        target === "lmstudio" ? `LM Studio · ${model}` : "Grok 4.5";
      setProviderLabel(label);

      const batches =
        target === "lmstudio"
          ? queueReviewBatches(paths, contents, sizes)
          : [paths];
      const id = checkpointId({
        owner: bundle.meta.owner,
        repo: bundle.meta.repo,
        lens,
        selected: paths,
      });
      let job =
        checkpointRef.current && checkpointRef.current.id === id
          ? checkpointRef.current
          : {
              id,
              updatedAt: Date.now(),
              owner: bundle.meta.owner,
              repo: bundle.meta.repo,
              lens,
              model,
              selected: paths,
              batches,
              results: batches.map(() => null),
            };
      if (job.batches.length !== batches.length) {
        job = { ...job, batches, results: batches.map((_, i) => job.results[i] ?? null) };
      }
      checkpointRef.current = job;
      saveCheckpoint(job);
      setCheckpoint(job);

      let loaded = contents;
      let fetchLock = Promise.resolve();
      async function loadLocked(batchPaths: string[]) {
        const previous = fetchLock;
        let release = () => {};
        fetchLock = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          loaded = await ensureContents(batchPaths, loaded);
          return loaded;
        } finally {
          release();
        }
      }

      const pending = pendingBatchIndexes(job);
      publishProgress(job);

      await runConcurrentIndexes({
        indexes: pending,
        concurrency: target === "lmstudio" ? LM_STUDIO_CONCURRENCY : 1,
        signal: controller.signal,
        worker: async (index) => {
          const batchPaths = job.batches[index] ?? [];
          runningRef.current.add(index);
          publishProgress(checkpointRef.current ?? job);
          const batchContents = await loadLocked(batchPaths);
          const budget =
            target === "grok"
              ? Math.min(Math.max(settings.maxChars, 48_000), 140_000)
              : BATCH_MAX_CHARS;
          const messages = buildReviewMessages({
            meta: bundle.meta,
            languages: bundle.languages,
            allPaths: bundle.files.map((file) => file.path),
            contents: batchContents,
            selected: batchPaths,
            lens,
            maxChars: budget,
            treeLimit: job.batches.length > 1 ? 60 : 80,
            findingHint: job.batches.length > 1 ? "Write 3 to 8 findings." : undefined,
            batch:
              job.batches.length > 1
                ? { index: index + 1, total: job.batches.length }
                : undefined,
          });
          const text = await completeChat({
            target,
            lmStudioUrl: settings.lmStudioUrl,
            model,
            messages,
            temperature: settings.temperature,
            signal: controller.signal,
            onDelta: (chunk) => {
              const next = (streamBuffers.current.get(index) ?? "") + chunk;
              streamBuffers.current.set(index, next);
              const body = [...streamBuffers.current.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([batch, value]) => `--- batch ${batch + 1} ---\n${value.slice(-1800)}`)
                .join("\n\n");
              setStreamText(body);
            },
          });
          const parsedBatch = parseReview(text);
          const current = checkpointRef.current ?? job;
          const nextJob = writeBatchResult(current, index, parsedBatch);
          checkpointRef.current = nextJob;
          runningRef.current.delete(index);
          publishProgress(nextJob);
        },
      });

      if (controller.signal.aborted) {
        const current = checkpointRef.current;
        if (current) showSavedPartial(current, "Queue paused. Completed batches are saved — Resume to continue.");
        else setPhase("ready");
        return;
      }

      const finished = checkpointRef.current ?? job;
      const batchResults = finished.results.map((item) => item?.result).filter(
        (item): item is ReviewResult => Boolean(item),
      );
      let parsed = mergeReviewResults(batchResults);
      if (target === "lmstudio" && finished.batches.length > 1 && batchResults.length === finished.batches.length) {
        setQueueProgress({
          phase: "merge",
          batch: finished.batches.length,
          total: finished.batches.length,
          paths: [],
        });
        setStreamText("");
        const notes = finished.results.map((item, i) =>
          compactBatchForMerge(item?.result ?? { kind: "prose", markdown: "" }, finished.batches[i] ?? []),
        );
        try {
          const mergeText = await completeChat({
            target,
            lmStudioUrl: settings.lmStudioUrl,
            model,
            messages: buildSynthesisMessages({
              meta: bundle.meta,
              lens,
              fileCount: paths.length,
              batchCount: finished.batches.length,
              notes,
            }),
            temperature: Math.min(settings.temperature, 0.3),
            signal: controller.signal,
            onDelta: (chunk) => setStreamText((prev) => prev + chunk),
          });
          const merged = parseReview(mergeText);
          if (merged.kind === "structured") parsed = merged;
        } catch (err) {
          if (controller.signal.aborted) throw err;
        }
      }

      if (controller.signal.aborted) {
        showSavedPartial(finished, "Queue paused. Completed batches are saved — Resume to continue.");
        return;
      }

      if (batchResults.length < finished.batches.length) {
        showSavedPartial(
          finished,
          `Saved ${batchResults.length} of ${finished.batches.length} batches. Resume to finish.`,
        );
        return;
      }

      clearCheckpoint();
      checkpointRef.current = null;
      setCheckpoint(null);
      setQueueProgress(null);
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
      const current = checkpointRef.current;
      if (controller.signal.aborted) {
        if (current) {
          showSavedPartial(current, "Queue paused. Completed batches are saved — Resume to continue.");
        } else {
          setQueueProgress(null);
          setPhase("ready");
        }
        return;
      }
      const message = err instanceof Error ? err.message : "Review failed.";
      if (current && completedBatchCount(current) > 0) {
        showSavedPartial(current, `${message} Completed batches are saved — Resume to continue.`);
        return;
      }
      setError(message);
      setQueueProgress(null);
      setPhase("ready");
    }
  }

  function cancelReview() {
    abortRef.current?.abort();
  }

  function discardCheckpoint() {
    clearCheckpoint();
    checkpointRef.current = null;
    setCheckpoint(null);
    setError(null);
  }

  function reset() {
    abortRef.current?.abort();
    setBundle(null);
    setSelected([]);
    setContents({});
    setResult(null);
    setStreamText("");
    setQueueProgress(null);
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
              onSelectAll={toggleAllListed}
              onLoad={() => void loadRepo(source)}
              onReview={() => void runReview()}
              onCancel={cancelReview}
              onReset={reset}
              result={result}
              streamText={streamText}
              queueProgress={queueProgress}
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
        {APP_TAGLINE}
      </p>
      <h1 className="mt-4 font-display text-4xl leading-none tracking-tight md:text-6xl">
        See the work as it actually is.
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
        Paste a GitHub URL you can access. Quarry reads the source and writes a
        structured review — using your LM Studio model, or Grok if no local
        server is running. Private repos need a token in Settings.
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
          {/token|rate|private/i.test(error) ? (
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
  onSelectAll,
  onLoad,
  onReview,
  onCancel,
  onReset,
  result,
  streamText,
  queueProgress,
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
  onSelectAll: () => void;
  onLoad: () => void;
  onReview: () => void;
  onCancel: () => void;
  onReset: () => void;
  result: ReviewResult | null;
  streamText: string;
  queueProgress: ReviewQueueProgress | null;
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
              {meta.private ? (
                <Badge variant="warn">Private</Badge>
              ) : null}
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
              {resolvedTarget === "lmstudio" && selected.length > 6
                ? `Review ${selected.length} files in queue`
                : `Review ${selected.length} files`}
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
              onSelectAll={onSelectAll}
              listedTruncated={bundle.listedTruncated}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)]">
              <h2 className="font-display text-xl tracking-tight">What will be read</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Quarry queues selected files into small LM Studio jobs so the
                local model is not overloaded, then merges the findings. History
                stays in this browser.
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
            onSelectAll={onSelectAll}
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
            queueProgress={queueProgress}
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
