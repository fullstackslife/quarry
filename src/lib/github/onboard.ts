import { githubRequest } from "./client.ts";
import type { Playbook } from "../playbook.ts";
import type { GithubResult } from "./types.ts";
import { createGithubRepo, slugifyRepoName, type CreatedRepo } from "./create.ts";
import { seedRepoFiles } from "./seed.ts";
import type { FileChange } from "./write.ts";

export type OnboardKind = "client" | "idea";

export type OnboardDraft = {
  kind: OnboardKind;
  title: string;
  name: string;
  owner?: string;
  brief: string;
  private?: boolean;
};

export type OnboardIssue = {
  number: number;
  htmlUrl: string;
  title: string;
};

export type OnboardResult = {
  repo: CreatedRepo;
  files: string[];
  issues: OnboardIssue[];
  labels: string[];
  warnings: string[];
};

export function onboardPlaybook(): Playbook {
  return {
    lens: "onboarding",
    include: ["README.md", "docs/**", ".github/**", ".quarry/**"],
    ignore: [],
  };
}

export function buildOnboardFiles(input: {
  kind: OnboardKind;
  title: string;
  fullName: string;
  brief: string;
}): FileChange[] {
  const title = input.title.trim() || input.fullName;
  const brief = input.brief.trim() || "Fill this in after the kickoff conversation.";
  const kindLabel = input.kind === "client" ? "Client engagement" : "Idea workspace";
  const playbook = onboardPlaybook();
  const readme = [
    `# ${title}`,
    "",
    `${kindLabel} for \`${input.fullName}\`.`,
    "",
    "## Why this repo exists",
    "",
    brief,
    "",
    "## How we work here",
    "",
    "- Intake issues hold scope, open questions, and success criteria.",
    "- Quarry reviews this tree with the **onboarding** lens until the first delivery lands.",
    "- Keep secrets out of git. Tokens stay in Settings on the machine that runs Quarry.",
    "",
    "## First hour",
    "",
    "1. Confirm the brief in `docs/brief.md`.",
    "2. Close or rewrite the intake issues so they match reality.",
    "3. Run an onboarding review from Quarry and pin this repo on the watchlist.",
    "",
  ].join("\n");

  const contributing = [
    "# Contributing",
    "",
    "This repository is an intake workspace. Prefer issues over ad-hoc chat for decisions that need to survive the week.",
    "",
    "When code arrives, open a pull request. Quarry will not write to the default branch except for this initial seed.",
    "",
  ].join("\n");

  const template = [
    "---",
    `name: ${input.kind === "client" ? "Client intake" : "Idea intake"}`,
    "about: Capture a new engagement or idea in this workspace.",
    "title: \"[intake] \"",
    "labels: [intake, quarry]",
    "---",
    "",
    "## Context",
    "",
    brief,
    "",
    "## What good looks like",
    "",
    "- ",
    "",
    "## Open questions",
    "",
    "- ",
    "",
  ].join("\n");

  return [
    { path: "README.md", content: readme },
    { path: "docs/brief.md", content: `# Brief\n\n${brief}\n` },
    {
      path: ".quarry/playbook.json",
      content: `${JSON.stringify(playbook, null, 2)}\n`,
    },
    { path: ".github/ISSUE_TEMPLATE/intake.md", content: template },
    { path: "CONTRIBUTING.md", content: contributing },
  ];
}

function issueSpecs(kind: OnboardKind, title: string, brief: string) {
  const noun = kind === "client" ? "engagement" : "idea";
  return [
    {
      title: `Intake: ${title}`,
      labels: ["intake", "quarry", kind],
      body: [
        `Kickoff for this ${noun}.`,
        "",
        "## Brief",
        "",
        brief || "_Add the brief._",
        "",
        "## Owners",
        "",
        "- [ ] Who is accountable on our side?",
        "- [ ] Who is the counterpart?",
        "",
      ].join("\n"),
    },
    {
      title: "Success criteria",
      labels: ["intake", "next"],
      body: [
        "What has to be true for this workspace to be done, not just started?",
        "",
        "- [ ] Scope is written in `docs/brief.md`",
        "- [ ] First review has run in Quarry",
        "- [ ] Next concrete delivery is named",
        "",
      ].join("\n"),
    },
    {
      title: "First Quarry onboarding review",
      labels: ["quarry", "next"],
      body: [
        "Open this repository in Quarry, keep the **onboarding** lens, and store the report in History.",
        "",
        "Pin the repo so later campaigns include it.",
        "",
      ].join("\n"),
    },
  ];
}

