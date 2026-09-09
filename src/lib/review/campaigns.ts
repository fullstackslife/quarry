import type { Finding, ReviewRecord, StructuredReview } from "./types.ts";

export type CampaignGroup = {
  key: string;
  title: string;
  category: Finding["category"];
  severity: Finding["severity"];
  repos: { owner: string; repo: string }[];
  count: number;
};

function structured(record: ReviewRecord): StructuredReview | null {
  return record.result.kind === "structured" ? record.result : null;
}

export function groupCampaigns(records: ReviewRecord[]): CampaignGroup[] {
  const byKey = new Map<string, CampaignGroup>();
  for (const record of records) {
    const review = structured(record);
    if (!review) continue;
    for (const finding of review.findings) {
      if (finding.severity === "info") continue;
      const key = `${finding.category}::${finding.title.trim().toLowerCase()}`;
      const existing = byKey.get(key);
      const repo = { owner: record.owner, repo: record.repo };
      if (!existing) {
        byKey.set(key, {
          key,
          title: finding.title,
          category: finding.category,
          severity: finding.severity,
          repos: [repo],
          count: 1,
        });
        continue;
      }
      existing.count += 1;
      if (
        !existing.repos.some(
          (item) => item.owner === repo.owner && item.repo === repo.repo,
        )
      ) {
        existing.repos.push(repo);
      }
    }
  }
  return [...byKey.values()]
    .filter((item) => item.repos.length > 1)
    .sort((a, b) => b.repos.length - a.repos.length || b.count - a.count);
}
