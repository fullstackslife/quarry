import type { Finding } from "@/lib/review/types";

export function buildFixFileMessages(input: {
  owner: string;
  repo: string;
  path: string;
  current: string;
  findings: Finding[];
}): { role: "system" | "user"; content: string }[] {
  const findings = input.findings
    .map(
      (finding) =>
        `- ${finding.severity} ${finding.category}: ${finding.title}\n  ${finding.detail}${finding.evidence ? `\n  Evidence: ${finding.evidence}` : ""}`,
    )
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "You are Quarry applying review fixes to one source file.",
        "Return ONLY JSON, no markdown fence:",
        `{ "files": [{ "path": "${input.path}", "content": "full updated file" }] }`,
        "Keep the rest of the file. Do not invent APIs. Do not add unrelated refactors.",
        "content must be the complete file text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `# ${input.owner}/${input.repo}`,
        `File: ${input.path}`,
        "",
        "## Findings to address",
        findings || "(none)",
        "",
        "## Current file",
        "```",
        input.current.slice(0, 24_000),
        "```",
      ].join("\n"),
    },
  ];
}

export function groupFindingsByFile(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const path = finding.file?.trim();
    if (!path) continue;
    const list = groups.get(path) ?? [];
    list.push(finding);
    groups.set(path, list);
  }
  return groups;
}
