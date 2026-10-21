import { assertEquals } from "./assert.ts";
import {
  buildMonths,
  classOf,
  computeCloses,
  diffCloses,
  type SnapshotRecord,
} from "../platform-admin/metrics-logic.ts";

const row = (over: Partial<SnapshotRecord>): SnapshotRecord => ({
  workspace_id: "w",
  snapshot_date: "2026-08-31",
  provider: "stripe",
  plan_id: "pro",
  plan_name: "Pro",
  status: "active",
  billing_interval: "month",
  monthly_cents: 10000,
  amount_source: "stripe",
  provider_switch: false,
  ...over,
});

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
const mrr = (rows: SnapshotRecord[]) =>
  rows.filter((r) => classOf(r) === "paying").reduce((a, r) => a + r.monthly_cents, 0);

Deno.test("classOf: paying needs active AND a positive amount; switch-in-progress trial is paying", () => {
  assertEquals(classOf(undefined), "out");
  assertEquals(classOf(row({})), "paying");
  assertEquals(classOf(row({ monthly_cents: 0 })), "out");
  assertEquals(classOf(row({ status: "past_due" })), "past_due");
  assertEquals(classOf(row({ status: "trialing" })), "out");
  assertEquals(classOf(row({ status: "canceled" })), "out");
  assertEquals(classOf(row({ provider: "pagarme", status: "trialing", provider_switch: true })), "paying");
  assertEquals(classOf(row({ provider: "pagarme", status: "trialing", provider_switch: true, monthly_cents: 0 })), "out");
});

Deno.test("diffCloses covers all nine class transitions and reconciles with the MRR delta", () => {
  // "none->pay" exists only in cur; "pay->gone" and "pd->gone" exist only in prev.
  const prev = [
    row({ workspace_id: "trial->pay", status: "trialing" }),
    row({ workspace_id: "canceled->pay", status: "canceled" }),
    row({ workspace_id: "expand", monthly_cents: 10000 }),
    row({ workspace_id: "contract", monthly_cents: 10000 }),
    row({ workspace_id: "same", monthly_cents: 10000 }),
    row({ workspace_id: "switch", monthly_cents: 10000, provider: "stripe" }),
    row({ workspace_id: "pay->pd", monthly_cents: 7000 }),
    row({ workspace_id: "pay->gone", monthly_cents: 5000 }),
    row({ workspace_id: "pay->canceled", monthly_cents: 4000 }),
    row({ workspace_id: "pd->pay", status: "past_due", monthly_cents: 3000 }),
    row({ workspace_id: "pd->gone", status: "past_due", monthly_cents: 2000 }),
    row({ workspace_id: "pd->pd", status: "past_due", monthly_cents: 1500 }),
    row({ workspace_id: "out->pd", status: "trialing" }),
  ];
  const cur = [
    row({ workspace_id: "none->pay", monthly_cents: 6000 }),
    row({ workspace_id: "trial->pay", monthly_cents: 10000 }),
    row({ workspace_id: "canceled->pay", monthly_cents: 8000 }),
    row({ workspace_id: "expand", monthly_cents: 12000 }),
    row({ workspace_id: "contract", monthly_cents: 9000 }),
    row({ workspace_id: "same", monthly_cents: 10000 }),
    row({ workspace_id: "switch", monthly_cents: 11000, provider: "pagarme" }),
    row({ workspace_id: "pay->pd", status: "past_due", monthly_cents: 7000 }),
    row({ workspace_id: "pay->canceled", status: "canceled", monthly_cents: 4000 }),
    row({ workspace_id: "pd->pay", monthly_cents: 3000 }),
    row({ workspace_id: "pd->pd", status: "past_due", monthly_cents: 1500 }),
    row({ workspace_id: "out->pd", status: "past_due", monthly_cents: 9999 }),
  ];
  const { movements, churn } = diffCloses(prev, cur);
  assertEquals(movements, {
    new: 6000 + 10000 + 8000,
    expansion: 2000,
    contraction: -1000,
    past_due: -7000,
    recovered: 3000,
    churn: -(5000 + 4000),
    switch: 1000,
  });
  assertEquals(sum(movements as unknown as Record<string, number>), mrr(cur) - mrr(prev));
  // churn block: pay->gone, pay->canceled, pd->gone. Base = paying + past_due at prev close.
  assertEquals(churn.logos, 3);
  assertEquals(churn.lost_cents, 5000 + 4000 + 2000);
  assertEquals(churn.base_logos, 10); // expand, contract, same, switch, pay->pd, pay->gone, pay->canceled, pd->pay, pd->gone, pd->pd
  assertEquals(churn.base_cents, 10000 * 4 + 7000 + 5000 + 4000 + 3000 + 2000 + 1500);
  assertEquals(churn.logo_pct, 3 / 10);
  assertEquals(churn.revenue_pct, (11000 + 1000) / (10000 * 4 + 7000 + 5000 + 4000 + 3000 + 2000 + 1500));
});

