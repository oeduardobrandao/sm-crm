import { assertEquals } from "./assert.ts";
import {
  type AcqRow,
  type AcqWorkspace,
  aggregateChannels,
  bucketOf,
  monthBounds,
} from "../platform-admin/acquisition-logic.ts";
import { handleGetAcquisitionChannels } from "../platform-admin/acquisition.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json" };
const ws = (id: string, over: Partial<AcqWorkspace> = {}): AcqWorkspace => ({
  id,
  created_at: "2026-11-10T12:00:00Z",
  demo_created_at: null,
  is_internal: false,
  ...over,
});
const acq = (workspace_id: string, channel: string, campaign: string | null = null): AcqRow => ({
  workspace_id,
  channel,
  campaign,
});

Deno.test("monthBounds: São Paulo midnight, both ends inclusive", () => {
  assertEquals(monthBounds("2026-11", "2026-11"), {
    startIso: "2026-11-01T00:00:00-03:00",
    endIso: "2026-12-01T00:00:00-03:00",
  });
  assertEquals(monthBounds("2026-11", "2026-12")?.endIso, "2027-01-01T00:00:00-03:00");
});

Deno.test("monthBounds: rejects malformed, reversed and > 24 months", () => {
  assertEquals(monthBounds("2026-13", "2026-13"), null);
  assertEquals(monthBounds("2026-1", "2026-11"), null);
  assertEquals(monthBounds("2026-11", "2026-10"), null);
  assertEquals(monthBounds("2024-01", "2026-02"), null);
  assertEquals(monthBounds("2024-01", "2025-12") !== null, true);
});

Deno.test("23:30 São Paulo on Nov 30 counts in November (Review Focus 5)", () => {
  const t = Date.parse("2026-12-01T02:30:00Z");
  const nov = monthBounds("2026-11", "2026-11")!;
  const dec = monthBounds("2026-12", "2026-12")!;
  assertEquals(t >= Date.parse(nov.startIso) && t < Date.parse(nov.endIso), true);
  assertEquals(t >= Date.parse(dec.startIso) && t < Date.parse(dec.endIso), false);
});

Deno.test("bucketOf: demo wins, then channel, then no_data", () => {
  assertEquals(bucketOf(ws("a", { demo_created_at: "2026-11-01T00:00:00Z" }), acq("a", "meta")), "demo");
  assertEquals(bucketOf(ws("a"), acq("a", "meta")), "meta");
  assertEquals(bucketOf(ws("a"), undefined), "no_data");
});

Deno.test("aggregateChannels: is_internal dropped, currencies apart", () => {
  const rows = aggregateChannels({
    workspaces: [ws("a"), ws("b"), ws("c", { is_internal: true })],
    acquisition: new Map([
      ["a", acq("a", "meta")],
      ["b", acq("b", "meta")],
      ["c", acq("c", "meta")],
    ]),
    priced: [
      { workspace_id: "a", currency: "usd", monthly_cents: 2900 },
      { workspace_id: "b", currency: "brl", monthly_cents: 13990 },
      { workspace_id: "c", currency: "brl", monthly_cents: 50000 },
    ],
    everPaidIds: new Set(),
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].signups, 2);
  assertEquals(rows[0].mrr_cents, { brl: 13990, usd: 2900 });
  assertEquals(rows[0].paying_now, 2);
});

Deno.test("aggregateChannels: ever_paid includes paying-now and past payers", () => {
  const rows = aggregateChannels({
    workspaces: [ws("a"), ws("b"), ws("c")],
    acquisition: new Map([
      ["a", acq("a", "google")],
      ["b", acq("b", "google")],
      ["c", acq("c", "google")],
    ]),
    priced: [{ workspace_id: "a", currency: "brl", monthly_cents: 100 }],
    everPaidIds: new Set(["b"]),
  });
  assertEquals(rows[0].ever_paid, 2);
  assertEquals(rows[0].paying_now, 1);
});

Deno.test("aggregateChannels: campaigns grouped, null campaign last", () => {
  const rows = aggregateChannels({
    workspaces: [ws("a"), ws("b"), ws("c"), ws("d"), ws("e")],
    acquisition: new Map([
      ["a", acq("a", "meta", null)],
      ["b", acq("b", "meta", null)],
      ["c", acq("c", "meta", "x")],
      ["d", acq("d", "meta", "y")],
      ["e", acq("e", "meta", "y")],
    ]),
    priced: [],
    everPaidIds: new Set(),
  });
  assertEquals(rows[0].campaigns.map((c) => [c.campaign, c.signups]), [
    ["y", 2],
    ["x", 1],
    [null, 2],
  ]);
});

Deno.test("aggregateChannels: rows sorted by signups desc", () => {
  const rows = aggregateChannels({
    workspaces: [ws("a"), ws("b"), ws("c")],
    acquisition: new Map([["a", acq("a", "x")], ["b", acq("b", "y")], ["c", acq("c", "y")]]),
    priced: [],
    everPaidIds: new Set(),
  });
  assertEquals(rows.map((r) => r.channel), ["y", "x"]);
});

Deno.test("handler: 400 invalid_range", async () => {
  const res = await handleGetAcquisitionChannels({} as SupabaseClient, { from_month: "2026-11", to_month: "2026-10" }, HEADERS);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_range" });
  const res2 = await handleGetAcquisitionChannels({} as SupabaseClient, {}, HEADERS);
  assertEquals(res2.status, 400);
});

Deno.test("handler: ever paid comes from the ever_paid_workspace_ids RPC, called per chunk", async () => {
  const N = 1250;
  const all = Array.from({ length: N }, (_, i) => ({
    id: `w${i}`,
    created_at: "2026-11-10T12:00:00Z",
    demo_created_at: null,
    is_internal: false,
  }));
  const rpcSizes: number[] = [];
  const inSizes: number[] = [];
  const svc = {
    from(table: string) {
      if (table === "workspaces") {
        return {
          select: () => ({
            gte: () => ({
              lt: () => ({
                order: () => ({
                  range: (from: number, to: number) =>
                    Promise.resolve({ data: all.slice(from, to + 1), error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "workspace_acquisition") {
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => {
              inSizes.push(ids.length);
              return Promise.resolve({
                data: ids.map((id) => ({ workspace_id: id, channel: "meta", campaign: null })),
                error: null,
              });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: { p_ids: string[] }) {
      if (name !== "ever_paid_workspace_ids") throw new Error(name);
      rpcSizes.push(args.p_ids.length);
      return Promise.resolve({
        data: args.p_ids.filter((id) => id === "w1" || id === "w700").map((workspace_id) => ({ workspace_id })),
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  const res = await handleGetAcquisitionChannels(
    svc,
    { from_month: "2026-11", to_month: "2026-11" },
    HEADERS,
    {
      loadPriced: () =>
        Promise.resolve({
          priced: [{ workspace_id: "w2", currency: "brl", monthly_cents: 500 }],
          createdByWs: new Map(),
        }) as never,
    },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  // 200 UUIDs per batch keeps the PostgREST URL under the gateway limit.
  assertEquals(rpcSizes, [200, 200, 200, 200, 200, 200, 50]);
  assertEquals(inSizes, [200, 200, 200, 200, 200, 200, 50]);
  assertEquals(body.channels[0].signups, N);
  assertEquals(body.channels[0].ever_paid, 3);
  assertEquals(body.channels[0].paying_now, 1);
  assertEquals(body.channels[0].mrr_cents, { brl: 500, usd: 0 });
});
