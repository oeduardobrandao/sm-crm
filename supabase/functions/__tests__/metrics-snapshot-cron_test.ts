import { assertEquals } from "./assert.ts";
import {
  type PricedSnapshotSource,
  type SnapshotRow,
  toSnapshotRows,
  writeSnapshot,
} from "../_shared/metrics-snapshot.ts";
import { createMetricsSnapshotHandler } from "../metrics-snapshot-cron/handler.ts";

const base: PricedSnapshotSource = {
  workspace_id: "w1",
  provider: "stripe",
  status: "active",
  plan_id: "pro",
  plan_name: "Pro",
  interval: "month",
  amount_cents: 9900,
  amount_source: "stripe",
  switched_from_stripe_subscription_id: null,
};

Deno.test("toSnapshotRows normalizes to monthly, drops internal and status-less rows", () => {
  const rows = toSnapshotRows(
    [
      base,
      { ...base, workspace_id: "w2", provider: "pagarme", interval: "year", amount_cents: 120000, amount_source: "pagarme", switched_from_stripe_subscription_id: "sub_1", status: "trialing" },
      { ...base, workspace_id: "internal" },
      { ...base, workspace_id: "w3", status: null },
    ],
    new Set(["internal"]),
  );
  assertEquals(rows.map((r) => r.workspace_id), ["w1", "w2"]);
  assertEquals(rows[0].monthly_cents, 9900);
  assertEquals(rows[1].monthly_cents, 10000);
  assertEquals(rows[1].billing_interval, "year");
  assertEquals(rows[1].provider_switch, true);
});

Deno.test("toSnapshotRows maps an unpriced row to amount_source 'unpriced' with 0 cents", () => {
  const [row] = toSnapshotRows([{ ...base, amount_cents: null, amount_source: null }], new Set());
  assertEquals(row.amount_source, "unpriced");
  assertEquals(row.monthly_cents, 0);
});

Deno.test("toSnapshotRows keeps the real source for a resolved zero amount (100% coupon)", () => {
  const [row] = toSnapshotRows([{ ...base, amount_cents: 0, amount_source: "stripe" }], new Set());
  assertEquals(row.amount_source, "stripe");
  assertEquals(row.monthly_cents, 0);
});

Deno.test("writeSnapshot calls the RPC and throws on error", async () => {
  const calls: unknown[] = [];
  const ok = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return Promise.resolve({ data: { written: 1, skipped: false }, error: null });
    },
  };
  const res = await writeSnapshot(ok, "2026-09-24", "cron", []);
  assertEquals(res, { written: 1, skipped: false });
  assertEquals(calls, [["admin_metrics_write_snapshot", { p_date: "2026-09-24", p_source: "cron", p_rows: [] }]]);

  const bad = { rpc: () => Promise.resolve({ data: null, error: { message: "denied" } }) };
  let threw = false;
  try {
    await writeSnapshot(bad, "2026-09-24", "cron", []);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

function makeDeps(over: Partial<Parameters<typeof createMetricsSnapshotHandler>[0]> = {}) {
  const written: Array<{ date: string; rows: SnapshotRow[] }> = [];
  const failures: string[] = [];
  const deps = {
    cronSecret: "s3cret",
    timingSafeEqual: (a: string, b: string) => a === b,
    now: () => new Date("2026-10-01T02:44:00Z"),
    loadPricedRows: () => Promise.resolve([base]),
    loadInternalIds: () => Promise.resolve(new Set<string>()),
    write: (date: string, rows: SnapshotRow[]) => {
      written.push({ date, rows });
      return Promise.resolve({ written: rows.length, skipped: false });
    },
    reportFailure: (m: string) => {
      failures.push(m);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, written, failures };
}

const req = (secret?: string) =>
  new Request("http://x/metrics-snapshot-cron", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  });

Deno.test("cron rejects a missing or wrong secret without doing any work", async () => {
  const { deps, written } = makeDeps();
  const handler = createMetricsSnapshotHandler(deps);
  assertEquals((await handler(req())).status, 401);
  assertEquals((await handler(req("nope"))).status, 401);
  assertEquals(written.length, 0);
});

Deno.test("cron writes the São Paulo date of its tick (02:44 UTC on the 1st = last day of the month)", async () => {
  const { deps, written } = makeDeps();
  const res = await createMetricsSnapshotHandler(deps)(req("s3cret"));
  assertEquals(res.status, 200);
  assertEquals(written[0].date, "2026-09-30");
  assertEquals(written[0].rows.length, 1);
  const body = await res.json();
  assertEquals(body, { success: true, snapshot_date: "2026-09-30", written: 1 });
});

Deno.test("cron aborts before writing when the internal-workspace lookup fails", async () => {
  const { deps, written, failures } = makeDeps({
    loadInternalIds: () => Promise.reject(new Error("internal workspace lookup failed: boom")),
  });
  const res = await createMetricsSnapshotHandler(deps)(req("s3cret"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal server error" });
  assertEquals(written.length, 0);
  assertEquals(failures.length, 1);
});