Deno.test("diffCloses: a switch with provider_switch=false (marker already cleared) is still a switch", () => {
  const { movements } = diffCloses(
    [row({ workspace_id: "w", provider: "stripe", monthly_cents: 10000 })],
    [row({ workspace_id: "w", provider: "pagarme", monthly_cents: 10000, provider_switch: false })],
  );
  assertEquals(movements.switch, 0);
  assertEquals(movements.churn, 0);
  assertEquals(movements.new, 0);
});

Deno.test("diffCloses: zero denominators give null percentages", () => {
  const { churn } = diffCloses([], [row({})]);
  assertEquals(churn.logo_pct, null);
  assertEquals(churn.revenue_pct, null);
});

Deno.test("computeCloses: calendar series from first marker month, latest marker per month, gaps missing", () => {
  const closes = computeCloses(
    [
      { snapshot_date: "2026-06-30", source: "backfill" },
      { snapshot_date: "2026-08-29", source: "cron" },
      { snapshot_date: "2026-08-30", source: "cron" },
      { snapshot_date: "2026-09-24", source: "cron" },
    ],
    "2026-09",
  );
  assertEquals(closes, [
    { month: "2026-06", close_date: "2026-06-30", source: "backfill", closed: true },
    { month: "2026-07", close_date: null, source: null, closed: true },
    { month: "2026-08", close_date: "2026-08-30", source: "cron", closed: true },
    { month: "2026-09", close_date: "2026-09-24", source: "cron", closed: false },
  ]);
  assertEquals(computeCloses([], "2026-09"), []);
});

Deno.test("computeCloses: the current month without a marker yet is left out; a past gap stays missing", () => {
  // 1 Sep before the 23:44 cron: no September marker yet, July never had one.
  const closes = computeCloses(
    [
      { snapshot_date: "2026-06-30", source: "backfill" },
      { snapshot_date: "2026-08-31", source: "cron" },
    ],
    "2026-09",
  );
  assertEquals(closes, [
    { month: "2026-06", close_date: "2026-06-30", source: "backfill", closed: true },
    { month: "2026-07", close_date: null, source: null, closed: true },
    { month: "2026-08", close_date: "2026-08-31", source: "cron", closed: true },
  ]);
});

Deno.test("buildMonths: first month has no movements; a missing month is skipped for the comparison", () => {
  const months = buildMonths(
    [
      { month: "2026-06", close_date: "2026-06-30", source: "backfill", closed: true },
      { month: "2026-07", close_date: null, source: null, closed: true },
      { month: "2026-08", close_date: "2026-08-31", source: "backfill", closed: true },
    ],
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", monthly_cents: 10000 })]],
      ["2026-08-31", [
        row({ workspace_id: "a", snapshot_date: "2026-08-31", monthly_cents: 10000 }),
        row({ workspace_id: "b", snapshot_date: "2026-08-31", provider: "pagarme", plan_id: "max", plan_name: "Max", monthly_cents: 20000 }),
      ]],
    ]),
  );
  assertEquals(months[0].movements, null);
  assertEquals(months[0].mrr_cents, 10000);
  assertEquals(months[0].arr_cents, 120000);
  assertEquals(months[1].missing, true);
  assertEquals(months[1].mrr_cents, null);
  assertEquals(months[1].movements, null);
  assertEquals(months[2].movements_since, "2026-06");
  assertEquals(months[2].movements?.new, 20000);
  assertEquals(months[2].by_provider, { stripe: 10000, pagarme: 20000 });
  assertEquals(months[2].by_plan, [
    { plan_id: "max", name: "Max", mrr_cents: 20000 },
    { plan_id: "pro", name: "Pro", mrr_cents: 10000 },
  ]);
  assertEquals(months[2].paying_count, 2);
});

Deno.test("buildMonths: a close with a marker and zero rows is a real month with total churn", () => {
  const months = buildMonths(
    [
      { month: "2026-08", close_date: "2026-08-31", source: "cron", closed: true },
      { month: "2026-09", close_date: "2026-09-30", source: "cron", closed: true },
    ],
    new Map([["2026-08-31", [row({ workspace_id: "a", monthly_cents: 10000 })]], ["2026-09-30", []]]),
  );
  assertEquals(months[1].missing, false);
  assertEquals(months[1].mrr_cents, 0);
  assertEquals(months[1].movements?.churn, -10000);
  assertEquals(months[1].churn?.logo_pct, 1);
});

