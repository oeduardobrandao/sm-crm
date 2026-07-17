import { assertEquals } from "./assert.ts";
import { bucketWorkspace } from "../_shared/radar-logic.ts";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const CREATED_LONG_AGO = "2025-01-01T00:00:00.000Z";

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}
function daysAhead(n: number): string {
  return new Date(NOW.getTime() + n * 86_400_000).toISOString();
}

Deno.test("bucketWorkspace: past_due outranks everything", () => {
  // A failing payment is the most urgent signal even on a workspace in daily use.
  assertEquals(
    bucketWorkspace(
      { status: "past_due", currentPeriodEnd: null, lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    "past_due",
  );
});

Deno.test("bucketWorkspace: a trial ending within 7 days surfaces", () => {
  assertEquals(
    bucketWorkspace(
      { status: "trialing", currentPeriodEnd: daysAhead(3), lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    "trial_ending",
  );
});

Deno.test("bucketWorkspace: a trial ending later is not yet urgent", () => {
  assertEquals(
    bucketWorkspace(
      { status: "trialing", currentPeriodEnd: daysAhead(20), lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    null,
  );
});

Deno.test("bucketWorkspace: active workspaces are not reported", () => {
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: daysAgo(2), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    null,
  );
});

Deno.test("bucketWorkspace: boundaries match the admin's describeActivity exactly", () => {
  // apps/admin/src/pages/workspace-activity.ts: days <= 7 active, days <= 30 cooling, else dormant.
  const base = { status: "active", currentPeriodEnd: null, createdAt: CREATED_LONG_AGO };
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(7) }, NOW), null);
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(8) }, NOW), "cooling");
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(30) }, NOW), "cooling");
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(31) }, NOW), "dormant");
});

Deno.test("bucketWorkspace: a never-used young workspace is cooling, not dormant", () => {
  // Mirrors describeActivity: a workspace created days ago has not had a chance to be used, so it
  // is unproven rather than abandoned.
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: null, createdAt: daysAgo(3) },
      NOW,
    ),
    "cooling",
  );
});

Deno.test("bucketWorkspace: a never-used old workspace is dormant", () => {
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: null, createdAt: daysAgo(90) },
      NOW,
    ),
    "dormant",
  );
});
