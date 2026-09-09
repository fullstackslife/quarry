export type ReviewLens =
  | "full"
  | "security"
  | "architecture"
  | "quality"
  | "onboarding";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "security"
  | "correctness"
  | "architecture"
  | "performance"
  | "dx"
  | "tests"
  | "docs";

export type Finding = {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  detail: string;
  file: string | null;
  evidence: string | null;
};

export type StructuredReview = {
  kind: "structured";
  headline: string;
  summary: string;
  score: number;
  verdict: "solid" | "mixed" | "shaky";
  stack: string[];
  findings: Finding[];
  strengths: string[];
  questions: string[];
};

export type ProseReview = {
  kind: "prose";
  markdown: string;
};

export type ReviewResult = StructuredReview | ProseReview;

export type ReviewRecord = {
  id: string;
  savedAt: number;
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  language: string | null;
  lens: ReviewLens;
  providerLabel: string;
  result: ReviewResult;
};

export const LENSES: { id: ReviewLens; label: string; hint: string }[] = [
  { id: "full", label: "Full", hint: "Security, architecture, quality" },
  { id: "security", label: "Security", hint: "Auth, secrets, supply chain" },
  { id: "architecture", label: "Architecture", hint: "Boundaries and coupling" },
  { id: "quality", label: "Quality", hint: "Tests, types, error handling" },
  { id: "onboarding", label: "Onboarding", hint: "README, run path, structure" },
];