const LABEL_DEFS = [
  { name: "quarry", color: "3d5a3a", description: "Created or tracked by Quarry" },
  { name: "intake", color: "6b8f71", description: "Onboarding and scope" },
  { name: "client", color: "4a6fa5", description: "Client engagement" },
  { name: "idea", color: "8b6914", description: "Idea workspace" },
  { name: "next", color: "576574", description: "Do this next" },
];

async function ensureLabels(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ labels: string[]; warnings: string[] }> {
  const labels: string[] = [];
  const warnings: string[] = [];
  for (const label of LABEL_DEFS) {
    const res = await githubRequest<{ name?: string; message?: string }>(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
      token,
      label,
      signal,
    );
    if (res.status === 201 || res.status === 200) {
      labels.push(label.name);
      continue;
    }
    if (res.status === 422) {
      labels.push(label.name);
      continue;
    }
    warnings.push(res.json.message || `Could not create label ${label.name}.`);
  }
  return { labels, warnings };
}

async function createIssues(
  owner: string,
  repo: string,
  token: string,
  kind: OnboardKind,
  title: string,
  brief: string,
  signal?: AbortSignal,
): Promise<{ issues: OnboardIssue[]; warnings: string[] }> {
  const issues: OnboardIssue[] = [];
  const warnings: string[] = [];
  for (const spec of issueSpecs(kind, title, brief)) {
    const res = await githubRequest<{
      number?: number;
      html_url?: string;
      title?: string;
      message?: string;
    }>(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      token,
      spec,
      signal,
    );
    if (res.status >= 400 || !res.json.number) {
      warnings.push(res.json.message || `Could not open issue: ${spec.title}`);
      continue;
    }
    issues.push({
      number: res.json.number,
      htmlUrl: res.json.html_url || `https://github.com/${owner}/${repo}/issues/${res.json.number}`,
      title: res.json.title || spec.title,
    });
  }
  return { issues, warnings };
}

async function setTopics(
  owner: string,
  repo: string,
  token: string,
  kind: OnboardKind,
  signal?: AbortSignal,
) {
  await githubRequest(
    "PUT",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`,
    token,
    { names: ["quarry", kind] },
    signal,
  );
}

export async function onboardGithubRepo(input: {
  token: string;
  kind: OnboardKind;
  title: string;
  name: string;
  owner?: string;
  brief: string;
  private?: boolean;
  signal?: AbortSignal;
}): Promise<GithubResult<OnboardResult>> {
  const title = input.title.trim() || slugifyRepoName(input.name);
  const created = await createGithubRepo({
    token: input.token,
    name: input.name,
    owner: input.owner,
    description: title,
    private: input.private !== false,
    autoInit: true,
    signal: input.signal,
  });
  if (!created.ok) return created;

  const warnings: string[] = [];
  const files = buildOnboardFiles({
    kind: input.kind,
    title,
    fullName: created.data.fullName,
    brief: input.brief,
  });
  const seeded = await seedRepoFiles({
    owner: created.data.owner,
    repo: created.data.repo,
    token: input.token,
    branch: created.data.defaultBranch,
    message: `Seed ${input.kind} onboarding workspace`,
    files,
    signal: input.signal,
  });
  if (!seeded.ok) {
    warnings.push(seeded.error);
  }

  const labelsRes = await ensureLabels(
    created.data.owner,
    created.data.repo,
    input.token,
    input.signal,
  );
  warnings.push(...labelsRes.warnings);

  const issuesRes = await createIssues(
    created.data.owner,
    created.data.repo,
    input.token,
    input.kind,
    title,
    input.brief.trim(),
    input.signal,
  );
  warnings.push(...issuesRes.warnings);

  try {
    await setTopics(
      created.data.owner,
      created.data.repo,
      input.token,
      input.kind,
      input.signal,
    );
  } catch {
    warnings.push("Could not set repository topics.");
  }

  return {
    ok: true,
    data: {
      repo: created.data,
      files: seeded.ok ? seeded.data.files : [],
      issues: issuesRes.issues,
      labels: labelsRes.labels,
      warnings,
    },
  };
}
