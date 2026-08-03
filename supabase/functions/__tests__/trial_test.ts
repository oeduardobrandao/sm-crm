import { assertEquals } from "./assert.ts";
import {
  buildCheckoutIdempotencyKey,
  resolveReturnPaths,
  resolveTrialDays,
  TRIAL_DAYS,
} from "../_shared/trial.ts";

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

Deno.test("buildCheckoutIdempotencyKey is stable inside an hour, different across hours", () => {
  const base = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base);
  const b = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base + 59 * 60_000);
  const c = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base + 61 * 60_000);
  assertEquals(a, b);
  assertEquals(a === c, false);
});

Deno.test("buildCheckoutIdempotencyKey separates workspace, plan and interval", () => {
  const now = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", now);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-2", "pro", "month", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "max", "month", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "pro", "year", now), false);
});
