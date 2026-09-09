import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCreditUsd,
  hostedChargeCents,
  resolveHostedAccess,
} from "./policy.ts";

test("BYOK wins even with a zero credit balance", () => {
  assert.equal(resolveHostedAccess({ byokKey: "gw_x", creditCents: 0 }).mode, "byok");
});

test("credits unlock the operator pool when there is no key", () => {
  assert.equal(resolveHostedAccess({ byokKey: "", creditCents: 25 }).mode, "credits");
});

test("public hosted is blocked without a key or credits", () => {
  const access = resolveHostedAccess({ byokKey: "  ", creditCents: 0 });
  assert.equal(access.mode, "blocked");
  assert.match(access.reason ?? "", /API key/);
});

test("hostedChargeCents applies markup with a one-cent floor", () => {
  assert.equal(hostedChargeCents({ promptChars: 100, markup: 1.5 }), 2);
  assert.equal(hostedChargeCents({ promptChars: 24_000, markup: 2 }), 4);
  assert.equal(formatCreditUsd(150), "$1.50");
});
