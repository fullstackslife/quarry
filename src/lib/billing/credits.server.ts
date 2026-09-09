import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { getSessionUser, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { hostedChargeCents } from "./policy";
import { env } from "@/lib/env.server";

export function creditMarkup(): number {
  const raw = Number(env("QUARRY_CREDIT_MARKUP"));
  return Number.isFinite(raw) && raw >= 1 ? raw : 1.5;
}

export function hostedPoolConfigured(): boolean {
  return Boolean(env("AI_GATEWAY_API_KEY") || env("XAI_API_KEY"));
}

export async function getCreditCents(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ balance_cents: number }>(
    "select balance_cents from quarry_credits where user_id = $1",
    [userId],
  );
  return Number(rows[0]?.balance_cents ?? 0);
}

export async function debitCredits(input: {
  userId: string;
  cents: number;
  reason: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const cents = Math.max(1, Math.floor(input.cents));
  const sql = await getSql();
  await sql.query(
    "insert into quarry_credits (user_id, balance_cents) values ($1, 0) on conflict (user_id) do nothing",
    [input.userId],
  );
  const updated = await sql.query<{ balance_cents: number }>(
    `update quarry_credits
     set balance_cents = balance_cents - $2, updated_at = now()
     where user_id = $1 and balance_cents >= $2
     returning balance_cents`,
    [input.userId, cents],
  );
  if (!updated[0]) {
    return { ok: false, error: "Not enough Quarry credits. Buy credits or paste your own API key." };
  }
  await sql.query(
    "insert into quarry_credit_ledger (id, user_id, delta_cents, reason) values ($1, $2, $3, $4)",
    [`led_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, input.userId, -cents, input.reason],
  );
  return { ok: true, balance: Number(updated[0].balance_cents) };
}

export const getBillingSnapshot = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await getSessionUser();
    const creditCents = user ? await getCreditCents(user.id) : 0;
    return {
      pool: hostedPoolConfigured(),
      markup: creditMarkup(),
      creditCents,
      signedIn: Boolean(user),
    };
  },
);

export async function tryDebitHostedCredits(promptChars: number): Promise<
  | { ok: true }
  | { ok: false; error: string; status: number }
> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return {
        ok: false,
        status: 402,
        error:
          "Hosted models need your own API key in Settings, or an account with Quarry credits.",
      };
    }
    throw err;
  }
  if (!hostedPoolConfigured()) {
    return {
      ok: false,
      status: 402,
      error: "Hosted pool is not configured. Paste your own AI Gateway key in Settings.",
    };
  }
  const cents = hostedChargeCents({ promptChars, markup: creditMarkup() });
  const debit = await debitCredits({
    userId,
    cents,
    reason: `hosted-review:${cents}c`,
  });
  if (!debit.ok) return { ok: false, status: 402, error: debit.error };
  return { ok: true };
}
