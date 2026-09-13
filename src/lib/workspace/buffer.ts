import type { FileChange } from "../github/write.ts";
import { generateUnifiedDiff } from "./patch.ts";

export type DraftFile = {
  path: string;
  original: string;
  proposed: string;
  accepted: boolean;
};

export function upsertDraft(
  drafts: DraftFile[],
  path: string,
  original: string,
  proposed: string,
): DraftFile[] {
  const next = drafts.filter((item) => item.path !== path);
  if (original === proposed) return next;
  next.push({ path, original, proposed, accepted: true });
  next.sort((a, b) => a.path.localeCompare(b.path));
  return next;
}

export function setDraftAccepted(drafts: DraftFile[], path: string, accepted: boolean): DraftFile[] {
  return drafts.map((item) => (item.path === path ? { ...item, accepted } : item));
}

export function removeDraft(drafts: DraftFile[], path: string): DraftFile[] {
  return drafts.filter((item) => item.path !== path);
}

export function acceptedChanges(drafts: DraftFile[]): FileChange[] {
  return drafts
    .filter((item) => item.accepted && item.original !== item.proposed)
    .map((item) => ({ path: item.path, content: item.proposed }));
}

export function draftDiff(draft: DraftFile): string {
  return generateUnifiedDiff(draft.path, draft.original, draft.proposed);
}
