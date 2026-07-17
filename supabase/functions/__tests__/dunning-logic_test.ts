import { assertEquals } from "./assert.ts";
import {
  buildFailureEpisode,
  buildRecoveryEpisode,
  isRecoveredStatus,
  selectDunningStage,
} from "../_shared/dunning-logic.ts";

// Stripe sends unix seconds. Derived rather than hardcoded so the expectation stays readable.
const NEXT_ATTEMPT_UNIX = Math.floor(Date.UTC(2026, 6, 24, 10, 0, 0) / 1000); // 2026-07-24T10:00:00Z
const NEXT_ATTEMPT_ISO = "2026-07-24T10:00:00.000Z";

Deno.test("selectDunningStage: a first failure with a retry ahead is the soft notice", () => {
  assertEquals(selectDunningStage(1, NEXT_ATTEMPT_UNIX), "first");
});

Deno.test("selectDunningStage: later failures with a retry ahead escalate", () => {
  assertEquals(selectDunningStage(2, NEXT_ATTEMPT_UNIX), "retry");
  assertEquals(selectDunningStage(3, NEXT_ATTEMPT_UNIX), "retry");
});

Deno.test("selectDunningStage: no next attempt is final, whatever the attempt count", () => {
  // Stripe reporting no further retry is the only signal for "final" — the retry schedule is
  // dashboard config and can change without a deploy, so attempt_count cannot be trusted for it.
  assertEquals(selectDunningStage(1, null), "final");
  assertEquals(selectDunningStage(4, null), "final");
});

Deno.test("buildFailureEpisode: stamps past_due_since on the first failure", () => {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const ep = buildFailureEpisode(null, 1, NEXT_ATTEMPT_UNIX, now);
  assertEquals(ep.past_due_since, "2026-07-17T10:00:00.000Z");
  assertEquals(ep.next_payment_attempt, NEXT_ATTEMPT_ISO);
  assertEquals(ep.failed_payment_count, 1);
});

Deno.test("buildFailureEpisode: preserves past_due_since across a redelivery", () => {
  const now = new Date("2026-07-20T10:00:00.000Z");
  const ep = buildFailureEpisode("2026-07-17T10:00:00.000Z", 2, NEXT_ATTEMPT_UNIX, now);
  assertEquals(ep.past_due_since, "2026-07-17T10:00:00.000Z");
});

Deno.test("buildFailureEpisode: a null next attempt stays null", () => {
  const now = new Date("2026-07-30T10:00:00.000Z");
  const ep = buildFailureEpisode("2026-07-17T10:00:00.000Z", 4, null, now);
  assertEquals(ep.next_payment_attempt, null);
  assertEquals(ep.failed_payment_count, 4);
});

Deno.test("buildRecoveryEpisode: clears the whole episode including the counter", () => {
  assertEquals(buildRecoveryEpisode(), {
    past_due_since: null,
    next_payment_attempt: null,
    failed_payment_count: 0,
  });
});

Deno.test("isRecoveredStatus: only active and trialing end an episode", () => {
  assertEquals(isRecoveredStatus("active"), true);
  assertEquals(isRecoveredStatus("trialing"), true);
  for (const s of ["past_due", "canceled", "unpaid", "incomplete", "paused"]) {
    assertEquals(isRecoveredStatus(s), false);
  }
});
