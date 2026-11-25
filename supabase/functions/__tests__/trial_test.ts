import { assertEquals } from "./assert.ts";
import {
  buildCheckoutIdempotencyKey,
  resolveCheckoutSource,
  resolveReturnPaths,
  resolveTrialDays,
  TRIAL_DAYS,
} from "../_shared/trial.ts";
import { isWorkspaceOwner } from "../_shared/workspace-role.ts";

Deno.test("resolveTrialDays grants the trial only to workspaces that never subscribed", () => {
  assertEquals(resolveTrialDays(false), TRIAL_DAYS);
  assertEquals(resolveTrialDays(true), undefined);
});

Deno.test("resolveReturnPaths sends onboarding back to the dashboard", () => {
  assertEquals(resolveReturnPaths("onboarding"), {
    success: "/dashboard?trial=started",
    cancel: "/dashboard?trial=skipped",
  });
});

Deno.test("resolveReturnPaths falls back to billing for anything unrecognised", () => {
  const billing = {
    success: "/configuracao/cobranca?status=success",
    cancel: "/configuracao/cobranca?status=cancelled",
  };
  assertEquals(resolveReturnPaths("billing"), billing);
  assertEquals(resolveReturnPaths(undefined), billing);
  assertEquals(resolveReturnPaths(null), billing);
  assertEquals(resolveReturnPaths("https://evil.example.com"), billing);
  assertEquals(resolveReturnPaths({ success: "https://evil.example.com" }), billing);
});

Deno.test("resolveCheckoutSource normalises anything unrecognised to billing", () => {
  assertEquals(resolveCheckoutSource("onboarding"), "onboarding");
  assertEquals(resolveCheckoutSource("billing"), "billing");
  assertEquals(resolveCheckoutSource(undefined), "billing");
  assertEquals(resolveCheckoutSource(null), "billing");
  assertEquals(resolveCheckoutSource("ONBOARDING"), "billing");
  assertEquals(resolveCheckoutSource({ source: "onboarding" }), "billing");
});

Deno.test("buildCheckoutIdempotencyKey is stable inside an hour, different across hours", () => {
  const base = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", base);
  const b = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", base + 59 * 60_000);
  const c = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", base + 61 * 60_000);
  assertEquals(a, b);
  assertEquals(a === c, false);
});

Deno.test("buildCheckoutIdempotencyKey separates workspace, plan, interval and source", () => {
  const now = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-2", "pro", "month", "billing", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "max", "month", "billing", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "pro", "year", "billing", now), false);
  // The source changes success_url/cancel_url, so it MUST change the key:
  // reusing one key with different parameters is an idempotency_error at
  // Stripe. Cancelling an /comecar checkout and retrying the same plan from
  // Plano e Cobrança inside the hour is the real path that hits this.
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "pro", "month", "onboarding", now), false);
});

Deno.test("isWorkspaceOwner accepts only an owner membership row", () => {
  assertEquals(isWorkspaceOwner("owner"), true);
  assertEquals(isWorkspaceOwner("admin"), false);
  assertEquals(isWorkspaceOwner("agent"), false);
  assertEquals(isWorkspaceOwner(null), false);
  assertEquals(isWorkspaceOwner(undefined), false);
});

Deno.test("idempotency_key_changes_with_trial_state", async () => {
  const { checkoutTrialTag } = await import("../_shared/trial.ts");
  const now = Date.UTC(2026, 11, 1, 10, 0, 0);
  const key = (tag: string) => buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now, tag);
  const running = checkoutTrialTag({ kind: "reverse", trialEnd: new Date("2026-12-10T15:00:00Z") });
  const extended = checkoutTrialTag({ kind: "reverse", trialEnd: new Date("2026-12-20T15:00:00Z") });
  const ended = checkoutTrialTag({ kind: "none" });
  const card = checkoutTrialTag({ kind: "days", days: 30 });
  // Every trial state (and each trial_end) sends different Stripe parameters: different key.
  const keys = new Set([key(running), key(extended), key(ended), key(card)]);
  assertEquals(keys.size, 4);
  // Same state inside the hour: same key (two racing tabs still share one session).
  assertEquals(
    key(running),
    buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now + 30 * 60_000, running),
  );
});

Deno.test("idempotency_key_changes_with_currency", () => {
  const now = Date.UTC(2026, 11, 1, 10, 0, 0);
  const brl = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now, "d30", "brl");
  const usd = buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now, "d30", "usd");
  // currency changes the Stripe parameters, so it MUST change the key.
  assertEquals(brl === usd, false);
  assertEquals(usd.includes("usd"), true);
  // Same inputs inside the hour: same key.
  assertEquals(
    usd,
    buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now + 30 * 60_000, "d30", "usd"),
  );
  // No trial tag still carries the currency.
  assertEquals(
    buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now, "", "usd") ===
      buildCheckoutIdempotencyKey("ws-1", "pro", "month", "billing", now, "", "brl"),
    false,
  );
});
