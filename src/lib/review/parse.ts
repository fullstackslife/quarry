import type {
  Finding,
  FindingCategory,
  FindingSeverity,
  ReviewResult,
  StructuredReview,
} from "./types";

const SEVERITIES: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const CATEGORIES: FindingCategory[] = [
  "security",
  "correctness",
  "architecture",
  "performance",
  "dx",
  "tests",
  "docs",
];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeFinding(raw: unknown, index: number): Finding | null {
  if (typeof raw === "string" && raw.trim()) {
    return {
      id: `finding-${index + 1}`,
      severity: "medium",
      category: "dx",
      title: raw.trim().slice(0, 120),
      detail: raw.trim(),
      file: null,
      evidence: null,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = asString(obj.title) || asString(obj.headline) || asString(obj.issue);
  const detail = asString(obj.detail) || asString(obj.description) || asString(obj.body);
  if (!title && !detail) return null;
  const severityRaw = asString(obj.severity).toLowerCase();
  const categoryRaw = asString(obj.category).toLowerCase();
  return {
    id: asString(obj.id) || `finding-${index + 1}`,
    severity: SEVERITIES.includes(severityRaw as FindingSeverity)
      ? (severityRaw as FindingSeverity)
      : "medium",
    category: CATEGORIES.includes(categoryRaw as FindingCategory)
      ? (categoryRaw as FindingCategory)
      : "dx",
    title: (title || detail).slice(0, 160),
    detail: detail || title,
    file: asString(obj.file) || asString(obj.path) || null,
    evidence: asString(obj.evidence) || asString(obj.snippet) || null,
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

export function parseReview(text: string): ReviewResult {
  const json = extractJson(text);
  if (!json || typeof json !== "object") {
    return { kind: "prose", markdown: text.trim() };
  }
  const obj = json as Record<string, unknown>;
  const findings = Array.isArray(obj.findings)
    ? obj.findings.map(normalizeFinding).filter((item): item is Finding => Boolean(item))
    : [];
  const headline = asString(obj.headline) || asString(obj.title);
  const summary = asString(obj.summary) || asString(obj.overview);
  if (!headline && !summary && findings.length === 0) {
    return { kind: "prose", markdown: text.trim() };
  }

  const scoreNum = Number(obj.score);
  const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 50;
  const verdictRaw = asString(obj.verdict).toLowerCase();
  const verdict: StructuredReview["verdict"] =
    verdictRaw === "solid" || verdictRaw === "shaky" || verdictRaw === "mixed"
      ? verdictRaw
      : score >= 78
        ? "solid"
        : score >= 50
          ? "mixed"
          : "shaky";

  return {
    kind: "structured",
    headline: headline || "Review complete",
    summary: summary || headline,
    score,
    verdict,
    stack: asStringList(obj.stack),
    findings,
    strengths: asStringList(obj.strengths),
    questions: asStringList(obj.questions),
  };
}

export function reviewToMarkdown(
  owner: string,
  repo: string,
  result: ReviewResult,
): string {
  if (result.kind === "prose") return result.markdown;
  const lines = [
    `# Quarry review — ${owner}/${repo}`,
    "",
    `**${result.score}/100 · ${result.verdict}** — ${result.headline}`,
    "",
    result.summary,
    "",
  ];
  if (result.stack.length) {
    lines.push(`Stack: ${result.stack.join(", ")}`, "");
  }
  if (result.findings.length) {
    lines.push("## Findings", "");
    for (const finding of result.findings) {
      lines.push(
        `### ${finding.severity.toUpperCase()} — ${finding.title}`,
        finding.file ? `File: \`${finding.file}\`` : "",
        finding.detail,
        finding.evidence ? `> ${finding.evidence}` : "",
        "",
      );
    }
  }
  if (result.strengths.length) {
    lines.push("## Strengths", ...result.strengths.map((item) => `- ${item}`), "");
  }
  if (result.questions.length) {
    lines.push("## Open questions", ...result.questions.map((item) => `- ${item}`), "");
  }
  return lines.filter((line) => line !== undefined).join("\n");
}
