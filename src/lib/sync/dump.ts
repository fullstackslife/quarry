import type { Playbook } from "../playbook.ts";
import { emptyPlaybook, normalizePlaybook } from "../playbook.ts";
import type { ReviewRecord } from "../review/types.ts";

export const OPERATOR_DUMP_VERSION = 1;

export type OperatorDump = {
  version: typeof OPERATOR_DUMP_VERSION;
  exportedAt: number;
  history: ReviewRecord[];
  watchlist: string[];
  playbooks: Record<string, Playbook>;
  defaultPlaybook: Playbook;
};

export function buildOperatorDump(input: {
  history: ReviewRecord[];
  watchlist: string[];
  playbooks: Record<string, Playbook>;
  defaultPlaybook: Playbook;
}): OperatorDump {
  return {
    version: OPERATOR_DUMP_VERSION,
    exportedAt: Date.now(),
    history: input.history,
    watchlist: [...new Set(input.watchlist.map(String).filter(Boolean))],
    playbooks: input.playbooks,
    defaultPlaybook: normalizePlaybook(input.defaultPlaybook),
  };
}

export function exportOperatorDumpJson(dump: OperatorDump): string {
  return `${JSON.stringify(dump, null, 2)}\n`;
}

export function parseOperatorDump(raw: string): OperatorDump {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dump JSON must be an object.");
  }
  const body = parsed as Partial<OperatorDump> & { history?: unknown };
  if (!Array.isArray(body.history)) {
    throw new Error("Dump JSON needs a history array.");
  }
  const playbooksIn =
    body.playbooks && typeof body.playbooks === "object" ? body.playbooks : {};
  const playbooks: Record<string, Playbook> = {};
  for (const [key, value] of Object.entries(playbooksIn)) {
    playbooks[key] = normalizePlaybook(value);
  }
  return {
    version: OPERATOR_DUMP_VERSION,
    exportedAt:
      typeof body.exportedAt === "number" ? body.exportedAt : Date.now(),
    history: body.history.filter(
      (item) => item && typeof item === "object",
    ) as ReviewRecord[],
    watchlist: Array.isArray(body.watchlist)
      ? body.watchlist.map(String).filter(Boolean)
      : [],
    playbooks,
    defaultPlaybook: normalizePlaybook(body.defaultPlaybook ?? emptyPlaybook()),
  };
}
