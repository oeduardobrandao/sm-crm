import { assert, assertEquals } from "./assert.ts";
import { parseEmailMetricsRange } from "../platform-admin/email-metrics.ts";
import {
  type BackfillDeps,
  type EmailSendRow,
  type ResendListItem,
  runEmailBackfill,
} from "../platform-admin/email-backfill.ts";

Deno.test("range: valid week", () => {
  assertEquals(parseEmailMetricsRange({ start: "2026-11-01", end: "2026-11-07" }), {
    start: "2026-11-01",
    end: "2026-11-07",
  });
});

Deno.test("range: rejects invalid input", () => {
  for (
    const b of [
      { start: "2026-02-30", end: "2026-03-05" },
      { start: "2026-11-07", end: "2026-11-01" },
      { start: "2026-11-01" },
      { end: "2026-11-01" },
      null,
      "x",
      { start: 1, end: 2 },
    ]
  ) {
    assert("error" in (parseEmailMetricsRange(b) as object), JSON.stringify(b));
  }
});

Deno.test("range: 365 days of difference accepted, 366 rejected", () => {
  assert(!("error" in parseEmailMetricsRange({ start: "2025-11-06", end: "2026-11-06" })));
  assert("error" in parseEmailMetricsRange({ start: "2025-11-05", end: "2026-11-06" }));
});

const item = (id: string, created_at: string, over: Partial<ResendListItem> = {}): ResendListItem => ({
  id,
  from: "Mesaas <cobranca@mesaas.com.br>",
  subject: "s",
  created_at,
  last_event: "delivered",
  to: ["a@b.com"],
  ...over,
});

function makeDeps(pages: { data: ResendListItem[]; has_more: boolean }[], inserted: number[] = []) {
  const cursors: (string | null)[] = [];
  const sleeps: number[] = [];
  const rows: EmailSendRow[][] = [];
  let i = 0;
  const deps: BackfillDeps = {
    listPage: (c) => {
      cursors.push(c);
      return Promise.resolve(pages[i++]);
    },
    insertRows: (r) => {
      rows.push(r);
      return Promise.resolve(inserted[rows.length - 1] ?? r.length);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
  return { deps, cursors, sleeps, rows };
}

const PAGES = () => [
  { data: [item("e1", "2026-11-05T10:00:00Z"), item("e2", "2026-11-05T09:00:00Z", { last_event: "opened" })], has_more: true },
  { data: [item("e3", "2026-11-04T10:00:00Z", { last_event: "bounced", subject: "Oi" })], has_more: true },
  { data: [item("e4", "2026-11-03T08:00:00Z")], has_more: false },
];

Deno.test("backfill: walks to the end", async () => {
  const t = makeDeps(PAGES());
  const r = await runEmailBackfill(null, t.deps);
  assertEquals(r.done, true);
  assertEquals(r.scanned, 4);
  assertEquals(r.inserted, 4);
  assertEquals(r.nextCursor, "e4");
  assertEquals(r.oldestReached, "2026-11-03T08:00:00Z");
  assertEquals(t.cursors, [null, "e2", "e3"]);
  assertEquals(t.sleeps, [120, 120]);
});

Deno.test("backfill: maxPages stops with done=false", async () => {
  const t = makeDeps(PAGES());
  const r = await runEmailBackfill(null, t.deps, 2);
  assertEquals(r.done, false);
  assertEquals(r.nextCursor, "e3");
  assertEquals(r.scanned, 3);
  assertEquals(t.cursors.length, 2);
});

Deno.test("backfill: rows are classified, normalized, PII only for PII events", async () => {
  const t = makeDeps(PAGES());
  await runEmailBackfill(null, t.deps);
  const all = t.rows.flat();
  assert(all.every((r) => r.source === "backfill"));
  const e2 = all.find((r) => r.email_id === "e2")!;
  assertEquals(e2.last_event, "delivered");
  assertEquals(e2.recipient, null);
  assertEquals(e2.subject, null);
  assertEquals(e2.category, "cobranca");
  const e3 = all.find((r) => r.email_id === "e3")!;
  assertEquals(e3.last_event, "bounced");
  assertEquals(e3.recipient, "a@b.com");
  assertEquals(e3.subject, "Oi");
  assertEquals(e3.bounce_message, null);
  assertEquals(e3.sent_at, "2026-11-04T10:00:00Z");
});

Deno.test("backfill: failed/suppressed/complained also keep recipient and subject", async () => {
  const ev = ["failed", "suppressed", "complained"];
  const t = makeDeps([{ data: ev.map((e, n) => item(`x${n}`, "2026-11-01T00:00:00Z", { last_event: e })), has_more: false }]);
  await runEmailBackfill(null, t.deps);
  assert(t.rows[0].every((r) => r.recipient === "a@b.com" && r.subject === "s"));
});

Deno.test("backfill: inserted is what insertRows returns (idempotent rerun)", async () => {
  const t = makeDeps(PAGES(), [2, 0, 0]);
  const r = await runEmailBackfill(null, t.deps);
  assertEquals(r.inserted, 2);
  assertEquals(r.scanned, 4);
});

Deno.test("backfill: missing has_more with short page is treated as done", async () => {
  const t = makeDeps([{ data: [item("e1", "2026-11-05T10:00:00Z")] } as unknown as { data: ResendListItem[]; has_more: boolean }]);
  const r = await runEmailBackfill(null, t.deps);
  assertEquals(r.done, true);
});

Deno.test("backfill: empty page keeps the incoming cursor and is done", async () => {
  const t = makeDeps([{ data: [], has_more: false }]);
  const r = await runEmailBackfill("c0", t.deps);
  assertEquals(r.done, true);
  assertEquals(r.nextCursor, "c0");
  assertEquals(r.oldestReached, null);
});

import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { handleEmailMetrics } from "../platform-admin/email-metrics.ts";

Deno.test("handleEmailMetrics: 400 on bad range, passes rpc json, generic 500", async () => {
  const H = { "Content-Type": "application/json" };
  const db = createSupabaseQueryMock();
  assertEquals((await handleEmailMetrics(db as never, {}, H)).status, 400);
  db.queueRpc("email_metrics", { data: { by_type: [] } });
  const ok = await handleEmailMetrics(db as never, { start: "2026-11-01", end: "2026-11-02" }, H);
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { by_type: [] });
  assertEquals(db.calls.find((c) => c.table === "rpc:email_metrics") !== undefined, true);
  db.queueRpc("email_metrics", { data: null, error: { message: "boom secret" } });
  const orig = console.error;
  console.error = () => {};
  const bad = await handleEmailMetrics(db as never, { start: "2026-11-01", end: "2026-11-02" }, H);
  console.error = orig;
  assertEquals(bad.status, 500);
  assertEquals(await bad.json(), { error: "Internal server error" });
});

Deno.test("backfill: recipient and subject only kept for PII events within 90 days", async () => {
  const now = Date.parse("2026-11-06T00:00:00Z");
  const t = makeDeps([{
    data: [
      item("new", "2026-10-01T00:00:00Z", { last_event: "bounced" }),
      item("old", "2026-07-01T00:00:00Z", { last_event: "bounced" }),
    ],
    has_more: false,
  }]);
  t.deps.now = () => now;
  await runEmailBackfill(null, t.deps);
  const [fresh, old] = t.rows[0];
  assertEquals(fresh.recipient, "a@b.com");
  assertEquals(fresh.subject, "s");
  assertEquals(old.recipient, null);
  assertEquals(old.subject, null);
});
