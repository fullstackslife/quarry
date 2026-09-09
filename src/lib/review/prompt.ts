import type { RepoMeta } from "@/lib/github/types";
import { FILE_MAX_CHARS } from "./queue";
import type { ReviewLens } from "./types";

const SCHEMA = `{
  "headline": "short verdict in one sentence",
  "summary": "2-4 sentences on what this repo is and how it is built",
  "score": 0,
  "verdict": "solid" | "mixed" | "shaky",
  "stack": ["language or library names"],
  "findings": [
    {
      "id": "kebab-id",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "security" | "correctness" | "architecture" | "performance" | "dx" | "tests" | "docs",
      "title": "short title",
      "detail": "what is wrong, why it matters, what to do",
      "file": "path or null",
      "evidence": "short quote or null"
    }
  ],
  "strengths": ["what is done well"],
  "questions": ["things a maintainer should confirm"]
}`;

const LENS_HINT: Record<ReviewLens, string> = {
  full: "Balance security, architecture, correctness, tests, and docs. Lead with the highest-severity issues.",
  security:
    "Focus on auth, secrets, injection, unsafe defaults, supply chain, CI permissions, and trust boundaries. Skip style nits.",
  architecture:
    "Focus on module boundaries, coupling, data flow, layering, and whether the shape will scale. Cite directories.",
  quality:
    "Focus on tests, types, error handling, dead code, and maintainability. Be concrete about missing coverage.",
  onboarding:
    "Focus on README, run path, project shape, and what a new contributor would hit in the first hour.",
};

export function buildReviewMessages(input: {
  meta: RepoMeta;
  languages: Record<string, number>;
  allPaths: string[];
  contents: Record<string, string>;
  selected: string[];
  lens: ReviewLens;
  maxChars: number;
  treeLimit?: number;
  findingHint?: string;
  batch?: { index: number; total: number };
}): { role: "system" | "user"; content: string }[] {
  const findingHint = input.findingHint ?? "Write 5 to 12 findings.";
  const system = [
    "You are Quarry, a senior engineer reviewing a GitHub repository.",
    input.meta.private
      ? "This repository is private. Treat secrets, credentials, and internal URLs as sensitive — report them, do not invent extra exposure."
      : "",
    "Be specific. Cite real paths. Do not invent files, APIs, or vulnerabilities.",
    "Prefer findings a maintainer could act on this week over generic advice.",
    input.batch && input.batch.total > 1
      ? `This is file batch ${input.batch.index} of ${input.batch.total}. Review ONLY the files in this batch. Do not claim you read the whole repo.`
      : "",
    "Return ONLY a JSON object matching this schema — no markdown fence, no preamble:",
    SCHEMA,
    `${findingHint} Score is 0-100 for production readiness of the reviewed files, not popularity.`,
    LENS_HINT[input.lens],
  ]
    .filter(Boolean)
    .join("\n");

  const langLine = Object.entries(input.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => `${name} ${bytes}`)
    .join(", ");

  const treeLimit = input.treeLimit ?? 80;
  const structure = input.allPaths.slice(0, treeLimit).join("\n");

  let used = 0;
  const fileBlocks: string[] = [];
  for (const path of input.selected) {
    const body = input.contents[path];
    if (!body) continue;
    const remaining = Math.min(FILE_MAX_CHARS, input.maxChars - used);
    if (remaining < 400) break;
    const clipped =
      body.length > remaining ? `${body.slice(0, remaining)}\n/* truncated */` : body;
    fileBlocks.push(`### ${path}\n\`\`\`\n${clipped}\n\`\`\``);
    used += clipped.length;
  }

  const user = [
    `# ${input.meta.owner}/${input.meta.repo}`,
    input.batch && input.batch.total > 1
      ? `Batch ${input.batch.index}/${input.batch.total}. Files in this batch: ${input.selected.join(", ")}`
      : "",
    input.meta.description ? `Description: ${input.meta.description}` : "",
    `Language: ${input.meta.language ?? "n/a"}`,
    `License: ${input.meta.license ?? "n/a"}`,
    `Visibility: ${input.meta.private ? "private" : "public"}.`,
    `Stars: ${input.meta.stars}. Forks: ${input.meta.forks}. Branch: ${input.meta.defaultBranch}.`,
    input.meta.pushedAt ? `Last push: ${input.meta.pushedAt}` : "",
    langLine ? `Languages: ${langLine}` : "",
    input.meta.topics.length ? `Topics: ${input.meta.topics.join(", ")}` : "",
    "",
    "## Tree excerpt",
    structure || "(empty)",
    "",
    "## Selected files",
    fileBlocks.join("\n\n") || "(no file contents loaded)",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildSynthesisMessages(input: {
  meta: RepoMeta;
  lens: ReviewLens;
  fileCount: number;
  batchCount: number;
  notes: string[];
}): { role: "system" | "user"; content: string }[] {
  const system = [
    "You are Quarry. Several small file-batch reviews of one GitHub repository follow.",
    "Merge them into a single repo-level review. Deduplicate findings. Do not invent files.",
    "Return ONLY a JSON object matching this schema — no markdown fence, no preamble:",
    SCHEMA,
    "Write 6 to 14 findings. Score the repository as a whole.",
    LENS_HINT[input.lens],
  ].join("\n");

  const user = [
    `# ${input.meta.owner}/${input.meta.repo}`,
    input.meta.description ? `Description: ${input.meta.description}` : "",
    `Reviewed ${input.fileCount} files across ${input.batchCount} batches.`,
    "",
    "## Batch notes",
    input.notes.join("\n\n---\n\n"),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