Deno.test("buildMonths: an unpriced active row inherits the previous close's row instead of churning then reappearing as new", () => {
  const closes = [
    { month: "2026-06", close_date: "2026-06-30", source: "cron" as const, closed: true },
    { month: "2026-07", close_date: "2026-07-31", source: "cron" as const, closed: true },
    { month: "2026-08", close_date: "2026-08-31", source: "cron" as const, closed: true },
  ];
  const months = buildMonths(
    closes,
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", monthly_cents: 10000, amount_source: "stripe" })]],
      ["2026-07-31", [row({ workspace_id: "a", snapshot_date: "2026-07-31", monthly_cents: 0, amount_source: "unpriced" })]],
      ["2026-08-31", [row({ workspace_id: "a", snapshot_date: "2026-08-31", monthly_cents: 10000, amount_source: "stripe" })]],
    ]),
  );
  const zeroMovements = { new: 0, expansion: 0, contraction: 0, past_due: 0, recovered: 0, churn: 0, switch: 0 };
  assertEquals(months[1].mrr_cents, 10000);
  assertEquals(months[1].paying_count, 1);
  assertEquals(months[1].movements, zeroMovements);
  assertEquals(months[1].churn?.lost_cents, 0);
  assertEquals(months[2].mrr_cents, 10000);
  assertEquals(months[2].movements, zeroMovements);
  assertEquals(months[2].churn?.lost_cents, 0);
});

Deno.test("buildMonths: a resolved zero amount (not unpriced) after a paying close is Churn, not inherited", () => {
  const months = buildMonths(
    [
      { month: "2026-07", close_date: "2026-07-31", source: "cron", closed: true },
      { month: "2026-08", close_date: "2026-08-31", source: "cron", closed: true },
    ],
    new Map([
      ["2026-07-31", [row({ workspace_id: "a", snapshot_date: "2026-07-31", monthly_cents: 10000, amount_source: "stripe" })]],
      ["2026-08-31", [row({ workspace_id: "a", snapshot_date: "2026-08-31", monthly_cents: 0, amount_source: "stripe" })]],
    ]),
  );
  assertEquals(months[1].mrr_cents, 0);
  assertEquals(months[1].paying_count, 0);
  assertEquals(months[1].movements?.churn, -10000);
  assertEquals(months[1].churn?.logos, 1);
  assertEquals(months[1].churn?.lost_cents, 10000);
});

Deno.test("buildMonths: two consecutive unpriced closes chain-inherit the same value", () => {
  const closes = [
    { month: "2026-06", close_date: "2026-06-30", source: "cron" as const, closed: true },
    { month: "2026-07", close_date: "2026-07-31", source: "cron" as const, closed: true },
    { month: "2026-08", close_date: "2026-08-31", source: "cron" as const, closed: true },
  ];
  const months = buildMonths(
    closes,
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", monthly_cents: 10000, amount_source: "stripe" })]],
      ["2026-07-31", [row({ workspace_id: "a", snapshot_date: "2026-07-31", monthly_cents: 0, amount_source: "unpriced" })]],
      ["2026-08-31", [row({ workspace_id: "a", snapshot_date: "2026-08-31", monthly_cents: 0, amount_source: "unpriced" })]],
    ]),
  );
  assertEquals(months[1].mrr_cents, 10000);
  assertEquals(months[2].mrr_cents, 10000);
  assertEquals(months[1].movements?.new, 0);
  assertEquals(months[2].movements?.new, 0);
});

Deno.test("buildMonths: unpriced row with no row at the previous available close counts as out, no New", () => {
  const closes = [
    { month: "2026-06", close_date: "2026-06-30", source: "cron" as const, closed: true },
    { month: "2026-07", close_date: "2026-07-31", source: "cron" as const, closed: true },
  ];
  const months = buildMonths(
    closes,
    new Map([
      ["2026-06-30", []],
      ["2026-07-31", [row({ workspace_id: "a", snapshot_date: "2026-07-31", monthly_cents: 0, amount_source: "unpriced" })]],
    ]),
  );
  assertEquals(months[1].mrr_cents, 0);
  assertEquals(months[1].paying_count, 0);
  assertEquals(months[1].movements?.new, 0);
});

Deno.test("buildMonths: unpriced row on the very first close (no previous close at all) counts as out", () => {
  const months = buildMonths(
    [{ month: "2026-06", close_date: "2026-06-30", source: "cron" as const, closed: true }],
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", monthly_cents: 0, amount_source: "unpriced" })]],
    ]),
  );
  assertEquals(months[0].mrr_cents, 0);
  assertEquals(months[0].paying_count, 0);
});

Deno.test("buildMonths: unpriced row inherits past_due from the previous close, not Recuperado", () => {
  const closes = [
    { month: "2026-06", close_date: "2026-06-30", source: "cron" as const, closed: true },
    { month: "2026-07", close_date: "2026-07-31", source: "cron" as const, closed: true },
  ];
  const months = buildMonths(
    closes,
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", status: "past_due", monthly_cents: 7000, amount_source: "stripe" })]],
      ["2026-07-31", [row({ workspace_id: "a", snapshot_date: "2026-07-31", status: "active", monthly_cents: 0, amount_source: "unpriced" })]],
    ]),
  );
  assertEquals(months[1].mrr_cents, 0);
  assertEquals(months[1].paying_count, 0);
  assertEquals(months[1].movements, { new: 0, expansion: 0, contraction: 0, past_due: 0, recovered: 0, churn: 0, switch: 0 });
});
