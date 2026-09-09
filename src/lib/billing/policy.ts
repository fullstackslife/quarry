export type HostedAccessMode = "byok" | "credits" | "blocked";

export type HostedAccess = {
  mode: HostedAccessMode;
  reason?: string;
};

export function resolveHostedAccess(input: {
  byokKey: string | null | undefined;
  creditCents: number;
}): HostedAccess {
  if (input.byokKey?.trim()) {
    return { mode: "byok" };
  }
  if (input.creditCents > 0) {
    return { mode: "credits" };
  }
  return {
    mode: "blocked",
    reason:
      "Hosted models need your own API key, or Quarry credits. Local LM Studio is free.",
  };
}

/** Quarry sale price: Gateway pass-through × markup, in integer cents (min 1). */
export function hostedChargeCents(input: {
  promptChars: number;
  markup: number;
}): number {
  const markup = Number.isFinite(input.markup) && input.markup > 0 ? input.markup : 1.5;
  const units = Math.max(1, Math.ceil(Math.max(0, input.promptChars) / 12_000));
  return Math.max(1, Math.ceil(units * markup));
}

export function formatCreditUsd(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}
