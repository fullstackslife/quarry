import type { AccessibleRepo } from "../github/repos.ts";

export const CATALOG_BATCH_SIZES = [0, 8, 12, 20] as const;
/** 0 = run until the catalog is empty. */
export const DEFAULT_CATALOG_BATCH_SIZE = 0;

export function catalogSessionLabel(size: number, total: number): string {
  if (size <= 0) return `all ${total}`;
  return `${Math.min(size, total)} of ${total}`;
}

export type CatalogPlanOptions = {
  skipArchived?: boolean;
  skipForks?: boolean;
  skipReviewedSincePush?: boolean;
  lastReviewedAt?: Record<string, number>;
};

export function planCatalogRepos(
  repos: AccessibleRepo[],
  options: CatalogPlanOptions = {},
): string[] {
  const skipArchived = options.skipArchived !== false;
  const skipForks = options.skipForks !== false;
  const skipReviewed = Boolean(options.skipReviewedSincePush);
  const lastReviewedAt = options.lastReviewedAt ?? {};

  const eligible = repos.filter((item) => {
    if (skipArchived && item.archived) return false;
    if (skipForks && item.fork) return false;
    if (skipReviewed) {
      const last = lastReviewedAt[item.fullName.toLowerCase()] ?? 0;
      const pushed = item.pushedAt ? Date.parse(item.pushedAt) : 0;
      if (last && pushed && pushed <= last) return false;
    }
    return true;
  });

  eligible.sort((a, b) => {
    const aPush = a.pushedAt ? Date.parse(a.pushedAt) : 0;
    const bPush = b.pushedAt ? Date.parse(b.pushedAt) : 0;
    return bPush - aPush;
  });

  return eligible.map((item) => item.fullName);
}
