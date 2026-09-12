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
import { JobPicker } from "@/components/quarry/job-picker";
import { IssuesPanel } from "@/components/quarry/issues-panel";
import { PlaybookEditor } from "@/components/quarry/playbook-editor";
import { CampaignsPanel } from "@/components/quarry/campaigns-panel";
import { RolloutPanel } from "@/components/quarry/rollout-panel";
import {
  OnboardPanel,
  type OnboardFormValues,
} from "@/components/quarry/onboard-panel";
import {
  AccessibleReposPanel,
  type AccessibleReposState,
} from "@/components/quarry/accessible-repos";
import { fetchFileContents, loadBundleAtRef, openRepo } from "@/lib/github/api";
import { listAccessibleRepos } from "@/lib/github/repos";
import { onboardGithubRepo, onboardPlaybook } from "@/lib/github/onboard";
import {
  addressGithubIssue,
  commentOnGithubIssue,
  createGithubIssue,
  createIssuesFromFindings,
  resolveGithubIssue,
} from "@/lib/github/issues";
import { searchCodeRepos } from "@/lib/github/search";
import {
  defaultReviewJob,
  extractMentionedPaths,
  formatJobDigest,
  listRepoJobs,
  resolveReviewJob,
  type JobListItem,
  type ReviewJob,
} from "@/lib/github/jobs";
import { formatContextDigest, loadRepoContext } from "@/lib/github/context";
import { appendPullBody, formatVerifySection, pollCommitChecks } from "@/lib/github/checks";
import { resolveFixWriteTarget } from "@/lib/github/write-target";
import { commitJobFixes, type BranchPushResult } from "@/lib/github/write";
import { parseFileChanges } from "@/lib/fix/parse";
import { buildFixFileMessages, groupFindingsByFile } from "@/lib/fix/prompt";
import { parseRepoInput } from "@/lib/github/parse";
import { pickSmartFiles } from "@/lib/github/select";
import type { RepoBundle } from "@/lib/github/types";
import {
  exportHistoryJson,
  exportHistoryMarkdown,
  lastReviewIndex,
  loadHistory,
  parseHistoryImport,
  pushHistory,
  saveHistory,
} from "@/lib/history";
import { buildOperatorDump, exportOperatorDumpJson } from "@/lib/sync/dump";
import { addWatchlistPins, loadWatchlist, toggleWatchlist } from "@/lib/watchlist";
import {
  emptyPlaybook,
  loadDefaultPlaybook,
  loadPlaybooks,
  playbookKey,
  resolvePlaybook,
  saveDefaultPlaybook,
  upsertPlaybook,
  type Playbook,
} from "@/lib/playbook";
import { groupCampaigns } from "@/lib/review/campaigns";
import { DEFAULT_CATALOG_BATCH_SIZE } from "@/lib/review/catalog";
import { getGrokAvailability } from "@/lib/llm/availability";
import { completeChat } from "@/lib/llm/complete";
import { probeLmStudio, type LmStatus } from "@/lib/llm/lmstudio";
import { pickReviewModel } from "@/lib/llm/lmstudio-url";
import { parseReview } from "@/lib/review/parse";
import { isEmptyRepoError } from "@/lib/github/throttle";
import { buildPatchReviewMessages } from "@/lib/review/prompt";
import {
  checkpointMatchesRepo,
  clearCheckpoint,
  completedBatchCount,
  loadCheckpoint,
  pendingBatchIndexes,
  type QueueCheckpoint,
} from "@/lib/review/checkpoint";
import {
  clampLmStudioConcurrency,
  createSlotLimiter,
  markPartialReview,
  mergeReviewResults,
  runConcurrentIndexes,
  type ReviewQueueProgress,
} from "@/lib/review/queue";
import { runQueuedReview } from "@/lib/review/run-queued";
import {
  clearRollout,
  createRollout,
  claimNextPendingRepo,
  recoverInterruptedRepos,
  requeueRetryableErrors,
  setRolloutPausedByUser,
  isRolloutFinished,
  loadRollout,
  markRolloutRepo,
  nextPendingRepo,
  rolloutCounts,
  saveRollout,
  type RolloutJob,
} from "@/lib/review/rollout";
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
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<BranchPushResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const abortFixRef = useRef<AbortController | null>(null);
  const checkpointRef = useRef<QueueCheckpoint | null>(null);
  const [accessible, setAccessible] = useState<AccessibleReposState>({
    status: "idle",
  });
  const [accessibleTick, setAccessibleTick] = useState(0);
  const [pins, setPins] = useState<string[]>([]);
  const [playbooks, setPlaybooks] = useState<Record<string, Playbook>>({});
  const [defaultPlaybook, setDefaultPlaybook] = useState<Playbook>(() => emptyPlaybook());
  const [rollout, setRollout] = useState<RolloutJob | null>(null);
  const [rolloutBusy, setRolloutBusy] = useState(false);
  const rolloutRef = useRef<RolloutJob | null>(null);
  const rolloutBusyRef = useRef(false);
  const [searchingCode, setSearchingCode] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [jobsTick, setJobsTick] = useState(0);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueNote, setIssueNote] = useState<string | null>(null);
  const [filingIssues, setFilingIssues] = useState(false);
  const [reviewJob, setReviewJob] = useState<ReviewJob | null>(null);
  const [jobLists, setJobLists] = useState<{
    pulls: JobListItem[];
    branches: JobListItem[];
    issues: JobListItem[];
  }>({ pulls: [], branches: [], issues: [] });
  const [jobLoading, setJobLoading] = useState(false);
  const [repoContext, setRepoContext] = useState("");
  const [patchResult, setPatchResult] = useState<ReviewResult | null>(null);
  const [verifySummary, setVerifySummary] = useState<string | null>(null);

  useEffect(() => {
    const next = loadSettings();
    setSettings(next);
    setHistory(loadHistory());
    setPins(loadWatchlist());
    setPlaybooks(loadPlaybooks());
    setDefaultPlaybook(loadDefaultPlaybook());
    setRollout(loadRollout());
    const saved = loadCheckpoint();
    checkpointRef.current = saved;
    setCheckpoint(saved);
    void getGrokAvailability().then((value) => setGrokAvailable(value.grok));
    void probeLmStudio(next.lmStudioUrl).then((status) => {
      setLmStatus(status);
      if (status.state !== "online") return;
      const picked = pickReviewModel(
        status.loaded,
        status.models,
        next.lmStudioModel,
      );
      if (picked && picked !== next.lmStudioModel) {
        const seeded = { ...next, lmStudioModel: picked };
        setSettings(seeded);
        saveSettings(seeded);
      }
    });
  }, []);

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (phase !== "reviewing" && !applying && !rolloutBusy) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [phase, applying, rolloutBusy]);

  useEffect(() => {
    rolloutRef.current = rollout;
  }, [rollout]);

  useEffect(() => {
    rolloutBusyRef.current = rolloutBusy;
  }, [rolloutBusy]);

  useEffect(() => {
    if (!rolloutBusy || !("wakeLock" in navigator)) return;
    let canceled = false;
    let sentinel: WakeLockSentinel | null = null;
    const grab = () => {
      void navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (canceled) {
            void lock.release();
            return;
          }
          sentinel = lock;
        })
        .catch(() => undefined);
    };
    grab();
    const onVisible = () => {
      if (document.visibilityState === "visible") grab();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      canceled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [rolloutBusy]);

  useEffect(() => {
    const token = settings.githubToken.trim();
    if (!token) {
      setAccessible({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAccessible({ status: "loading" });
      void listAccessibleRepos({ token, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return;
          if (!res.ok) {
            setAccessible({ status: "error", error: res.error });
            return;
          }
          setAccessible({
            status: "ready",
            login: res.data.login,
            repos: res.data.repos,
            truncated: res.data.truncated,
          });
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (controller.signal.aborted) return;
          setAccessible({
            status: "error",
            error:
              err instanceof Error
                ? err.message
                : "Could not list repositories.",
          });
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [settings.githubToken, accessibleTick]);

  useEffect(() => {
    if (!bundle) {
      setJobLists({ pulls: [], branches: [], issues: [] });
      return;
    }
    const token = settings.githubToken.trim();
    if (!token) return;
    const controller = new AbortController();
    void listRepoJobs({
      owner: bundle.meta.owner,
      repo: bundle.meta.repo,
      token,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted || !res.ok) return;
        setJobLists(res.data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [bundle, settings.githubToken, jobsTick]);

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

  async function loadRepo(
    raw: string,
    keepResult?: ReviewResult,
    playbookOverride?: Playbook,
  ) {
    const identity = parseRepoInput(raw);
    if (!identity) {
      setError("Use owner/repo or a full GitHub URL.");
      return;
    }
    if (!rolloutBusyRef.current) abortRef.current?.abort();
    abortFixRef.current?.abort();
    setApplying(false);
    setApplyProgress(null);
    setApplyResult(null);
    setApplyError(null);
    setError(null);
    if (!keepResult) {
      setResult(null);
      setStreamText("");
    }
    setPhase("loading");
    setSource(`${identity.owner}/${identity.repo}`);
    try {
      const playbook = resolvePlaybook(
        playbookOverride ??
          playbooks[playbookKey(identity.owner, identity.repo)],
        defaultPlaybook,
      );
      const reviewLens = playbook.lens ?? lens;
      if (playbookOverride?.lens) setLens(playbookOverride.lens);
      const res = await openRepo({
        source: raw,
        token: settings.githubToken || undefined,
        lens: reviewLens,
        maxFiles: settings.maxFiles,
        maxChars: settings.maxChars,
        playbook,
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
      setReviewJob(
        defaultReviewJob(res.data.meta.defaultBranch, res.data.headSha),
      );
      setPatchResult(null);
      setVerifySummary(null);
      setPhase("ready");
      const token = settings.githubToken.trim();
      if (token) {
        void loadRepoContext({
          owner: res.data.meta.owner,
          repo: res.data.meta.repo,
          token,
          sha: res.data.headSha,
          defaultBranch: res.data.meta.defaultBranch,
        }).then((digest) => setRepoContext(formatContextDigest(digest)));
      } else {
        setRepoContext("");
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
    const playbook = resolvePlaybook(
      playbooks[playbookKey(bundle.meta.owner, bundle.meta.repo)],
      defaultPlaybook,
    );
    const extras = [
      ...(reviewJob?.comparePaths ?? []),
      ...extractMentionedPaths(
        `${reviewJob?.body ?? ""}\n${(reviewJob?.comments ?? []).join("\n")}`,
        bundle.files.map((file) => file.path),
      ),
    ];
    setSelected(
      pickSmartFiles(bundle.files, lens, settings.maxFiles, settings.maxChars, {
        extraPaths: extras,
        playbook,
      }),
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
      ref: reviewJob?.sha || bundle.headSha,
    });
    if (!res.ok) {
      throw new Error(res.error);
    }
    const merged = { ...base, ...res.data };
    setContents(merged);
    return merged;
  }

  async function selectJob(item: JobListItem | { kind: "default" }) {
    if (!bundle) return;
    const token = settings.githubToken.trim();
    setJobLoading(true);
    setError(null);
    try {
      const resolved = await resolveReviewJob({
        owner: bundle.meta.owner,
        repo: bundle.meta.repo,
        token,
        defaultBranch: bundle.meta.defaultBranch,
        defaultSha: bundle.headSha,
        item,
      });
      if (!resolved.ok) {
        setError(resolved.error);
        return;
      }
      const playbook = resolvePlaybook(
        playbooks[playbookKey(bundle.meta.owner, bundle.meta.repo)],
        defaultPlaybook,
      );
      const tree = await loadBundleAtRef({
        owner: bundle.meta.owner,
        repo: bundle.meta.repo,
        token,
        ref: resolved.data.head,
        sha: resolved.data.sha,
        lens: playbook.lens ?? lens,
        maxFiles: settings.maxFiles,
        maxChars: settings.maxChars,
        extraPaths: resolved.data.comparePaths,
        playbook,
      });
      if (!tree.ok) {
        setError(tree.error);
        return;
      }
      const mentioned = extractMentionedPaths(
        `${resolved.data.body}\n${resolved.data.comments.join("\n")}`,
        tree.data.files.map((file) => file.path),
      );
      const selectedPaths = pickSmartFiles(
        tree.data.files,
        playbook.lens ?? lens,
        settings.maxFiles,
        settings.maxChars,
        {
          extraPaths: [...resolved.data.comparePaths, ...mentioned],
          playbook,
        },
      );
      setReviewJob(resolved.data);
      setBundle({
        ...bundle,
        files: tree.data.files,
        selected: selectedPaths,
        contents: tree.data.contents,
        treeTruncated: tree.data.treeTruncated,
        listedTruncated: tree.data.listedTruncated,
        headSha: resolved.data.sha,
        headRef: resolved.data.head,
      });
      setSelected(selectedPaths);
      setContents(tree.data.contents);
      if (token) {
        const digest = await loadRepoContext({
          owner: bundle.meta.owner,
          repo: bundle.meta.repo,
          token,
          sha: resolved.data.sha,
          defaultBranch: bundle.meta.defaultBranch,
        });
        setRepoContext(formatContextDigest(digest));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that job.");
    } finally {
      setJobLoading(false);
    }
  }

  async function withIssueToken() {
    const token = settings.githubToken.trim();
    if (!bundle) return null;
    if (!token) {
      setIssueError("Add a GitHub token with Issues write in Settings.");
      setSettingsOpen(true);
      return null;
    }
    return { token, owner: bundle.meta.owner, repo: bundle.meta.repo };
  }

  async function createWorkspaceIssue(title: string, body: string) {
    const ctx = await withIssueToken();
    if (!ctx) return;
    setIssueBusy(true);
    setIssueError(null);
    setIssueNote(null);
    try {
      const res = await createGithubIssue({ ...ctx, title, body });
      if (!res.ok) {
        setIssueError(res.error);
        return;
      }
      setIssueNote(`Opened #${res.data.number}: ${res.data.title}`);
      setJobsTick((n) => n + 1);
    } finally {
      setIssueBusy(false);
    }
  }

  async function addressWorkspaceIssue(item: JobListItem, extra: string) {
    const ctx = await withIssueToken();
    if (!ctx || !item.number) return;
    setIssueBusy(true);
    setIssueError(null);
    setIssueNote(null);
    try {
      const res = await addressGithubIssue({
        ...ctx,
        number: item.number,
        extra,
      });
      if (!res.ok) {
        setIssueError(res.error);
        return;
      }
      setIssueNote(`Commented on #${item.number}.`);
      await selectJob(item);
    } finally {
      setIssueBusy(false);
    }
  }

  async function resolveWorkspaceIssue(item: JobListItem, extra: string) {
    const ctx = await withIssueToken();
    if (!ctx || !item.number) return;
    setIssueBusy(true);
    setIssueError(null);
    setIssueNote(null);
    try {
      const res = await resolveGithubIssue({
        ...ctx,
        number: item.number,
        extra,
      });
      if (!res.ok) {
        setIssueError(res.error);
        return;
      }
      setIssueNote(`Closed #${item.number}.`);
      setJobsTick((n) => n + 1);
      if (reviewJob?.kind === "issue" && reviewJob.number === item.number) {
        await selectJob({ kind: "default" });
      }
    } finally {
      setIssueBusy(false);
    }
  }

  async function fileReviewFindings() {
    const ctx = await withIssueToken();
    if (!ctx || !result || result.kind !== "structured") return;
    setFilingIssues(true);
    setIssueError(null);
    setIssueNote(null);
    try {
      const res = await createIssuesFromFindings({
        ...ctx,
        findings: result.findings,
      });
      if (!res.ok) {
        setIssueError(res.error);
        setIssueNote(res.error);
        return;
      }
      const extra = res.data.warnings.length
        ? ` ${res.data.warnings.length} skipped.`
        : "";
      const note = `Opened ${res.data.issues.map((item) => `#${item.number}`).join(", ")}.${extra}`;
      setIssueNote(note);
      setJobsTick((n) => n + 1);
    } finally {
      setFilingIssues(false);
    }
  }

  async function resolveModelTarget(): Promise<{
    target: "lmstudio" | "grok";
    model: string;
  } | null> {
    let target = resolvedTarget;
    let lmModels: string[] =
      lmStatus.state === "online" ? lmStatus.models : [];
    if (settings.provider === "lmstudio" && lmStatus.state !== "online") {
      const status = await probeLmStudio(settings.lmStudioUrl);
      setLmStatus(status);
      if (status.state !== "online") {
        setError(status.reason);
        setSettingsOpen(true);
        return null;
      }
      lmModels = status.models;
      target = "lmstudio";
      if (!settings.lmStudioModel && status.models[0]) {
        updateSettings({ ...settings, lmStudioModel: status.models[0] });
      }
    }
    if (target !== "lmstudio" && target !== "grok") {
      setError(
        "No model is available. Connect LM Studio in Settings, or wait for hosted review.",
      );
      setSettingsOpen(true);
      return null;
    }
    const model =
      target === "lmstudio"
        ? settings.lmStudioModel || lmModels[0] || ""
        : "grok-4.5";
    if (target === "lmstudio" && !model) {
      setError("Pick a loaded LM Studio model in Settings.");
      setSettingsOpen(true);
      return null;
    }
    return { target, model };
  }

  function rememberCheckpoint(job: QueueCheckpoint | null) {
    checkpointRef.current = job;
    setCheckpoint(job);
  }

  async function runReview() {
    abortFixRef.current?.abort();
    setApplying(false);
    setApplyProgress(null);
    setApplyResult(null);
    setApplyError(null);
    if (!bundle) return;
    const prepared = await resolveModelTarget();
    if (!prepared) return;
    const paths =
      prepared.target === "grok" ? selected.slice(0, settings.maxFiles) : selected;
    if (paths.length === 0) {
      setError("Select at least one file to review.");
      setTab("files");
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
    try {
      const outcome = await runQueuedReview({
        bundle,
        selected: paths,
        contents,
        lens,
        target: prepared.target,
        lmStudioUrl: settings.lmStudioUrl,
        model: prepared.model,
        temperature: settings.temperature,
        maxFiles: settings.maxFiles,
        maxChars: settings.maxChars,
        concurrency: clampLmStudioConcurrency(settings.lmStudioConcurrency),
        jobDigest: reviewJob ? formatJobDigest(reviewJob) : undefined,
        contextDigest: repoContext || undefined,
        signal: controller.signal,
        existingCheckpoint: checkpointRef.current,
        onCheckpoint: rememberCheckpoint,
        onProgress: setQueueProgress,
        onStream: setStreamText,
        loadContents: (batchPaths, base) => ensureContents(batchPaths, base),
      });
      setProviderLabel(outcome.providerLabel);
      if (outcome.status === "complete" && outcome.result) {
        const reviewed = outcome.result;
        setQueueProgress(null);
        setResult(reviewed);
        setPhase("ready");
        setHistory((current) =>
          pushHistory(
            {
              id: `${bundle.meta.owner}/${bundle.meta.repo}-${Date.now()}`,
              savedAt: Date.now(),
              owner: bundle.meta.owner,
              repo: bundle.meta.repo,
              description: bundle.meta.description,
              stars: bundle.meta.stars,
              language: bundle.meta.language,
              lens,
              providerLabel: outcome.providerLabel,
              result: reviewed,
            },
            current,
          ),
        );
        return;
      }
      if (outcome.result) {
        setResult(outcome.result);
        setTab("review");
      }
      setQueueProgress(null);
      setPhase("ready");
      if (outcome.message) setError(outcome.message);
    } catch (err) {
      if (controller.signal.aborted) {
        setQueueProgress(null);
        setPhase("ready");
        return;
      }
      setError(err instanceof Error ? err.message : "Review failed.");
      setQueueProgress(null);
      setPhase("ready");
    }
  }

  async function createWorkspace(values: OnboardFormValues) {
    const token = settings.githubToken.trim();
    if (!token) {
      setOnboardError("Add a GitHub token in Settings to create repositories.");
      return;
    }
    setOnboardBusy(true);
    setOnboardError(null);
    try {
      const res = await onboardGithubRepo({
        token,
        kind: values.kind,
        title: values.title,
        name: values.name,
        owner: values.owner,
        brief: values.brief,
        private: values.private,
      });
      if (!res.ok) {
        setOnboardError(res.error);
        return;
      }
      const playbook = onboardPlaybook();
      setPlaybooks((current) =>
        upsertPlaybook(current, res.data.repo.owner, res.data.repo.repo, playbook),
      );
      setPins((current) => addWatchlistPins(current, [res.data.repo.fullName]));
      setAccessibleTick((n) => n + 1);
      if (res.data.warnings.length) {
        setOnboardError(res.data.warnings.join(" "));
      }
      await loadRepo(res.data.repo.fullName, undefined, playbook);
    } catch (err) {
      setOnboardError(
        err instanceof Error ? err.message : "Could not create that workspace.",
      );
    } finally {
      setOnboardBusy(false);
    }
  }

  async function findAndPin(query: string) {
    const token = settings.githubToken.trim();
    setSearchError(null);
    setSearchNote(null);
    setSearchingCode(true);
    try {
      const res = await searchCodeRepos({ query, token });
      if (!res.ok) {
        setSearchError(res.error);
        return;
      }
      setPins((current) => addWatchlistPins(current, res.data.repos));
      const extra = res.data.truncated
        ? " More matches exist; GitHub search is capped."
        : "";
      setSearchNote(
        res.data.repos.length
          ? `Pinned ${res.data.repos.length} repos from code search (${res.data.total} file hits).${extra}`
          : `No repositories matched “${query.trim()}”.`,
      );
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Code search failed.");
    } finally {
      setSearchingCode(false);
    }
  }

  async function runRollout(
    existing?: RolloutJob | null,
    opts?: { repos?: string[]; batchSize?: number; source?: "watchlist" | "catalog" },
  ) {
    const queue = opts?.repos ?? existing?.repos ?? pins;
    if (!queue.length) {
      setError("No repositories to review. Refresh the catalog or pin some first.");
      return;
    }
    const prepared = await resolveModelTarget();
    if (!prepared) return;
    if (rolloutBusyRef.current) return;
    rolloutBusyRef.current = true;
    let job: RolloutJob | null = null;

    try {
    const token = settings.githubToken.trim();
    const batchSize =
      opts?.batchSize ??
      existing?.batchSize ??
      (opts?.source === "catalog" || existing?.source === "catalog"
        ? DEFAULT_CATALOG_BATCH_SIZE
        : queue.length);
    const recovered = existing
      ? requeueRetryableErrors(
          recoverInterruptedRepos({
            ...existing,
            pausedByUser: false,
            batchSize:
              existing.source === "catalog" || opts?.source === "catalog"
                ? 0
                : existing.batchSize,
          }),
        )
      : null;
    job =
      recovered && !isRolloutFinished(recovered)
        ? recovered
        : createRollout(queue, defaultPlaybook.lens ?? lens, defaultPlaybook, {
            source: opts?.source ?? existing?.source ?? "watchlist",
            batchSize:
              opts?.source === "catalog" || existing?.source === "catalog"
                ? 0
                : batchSize,
          });
    if (!job) return;
    saveRollout(job);
    setRollout(job);
    setRolloutBusy(true);
    setError(null);
    setStreamText("");
    setQueueProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const slots =
      prepared.target === "lmstudio"
        ? clampLmStudioConcurrency(settings.lmStudioConcurrency)
        : 1;
    const limiter = createSlotLimiter(slots);
    let claimedThisSession = 0;
    const sessionCap =
      job.source === "catalog" || !(job.batchSize && job.batchSize > 0)
        ? Number.POSITIVE_INFINITY
        : job.batchSize;
    let gate = Promise.resolve();
    const mutateJob = (fn: (current: RolloutJob) => RolloutJob) => {
      const next = gate.then(() => {
        const current = job;
        if (!current) throw new Error("Catalog job missing.");
        job = fn(current);
        setRollout(job);
        return job;
      });
      gate = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
    const claimRepo = async (): Promise<string | null> => {
      let picked: string | null = null;
      await mutateJob((current) => {
        if (controller.signal.aborted || claimedThisSession >= sessionCap) {
          return current;
        }
        const claimed = claimNextPendingRepo(current);
        if (!claimed) return current;
        claimedThisSession += 1;
        picked = claimed.repo;
        return claimed.job;
      });
      return picked;
    };

    const reviewOne = async (fullName: string, attempt = 0) => {
      const identity = parseRepoInput(fullName);
      if (!identity) {
        await mutateJob((current) =>
          markRolloutRepo(current, fullName, "skipped", "Invalid repository name."),
        );
        return;
      }
      const playbook = resolvePlaybook(
        playbooks[playbookKey(identity.owner, identity.repo)],
        job?.playbook ?? defaultPlaybook,
      );
      const reviewLens = playbook.lens ?? job?.lens ?? lens;
      const opened = await openRepo({
        source: fullName,
        token: token || undefined,
        lens: reviewLens,
        maxFiles: settings.maxFiles,
        maxChars: settings.maxChars,
        playbook,
      });
      if (!opened.ok) {
        if (isEmptyRepoError(opened.error)) {
          await mutateJob((current) =>
            markRolloutRepo(current, fullName, "skipped", opened.error),
          );
          return;
        }
        await mutateJob((current) =>
          markRolloutRepo(current, fullName, "error", opened.error),
        );
        return;
      }
      if (opened.data.selected.length === 0) {
        await mutateJob((current) =>
          markRolloutRepo(
            current,
            fullName,
            "skipped",
            "No files matched the playbook.",
          ),
        );
        return;
      }

      try {
        const saved = checkpointRef.current;
        const outcome = await runQueuedReview({
          bundle: opened.data,
          selected: opened.data.selected,
          contents: opened.data.contents,
          lens: reviewLens,
          target: prepared.target,
          lmStudioUrl: settings.lmStudioUrl,
          model: prepared.model,
          temperature: settings.temperature,
          maxFiles: settings.maxFiles,
          maxChars: settings.maxChars,
          concurrency: slots,
          signal: controller.signal,
          existingCheckpoint: checkpointMatchesRepo(
            saved,
            opened.data.meta.owner,
            opened.data.meta.repo,
          )
            ? saved
            : null,
          onCheckpoint: (next) => {
            if (
              next === null &&
              checkpointRef.current &&
              !checkpointMatchesRepo(
                checkpointRef.current,
                opened.data.meta.owner,
                opened.data.meta.repo,
              )
            ) {
              return;
            }
            rememberCheckpoint(next);
          },
          onProgress: (progress) => {
            setQueueProgress(
              progress
                ? {
                    ...progress,
                    paths: progress.paths.length
                      ? progress.paths
                      : [fullName],
                  }
                : progress,
            );
          },
          onStream: (text) => setStreamText(`${fullName}\n${text}`),
          limitSlot: (work) => limiter.run(work),
          loadContents: async (batchPaths, base) => {
            const missing = batchPaths.filter((path) => !base[path]);
            if (missing.length === 0) return base;
            const res = await fetchFileContents({
              owner: opened.data.meta.owner,
              repo: opened.data.meta.repo,
              paths: missing,
              token: token || undefined,
              ref: opened.data.headSha,
            });
            if (!res.ok) throw new Error(res.error);
            return { ...base, ...res.data };
          },
        });
        setProviderLabel(outcome.providerLabel);
        if (outcome.status === "complete" && outcome.result) {
          const reviewed = outcome.result;
          setHistory((current) =>
            pushHistory(
              {
                id: `${opened.data.meta.owner}/${opened.data.meta.repo}-${Date.now()}`,
                savedAt: Date.now(),
                owner: opened.data.meta.owner,
                repo: opened.data.meta.repo,
                description: opened.data.meta.description,
                stars: opened.data.meta.stars,
                language: opened.data.meta.language,
                lens: reviewLens,
                providerLabel: outcome.providerLabel,
                result: reviewed,
              },
              current,
            ),
          );
          await mutateJob((current) => markRolloutRepo(current, fullName, "done"));
        } else if (outcome.status === "paused") {
          await mutateJob((current) =>
            markRolloutRepo(current, fullName, "pending"),
          );
          if (controller.signal.aborted) {
            if (outcome.message) setError(outcome.message);
            return;
          }
        } else {
          if (attempt < 3 && !controller.signal.aborted) {
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
            await reviewOne(fullName, attempt + 1);
            return;
          }
          await mutateJob((current) =>
            markRolloutRepo(
              current,
              fullName,
              "error",
              outcome.message || "Review did not finish.",
            ),
          );
        }
      } catch (err) {
        if (controller.signal.aborted) {
          await mutateJob((current) =>
            markRolloutRepo(current, fullName, "pending"),
          );
          return;
        }
        const message = err instanceof Error ? err.message : "Review failed.";
        const transient = /abort|network|fetch|timeout|502|503|429|overload/i.test(
          message,
        );
        if (transient && attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 4000));
          if (!controller.signal.aborted) {
            await reviewOne(fullName, attempt + 1);
            return;
          }
        }
        await mutateJob((current) =>
          markRolloutRepo(current, fullName, "error", message),
        );
      }
    };

    await runConcurrentIndexes({
        indexes: Array.from({ length: slots }, (_, i) => i),
        concurrency: slots,
        signal: controller.signal,
        worker: async () => {
          while (!controller.signal.aborted) {
            const fullName = await claimRepo();
            if (!fullName) return;
            await reviewOne(fullName);
          }
        },
      });
      if (
        !controller.signal.aborted &&
        claimedThisSession >= sessionCap &&
        nextPendingRepo(job)
      ) {
        const left = rolloutCounts(job).pending;
        setSearchNote(
          `Review-only batch finished (${claimedThisSession}). ${left} waiting. Resume for the next session.`,
        );
      }
    } finally {
      rolloutBusyRef.current = false;
      setRolloutBusy(false);
      setQueueProgress(null);
      if (job && isRolloutFinished(job)) {
        const counts = rolloutCounts(job);
        setSearchNote(
          `Rollout finished: ${counts.done} reviewed, ${counts.error} error, ${counts.skipped} skipped.`,
        );
      }
    }
  }

  function dismissRollout() {
    clearRollout();
    setRollout(null);
  }
  function cancelReview() {
    const current = rolloutRef.current;
    if (current && rolloutBusyRef.current) {
      setRollout(setRolloutPausedByUser(current, true));
    }
    abortRef.current?.abort();
    abortFixRef.current?.abort();
  }

  useEffect(() => {
    if (lmStatus.state !== "online") return;
    if (rolloutBusyRef.current) return;
    const stored = loadRollout();
    if (!stored || stored.source !== "catalog" || stored.pausedByUser) return;
    const recovered = requeueRetryableErrors(recoverInterruptedRepos(stored));
    if (isRolloutFinished(recovered)) return;
    void runRollout(recovered);
  }, [lmStatus.state]);

  async function runApplyFixes(findingIds: string[]) {
    if (!bundle || !result || result.kind !== "structured") return;
    const token = settings.githubToken.trim();
    if (!token) {
      setApplyError(
        "Add a GitHub token with Contents write and Pull requests write.",
      );
      setSettingsOpen(true);
      return;
    }
    const findings = result.findings.filter(
      (finding) => findingIds.includes(finding.id) && finding.file,
    );
    const groups = groupFindingsByFile(findings);
    if (groups.size === 0) {
      setApplyError("Select findings that include a file path.");
      return;
    }
    if (!resolvedTarget) {
      setApplyError(
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
        setApplyError(status.reason);
        setSettingsOpen(true);
        return;
      }
      lmModels = status.models;
      target = "lmstudio";
      if (!settings.lmStudioModel && status.models[0]) {
        updateSettings({ ...settings, lmStudioModel: status.models[0] });
      }
    }

    const controller = new AbortController();
    abortFixRef.current = controller;
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    setPatchResult(null);
    setVerifySummary(null);
    setTab("review");

    try {
      const paths = [...groups.keys()];
      const loaded = await ensureContents(paths, contents);
      const changes = [];
      let index = 0;
      const model =
        target === "lmstudio"
          ? settings.lmStudioModel || lmModels[0] || ""
          : "grok-4.5";

      for (const [path, fileFindings] of groups) {
        index += 1;
        setApplyProgress(`Rewriting ${index}/${groups.size} · ${path}`);
        const current = loaded[path];
        if (!current?.trim()) {
          throw new Error(`Could not load ${path} from GitHub.`);
        }
        const text = await completeChat({
          target,
          lmStudioUrl: settings.lmStudioUrl,
          model,
          messages: buildFixFileMessages({
            owner: bundle.meta.owner,
            repo: bundle.meta.repo,
            path,
            current,
            findings: fileFindings,
          }),
          temperature: 0.1,
          signal: controller.signal,
          onDelta: () => {},
        });
        const parsed = parseFileChanges(text).filter((file) => file.path === path);
        const next = parsed[0];
        if (!next) {
          throw new Error(`The model did not return a valid update for ${path}.`);
        }
        changes.push(next);
      }

      const jobHead = reviewJob?.head || bundle.meta.defaultBranch;
      const jobBase = reviewJob?.base || bundle.meta.defaultBranch;
      setApplyProgress(`Writing quarry/* from ${jobHead}`);
      const pushed = await commitJobFixes({
        owner: bundle.meta.owner,
        repo: bundle.meta.repo,
        token,
        defaultBranch: bundle.meta.defaultBranch,
        jobHead,
        jobBase,
        parentSha: reviewJob?.sha || bundle.headSha,
        message: `fix: quarry review patches (${changes.length} files)`,
        files: changes,
        prTitle: reviewJob?.number
          ? `Quarry: ${reviewJob.title}`
          : `Quarry fixes for ${bundle.meta.owner}/${bundle.meta.repo}`,
        prBody: [
          `Job: ${reviewJob?.kind ?? "default"} \`${jobHead}\`. PR base \`${jobBase}\`. Default branch was not modified.`,
          reviewJob?.kind === "issue" && reviewJob.number
            ? `Closes #${reviewJob.number}`
            : "",
          "",
          "Findings:",
          ...findings.map(
            (finding) => `- ${finding.title} (\`${finding.file}\`)`,
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      });
      if (!pushed.ok) {
        setApplyError(pushed.error);
        return;
      }
      setApplyResult(pushed.data);
      const written = Object.fromEntries(changes.map((file) => [file.path, file.content]));
      setApplyProgress("Re-reviewing the patch…");
      try {
        const patchText = await completeChat({
          target,
          lmStudioUrl: settings.lmStudioUrl,
          model,
          messages: buildPatchReviewMessages({
            meta: bundle.meta,
            lens,
            paths: changes.map((file) => file.path),
            contents: written,
            maxChars: 16_000,
          }),
          temperature: 0.1,
          signal: controller.signal,
          onDelta: () => {},
        });
        setPatchResult(parseReview(patchText));
      } catch {
        setPatchResult(null);
      }
      if (pushed.data.prNumber) {
        setApplyProgress("Checking GitHub status…");
        const checks = await pollCommitChecks({
          owner: bundle.meta.owner,
          repo: bundle.meta.repo,
          token,
          sha: pushed.data.commitSha,
          attempts: 3,
          delayMs: 2000,
        });
        const section = formatVerifySection(checks);
        setVerifySummary(section);
        await appendPullBody({
          owner: bundle.meta.owner,
          repo: bundle.meta.repo,
          token,
          number: pushed.data.prNumber,
          extra: section,
        });
      }
      if (
        reviewJob?.kind === "issue" &&
        reviewJob.number &&
        (pushed.data.prUrl || pushed.data.commitSha)
      ) {
        try {
          await commentOnGithubIssue({
            owner: bundle.meta.owner,
            repo: bundle.meta.repo,
            token,
            number: reviewJob.number,
            body: [
              "Quarry opened a fix for this issue.",
              pushed.data.prUrl ? `Pull request: ${pushed.data.prUrl}` : "",
              `Commit: \`${pushed.data.commitSha.slice(0, 8)}\` on \`${pushed.data.branch}\`.`,
              "Close this issue after the PR merges, or Resolve it from Quarry.",
            ]
              .filter(Boolean)
              .join("\n"),
          });
        } catch {
          // The PR already landed; a missing issue comment is not a failed apply.
        }
      }
      setApplyProgress(null);
    } catch (err) {
      if (controller.signal.aborted) {
        setApplyError("Apply cancelled.");
        return;
      }
      setApplyError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setApplying(false);
      if (abortFixRef.current === controller) abortFixRef.current = null;
    }
  }

  function discardCheckpoint() {
    clearCheckpoint();
    checkpointRef.current = null;
    setCheckpoint(null);
    setError(null);
  }

  function reset() {
    abortRef.current?.abort();
    abortFixRef.current?.abort();
    setBundle(null);
    setSelected([]);
    setContents({});
    setResult(null);
    setStreamText("");
    setQueueProgress(null);
    setApplying(false);
    setApplyProgress(null);
    setApplyResult(null);
    setApplyError(null);
    setReviewJob(null);
    setRepoContext("");
    setPatchResult(null);
    setVerifySummary(null);
    setIssueError(null);
    setIssueNote(null);
    setError(null);
    setPhase("idle");
    setTab("overview");
  }

  const langs = bundle ? languageShare(bundle.languages) : [];
  const reviewedIndex = lastReviewIndex(history);
  const campaigns = groupCampaigns(history);
  const currentPlaybook = bundle
    ? playbooks[playbookKey(bundle.meta.owner, bundle.meta.repo)] ?? emptyPlaybook()
    : emptyPlaybook();
  let writeHint: string | undefined;
  if (bundle && reviewJob) {
    try {
      const target = resolveFixWriteTarget({
        defaultBranch: bundle.meta.defaultBranch,
        jobHead: reviewJob.head,
        jobBase: reviewJob.base,
      });
      writeHint =
        target.mode === "update"
          ? `Will commit on existing ${target.branch} (PR base ${target.prBase}). Never writes to ${bundle.meta.defaultBranch}.`
          : `Will create ${target.branch} from ${reviewJob.head} and open a PR into ${target.prBase}. Never writes to ${bundle.meta.defaultBranch}.`;
    } catch {
      writeHint = undefined;
    }
  }
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
              checkpoint={checkpoint}
              onSubmit={() => void loadRepo(source)}
              onPick={(item) => void loadRepo(item)}
              onResumeSaved={() => {
                if (!checkpoint) return;
                void loadRepo(`${checkpoint.owner}/${checkpoint.repo}`);
              }}
              onDiscardSaved={discardCheckpoint}
              lmStatus={lmStatus}
              grokAvailable={grokAvailable}
              onOpenSettings={() => setSettingsOpen(true)}
              accessible={accessible}
              onRefreshAccessible={() => setAccessibleTick((n) => n + 1)}
              pins={pins}
              onTogglePin={(name) => setPins((current) => toggleWatchlist(current, name))}
              lastReviewed={reviewedIndex}
              campaigns={campaigns}
              defaultPlaybook={defaultPlaybook}
              onDefaultPlaybook={(next) => {
                setDefaultPlaybook(next);
                saveDefaultPlaybook(next);
              }}
              tokenReady={Boolean(settings.githubToken.trim())}
              modelReady={resolvedTarget !== null}
              searching={searchingCode}
              searchError={searchError}
              searchNote={searchNote}
              onSearchPin={(query) => void findAndPin(query)}
              onCreateWorkspace={(values) => void createWorkspace(values)}
              onboardBusy={onboardBusy}
              onboardError={onboardError}
              githubToken={settings.githubToken}
              rollout={rollout}
              rolloutBusy={rolloutBusy}
              streamText={streamText}
              queueProgress={queueProgress}
              onStartRollout={() => void runRollout()}
              onStartCatalog={(repos, batchSize) =>
                void runRollout(null, {
                  repos,
                  batchSize,
                  source: "catalog",
                })
              }
              onResumeRollout={() => void runRollout(rollout)}
              onRetryGithub={() => void runRollout(rollout)}
              onStopRollout={cancelReview}
              onDismissRollout={dismissRollout}
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
              onDiscardSaved={discardCheckpoint}
              checkpoint={checkpoint}
              onReset={reset}
              result={result}
              streamText={streamText}
              queueProgress={queueProgress}
              providerLabel={providerLabel}
              resolvedTarget={resolvedTarget}
              applying={applying}
              applyProgress={applyProgress}
              applyResult={applyResult}
              applyError={applyError}
              hasGithubToken={Boolean(settings.githubToken.trim())}
              onApplyFixes={runApplyFixes}
              reviewJob={reviewJob}
              jobLists={jobLists}
              jobLoading={jobLoading}
              onSelectJob={(item) => void selectJob(item)}
              onDefaultJob={() => void selectJob({ kind: "default" })}
              issueBusy={issueBusy}
              issueError={issueError}
              issueNote={issueNote}
              onCreateIssue={(title, body) => void createWorkspaceIssue(title, body)}
              onAddressIssue={(item, extra) => void addressWorkspaceIssue(item, extra)}
              onResolveIssue={(item, extra) => void resolveWorkspaceIssue(item, extra)}
              filingIssues={filingIssues}
              onFileFindings={() => void fileReviewFindings()}
              playbook={currentPlaybook}
              onPlaybook={(next) =>
                bundle &&
                setPlaybooks((current) =>
                  upsertPlaybook(current, bundle.meta.owner, bundle.meta.repo, next),
                )
              }
              repoContext={repoContext}
              writeHint={writeHint}
              patchResult={patchResult}
              verifySummary={verifySummary}
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
        watchlist={pins}
        playbooks={playbooks}
        defaultPlaybook={defaultPlaybook}
        onImport={(records) => setHistory(records)}
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
  checkpoint,
  onSubmit,
  onPick,
  onResumeSaved,
  onDiscardSaved,
  lmStatus,
  grokAvailable,
  onOpenSettings,
  accessible,
  onRefreshAccessible,
  pins,
  onTogglePin,
  lastReviewed,
  campaigns,
  defaultPlaybook,
  onDefaultPlaybook,
  tokenReady,
  modelReady,
  searching,
  searchError,
  searchNote,
  onSearchPin,
  onCreateWorkspace,
  onboardBusy,
  onboardError,
  githubToken,
  rollout,
  rolloutBusy,
  streamText,
  queueProgress,
  onStartRollout,
  onStartCatalog,
  onResumeRollout,
  onRetryGithub,
  onStopRollout,
  onDismissRollout,
}: {
  source: string;
  setSource: (value: string) => void;
  loading: boolean;
  error: string | null;
  checkpoint: QueueCheckpoint | null;
  onSubmit: () => void;
  onPick: (source: string) => void;
  onResumeSaved: () => void;
  onDiscardSaved: () => void;
  lmStatus: LmStatus;
  grokAvailable: boolean | null;
  onOpenSettings: () => void;
  accessible: AccessibleReposState;
  onRefreshAccessible: () => void;
  pins: string[];
  onTogglePin: (fullName: string) => void;
  lastReviewed: ReturnType<typeof lastReviewIndex>;
  campaigns: ReturnType<typeof groupCampaigns>;
  defaultPlaybook: Playbook;
  onDefaultPlaybook: (playbook: Playbook) => void;
  tokenReady: boolean;
  modelReady: boolean;
  searching: boolean;
  searchError: string | null;
  searchNote: string | null;
  onSearchPin: (query: string) => void;
  onCreateWorkspace: (values: OnboardFormValues) => void;
  onboardBusy: boolean;
  onboardError: string | null;
  githubToken: string;
  rollout: RolloutJob | null;
  rolloutBusy: boolean;
  streamText: string;
  queueProgress: ReviewQueueProgress | null;
  onStartRollout: () => void;
  onStartCatalog: (repos: string[], batchSize: number) => void;
  onResumeRollout: () => void;
  onRetryGithub: () => void;
  onStopRollout: () => void;
  onDismissRollout: () => void;
}) {
  const savedCount = checkpoint ? completedBatchCount(checkpoint) : 0;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center pb-10">
      {checkpoint && savedCount > 0 ? (
        <div className="mb-8 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Saved queue
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            {checkpoint.owner}/{checkpoint.repo} — {savedCount} of{" "}
            {checkpoint.batches.length} batches kept after the tab closed or
            Stop.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={onResumeSaved}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={onDiscardSaved}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {APP_TAGLINE}
      </p>
      <h1 className="mt-4 font-display text-4xl leading-none tracking-tight md:text-6xl">
        See the work as it actually is.
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
        Open a GitHub repository you can access — including private repos when a
        token is in Settings. Create a client or idea workspace from that same
        token, then review the tree with your LM Studio model, or Grok if no
        local server is running.
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
        <Button type="submit" size="lg" disabled={loading || rolloutBusy} className="sm:min-w-28">
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

      {accessible.status === "idle" ? (
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
      ) : (
        <AccessibleReposPanel
          state={accessible}
          onPick={onPick}
          onRefresh={onRefreshAccessible}
          onOpenSettings={onOpenSettings}
          pins={pins}
          onTogglePin={onTogglePin}
          lastReviewed={lastReviewed}
        />
      )}
      <OnboardPanel
        tokenReady={tokenReady}
        token={githubToken}
        defaultOwner={
          accessible.status === "ready" ? accessible.login : null
        }
        busy={onboardBusy}
        error={onboardError}
        onCreate={onCreateWorkspace}
        onOpenSettings={onOpenSettings}
      />
      <RolloutPanel
        playbook={defaultPlaybook}
        onPlaybook={onDefaultPlaybook}
        pinCount={pins.length}
        catalogRepos={accessible.status === "ready" ? accessible.repos : []}
        catalogTruncated={accessible.status === "ready" ? accessible.truncated : false}
        lastReviewedAt={Object.fromEntries(
          Object.entries(lastReviewed).map(([key, value]) => [key, value.savedAt]),
        )}
        tokenReady={tokenReady}
        modelReady={modelReady}
        searching={searching}
        searchError={searchError}
        searchNote={searchNote}
        onSearchPin={onSearchPin}
        rollout={rollout}
        rolloutBusy={rolloutBusy}
        streamText={streamText}
        queueProgress={queueProgress}
        onStart={onStartRollout}
        onStartCatalog={onStartCatalog}
        onResume={onResumeRollout}
        onRetryGithub={onRetryGithub}
        onStop={onStopRollout}
        onDismiss={onDismissRollout}
      />
      <CampaignsPanel groups={campaigns} onOpen={(owner, repo) => onPick(`${owner}/${repo}`)} />

      {accessible.status === "idle" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Add a GitHub token in{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onOpenSettings}
          >
            Settings
          </button>{" "}
          to list private repositories you can access.
        </p>
      ) : null}

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
  onDiscardSaved,
  checkpoint,
  onReset,
  result,
  streamText,
  queueProgress,
  providerLabel,
  resolvedTarget,
  applying,
  applyProgress,
  applyResult,
  applyError,
  hasGithubToken,
  onApplyFixes,
  reviewJob,
  jobLists,
  jobLoading,
  onSelectJob,
  onDefaultJob,
  issueBusy,
  issueError,
  issueNote,
  onCreateIssue,
  onAddressIssue,
  onResolveIssue,
  filingIssues,
  onFileFindings,
  playbook,
  onPlaybook,
  repoContext,
  writeHint,
  patchResult,
  verifySummary,
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
  onDiscardSaved: () => void;
  checkpoint: QueueCheckpoint | null;
  onReset: () => void;
  result: ReviewResult | null;
  streamText: string;
  queueProgress: ReviewQueueProgress | null;
  providerLabel: string;
  resolvedTarget: "lmstudio" | "grok" | null;
  applying: boolean;
  applyProgress: string | null;
  applyResult: BranchPushResult | null;
  applyError: string | null;
  hasGithubToken: boolean;
  onApplyFixes: (findingIds: string[]) => void;
  reviewJob: ReviewJob | null;
  jobLists: { pulls: JobListItem[]; branches: JobListItem[]; issues: JobListItem[] };
  jobLoading: boolean;
  onSelectJob: (item: JobListItem) => void;
  onDefaultJob: () => void;
  issueBusy: boolean;
  issueError: string | null;
  issueNote: string | null;
  onCreateIssue: (title: string, body: string) => void;
  onAddressIssue: (item: JobListItem, extra: string) => void;
  onResolveIssue: (item: JobListItem, extra: string) => void;
  filingIssues: boolean;
  onFileFindings: () => void;
  playbook: Playbook;
  onPlaybook: (playbook: Playbook) => void;
  repoContext: string;
  writeHint?: string;
  patchResult: ReviewResult | null;
  verifySummary: string | null;
}) {
  const { meta } = bundle;
  const savedCount = checkpoint ? completedBatchCount(checkpoint) : 0;
  const pendingCount = checkpoint ? pendingBatchIndexes(checkpoint).length : 0;
  const canResume =
    !reviewing &&
    checkpoint &&
    checkpointMatchesRepo(checkpoint, meta.owner, meta.repo) &&
    savedCount > 0 &&
    pendingCount > 0;

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
              {canResume
                ? `Resume queue (${savedCount}/${checkpoint?.batches.length ?? 0})`
                : resolvedTarget === "lmstudio" && selected.length > 6
                  ? `Review ${selected.length} files in queue`
                  : `Review ${selected.length} files`}
            </Button>
          )}
        </div>
      </div>

      {canResume ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-[var(--shadow-border)]">
          <p className="text-sm">
            {savedCount} of {checkpoint.batches.length} batches are saved. Resume
            runs two LM Studio jobs at a time.
          </p>
          <Button type="button" variant="ghost" onClick={onDiscardSaved}>
            Discard saved
          </Button>
        </div>
      ) : null}

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
            {reviewJob ? (
              <JobPicker
                job={reviewJob}
                pulls={jobLists.pulls}
                branches={jobLists.branches}
                issues={jobLists.issues}
                loading={jobLoading || loading}
                onDefault={onDefaultJob}
                onSelect={onSelectJob}
              />
            ) : null}
            {reviewJob ? (
              <IssuesPanel
                job={reviewJob}
                issues={jobLists.issues}
                hasToken={hasGithubToken}
                busy={issueBusy}
                error={issueError}
                note={issueNote}
                onSelect={onSelectJob}
                onCreate={onCreateIssue}
                onAddress={onAddressIssue}
                onResolve={onResolveIssue}
              />
            ) : null}
            <PlaybookEditor playbook={playbook} onChange={onPlaybook} />
            {repoContext ? (
              <pre className="overflow-x-auto rounded-2xl bg-card p-5 font-mono text-xs leading-relaxed text-muted-foreground shadow-[var(--shadow-border)]">
                {repoContext}
              </pre>
            ) : null}
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
            defaultBranch={meta.defaultBranch}
            applying={applying}
            applyProgress={applyProgress}
            applyResult={applyResult}
            applyError={applyError}
            hasGithubToken={hasGithubToken}
            onApplyFixes={onApplyFixes}
            filingIssues={filingIssues}
            fileIssuesNote={issueNote}
            onFileFindings={onFileFindings}
            writeHint={writeHint}
            patchResult={patchResult}
            verifySummary={verifySummary}
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
  watchlist,
  playbooks,
  defaultPlaybook,
  onOpen,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: ReviewRecord[];
  watchlist: string[];
  playbooks: Record<string, Playbook>;
  defaultPlaybook: Playbook;
  onOpen: (record: ReviewRecord) => void;
  onImport: (records: ReviewRecord[]) => void;
}) {
  function download(name: string, body: string, type: string) {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-y-0 right-0 left-auto flex h-dvh w-full max-w-md flex-col rounded-none border-y-0 border-r-0 p-0">
        <div className="safe-px safe-pt flex items-start justify-between gap-4 pb-4 pt-6">
          <div>
            <DialogTitle>History</DialogTitle>
            <DialogDescription className="mt-1">
              Reviews stay on this device until you export a dump for Railway.
            </DialogDescription>
          </div>
          <DialogClose />
        </div>
        <div className="safe-px flex flex-wrap gap-2 pb-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => download("quarry-history.json", exportHistoryJson(records), "application/json")}
          >
            Export JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              download(
                "quarry-dump.json",
                exportOperatorDumpJson(
                  buildOperatorDump({
                    history: records,
                    watchlist,
                    playbooks,
                    defaultPlaybook,
                  }),
                ),
                "application/json",
              )
            }
          >
            Export dump
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              download("quarry-history.md", exportHistoryMarkdown(records), "text/markdown")
            }
          >
            Export markdown
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center text-sm underline underline-offset-2">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  const next = parseHistoryImport(text);
                  saveHistory(next);
                  onImport(next);
                });
              }}
            />
          </label>
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
