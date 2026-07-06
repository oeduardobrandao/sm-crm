import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDesignRenderSweepCronHandler,
  type DesignRenderSweepCronDeps,
  type StuckDesignRow,
  type SweepFailureDetail,
} from "../design-render-sweep-cron/handler.ts";

interface DepsSpy {
  reFireCalls: Array<{ designId: number; rev: number }>;
  reportFailureCalls: SweepFailureDetail[];
  loggedErrors: unknown[];
}

function makeDeps(
  overrides: Partial<DesignRenderSweepCronDeps> = {},
): { deps: DesignRenderSweepCronDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    reFireCalls: [],
    reportFailureCalls: [],
    loggedErrors: [],
  };

  const deps: DesignRenderSweepCronDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    cronSecret: "test-secret",
    timingSafeEqual: (a, b) => a === b,
    findStuckRows: async () => [],
    reFire: async (designId, rev) => {
      spy.reFireCalls.push({ designId, rev });
      return true;
    },
    reportFailure: async (detail) => {
      spy.reportFailureCalls.push(detail);
    },
    logError: (_context, error) => {
      spy.loggedErrors.push(error);
    },
    ...overrides,
  };

  return { deps, spy };
}

function makeReq(secret = "test-secret") {
  return new Request("http://localhost/design-render-sweep-cron", {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
}

function makeRow(overrides: Partial<StuckDesignRow> = {}): StuckDesignRow {
  return { id: 1, rev: 3, ...overrides };
}

// ============================================================
// Auth
// ============================================================

Deno.test("rejects requests without a valid x-cron-secret", async () => {
  const { deps } = makeDeps();
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq("wrong-secret"));
  assertEquals(res.status, 401);
});

Deno.test("handles OPTIONS preflight without checking the secret", async () => {
  const { deps } = makeDeps();
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(
    new Request("http://localhost/design-render-sweep-cron", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
});

// ============================================================
// No-op
// ============================================================

Deno.test("no stuck rows: swept 0, no re-fires, no failure report", async () => {
  const { deps, spy } = makeDeps({ findStuckRows: async () => [] });
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { swept: 0, refired: 0, skipped: 0, failed: 0 });
  assertEquals(spy.reFireCalls.length, 0);
  assertEquals(spy.reportFailureCalls.length, 0);
});

// ============================================================
// Successful re-fires / skips — this handler no longer decides what R2 objects a reclaim
// invalidates (that moved into claim_design_render itself, migration 20260702000004, to close a
// TOCTOU race a caller-side snapshot could never close safely). It only counts outcomes.
// ============================================================

Deno.test("a stuck row is re-fired using its snapshotted id/rev", async () => {
  const { deps, spy } = makeDeps({
    findStuckRows: async () => [makeRow({ id: 5, rev: 9 })],
  });
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq());
  const body = await res.json();
  assertEquals(body, { swept: 1, refired: 1, skipped: 0, failed: 0 });
  assertEquals(spy.reFireCalls, [{ designId: 5, rev: 9 }]);
});

Deno.test("a re-fire that reports no claim (still-alive render, or rev already moved) counts as skipped", async () => {
  const { deps } = makeDeps({
    findStuckRows: async () => [makeRow()],
    reFire: async () => false, // 409/204 — the row wasn't actually reclaimed
  });
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq());
  const body = await res.json();
  assertEquals(body, { swept: 1, refired: 0, skipped: 1, failed: 0 });
});

// ============================================================
// Failures
// ============================================================

Deno.test("a re-fire that throws is counted as failed and reported", async () => {
  const { deps, spy } = makeDeps({
    findStuckRows: async () => [makeRow({ id: 7 })],
    reFire: async () => {
      throw new Error("network unreachable");
    },
  });
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq());
  const body = await res.json();
  assertEquals(body, { swept: 1, refired: 0, skipped: 0, failed: 1 });
  assertEquals(spy.loggedErrors.length, 1);
  assertEquals(spy.reportFailureCalls.length, 1);
  assertEquals(spy.reportFailureCalls[0].total, 1);
  assertEquals(spy.reportFailureCalls[0].failed, 1);
  assertEquals(spy.reportFailureCalls[0].errors, [{ designId: 7, error: "network unreachable" }]);
});

Deno.test("mixed outcomes across multiple rows aggregate correctly and report only the failures", async () => {
  const { deps, spy } = makeDeps({
    findStuckRows: async () => [
      makeRow({ id: 1 }), // succeeds
      makeRow({ id: 2 }), // succeeds
      makeRow({ id: 3 }), // skipped (no-op)
      makeRow({ id: 4 }), // fails
    ],
    reFire: async (designId) => {
      if (designId === 3) return false;
      if (designId === 4) throw new Error("boom");
      return true;
    },
  });
  const handler = createDesignRenderSweepCronHandler(deps);
  const res = await handler(makeReq());
  const body = await res.json();
  assertEquals(body, { swept: 4, refired: 2, skipped: 1, failed: 1 });
  assertEquals(spy.reportFailureCalls.length, 1);
  assertEquals(spy.reportFailureCalls[0].errors, [{ designId: 4, error: "boom" }]);
});

Deno.test("no failures means reportFailure is never called", async () => {
  const { deps, spy } = makeDeps({
    findStuckRows: async () => [makeRow({ id: 1 }), makeRow({ id: 2 })],
  });
  const handler = createDesignRenderSweepCronHandler(deps);
  await handler(makeReq());
  assertEquals(spy.reportFailureCalls.length, 0);
});
