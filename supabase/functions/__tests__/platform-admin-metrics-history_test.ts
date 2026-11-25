import { assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleGetMetricsHistory } from "../platform-admin/metrics-history.ts";

function fakeSvc(runs: unknown[], snapshots: Array<Record<string, unknown>>) {
  const requestedDates: string[][] = [];
  const db = {
    from(table: string) {
      if (table === "metrics_snapshot_runs") {
        return {
          select: () => ({
            order: () => ({ range: (f: number, t: number) => Promise.resolve({ data: runs.slice(f, t + 1), error: null }) }),
          }),
        };
      }
      if (table === "workspace_subscription_snapshots") {
        return {
          select: () => ({
            in: (_col: string, dates: string[]) => {
              requestedDates.push(dates);
              const data = snapshots.filter((s) => dates.includes(s.snapshot_date as string));
              const orderStep = {
                order: () => orderStep,
                range: (f: number, t: number) => Promise.resolve({ data: data.slice(f, t + 1), error: null }),
              };
              return orderStep;
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { svc: db as unknown as SupabaseClient, requestedDates };
}

Deno.test("get-metrics-history reads only close dates and returns the calendar series", async () => {
  const snap = (ws: string, date: string, cents: number) => ({
    workspace_id: ws, snapshot_date: date, provider: "stripe", plan_id: "pro", plan_name: "Pro",
    status: "active", monthly_cents: cents, provider_switch: false,
  });
  const { svc, requestedDates } = fakeSvc(
    [
      { snapshot_date: "2026-08-31", source: "backfill" },
      { snapshot_date: "2026-09-23", source: "cron" },
      { snapshot_date: "2026-09-24", source: "cron" },
    ],
    [snap("a", "2026-08-31", 10000), snap("a", "2026-09-23", 10000), snap("a", "2026-09-24", 12000)],
  );
  const res = await handleGetMetricsHistory(svc, { "Content-Type": "application/json" }, new Date("2026-09-25T12:00:00Z"));
  assertEquals(res.status, 200);
  const body = await res.json();
  // fetchAllRows always confirms the end of a page set with one more, empty-page
  // request (see _shared/paginate.ts) even when the first page already came back
  // short of pageSize -- so a non-empty single-page result still issues .in() twice
  // with the SAME ids. The two identical entries here are that confirming round
  // trip, not a second, broader query: every call only ever asks for the close
  // dates, never the full snapshot history.
  assertEquals(requestedDates, [
    ["2026-08-31", "2026-09-24"],
    ["2026-08-31", "2026-09-24"],
  ]);
  assertEquals(body.first_month, "2026-08");
  assertEquals(body.months.map((m: { month: string }) => m.month), ["2026-08", "2026-09"]);
  assertEquals(body.months[1].closed, false);
  assertEquals(body.months[1].movements.expansion, 2000);
});

Deno.test("get-metrics-history with no markers returns an empty series", async () => {
  const { svc } = fakeSvc([], []);
  const body = await (await handleGetMetricsHistory(svc, {}, new Date("2026-09-25T12:00:00Z"))).json();
  assertEquals(body.first_month, null);
  assertEquals(body.months, []);
});

Deno.test("get-metrics-history splits BRL and USD months, never summing the two", async () => {
  const snap = (ws: string, cents: number, currency?: string) => ({
    workspace_id: ws, snapshot_date: "2026-08-31", provider: "stripe", plan_id: "pro", plan_name: "Pro",
    status: "active", monthly_cents: cents, amount_source: "stripe", provider_switch: false,
    ...(currency ? { currency } : {}),
  });
  const { svc } = fakeSvc(
    [{ snapshot_date: "2026-08-31", source: "cron" }],
    [snap("br", 13990, "brl"), snap("us", 4900, "usd")],
  );
  const body = await (await handleGetMetricsHistory(svc, {}, new Date("2026-09-25T12:00:00Z"))).json();
  assertEquals(body.months.length, 1);
  assertEquals(body.months_usd.length, 1);
  assertEquals(body.months[0].mrr_cents, 13990);
  assertEquals(body.months[0].paying_count, 1);
  assertEquals(body.months_usd[0].mrr_cents, 4900);
  assertEquals(body.months_usd[0].paying_count, 1);
  assertEquals(body.months_usd[0].month, "2026-08");

  // A row without a currency key (read before the column existed) counts as BRL.
  const legacy = fakeSvc([{ snapshot_date: "2026-08-31", source: "cron" }], [snap("old", 1000)]);
  const legacyBody = await (await handleGetMetricsHistory(legacy.svc, {}, new Date("2026-09-25T12:00:00Z"))).json();
  assertEquals(legacyBody.months[0].mrr_cents, 1000);
  assertEquals(legacyBody.months_usd[0].mrr_cents, 0);
});
