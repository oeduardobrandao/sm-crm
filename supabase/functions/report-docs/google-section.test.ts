import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { abbreviateReviewer, HIGHLIGHT_MAX_CHARS, loadGoogleReportSection } from "./google-section.ts";
import { buildOverview } from "../_shared/gbp-analytics/queries.ts";

// Fake db that APPLIES eq/in/gte/lt/lte/order/limit/range to in-memory rows, so windows and
// tenant filters are proven by data. It also records every table read and whether it carried
// conta_id.
type Row = Record<string, unknown>;
function makeDb(tables: Record<string, Row[]>) {
  const reads: { table: string; conta: boolean }[] = [];
  // deno-lint-ignore no-explicit-any
  const query = (table: string): any => {
    let rows = [...(tables[table] ?? [])];
    const orders: { col: string; asc: boolean }[] = [];
    let slice: [number, number] | null = null;
    const read = { table, conta: false };
    reads.push(read);
    const cmp = (a: unknown, b: unknown) =>
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a) < String(b)
        ? -1
        : String(a) > String(b)
        ? 1
        : 0;
    const result = () => {
      let out = [...rows];
      if (orders.length) {
        out.sort((a, b) => {
          for (const o of orders) {
            const c = cmp(a[o.col], b[o.col]);
            if (c !== 0) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      if (slice) out = out.slice(slice[0], slice[1] + 1);
      return out;
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = (col: string, v: unknown) => {
      if (col === "conta_id") read.conta = true;
      rows = rows.filter((r) => r[col] === v);
      return c;
    };
    c.not = (col: string, op: string, v: unknown) => {
      if (op === "is" && v === null) rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
      return c;
    };
    c.in = (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), c);
    c.gte = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) >= 0)), c);
    c.lt = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) < 0)), c);
    c.lte = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) <= 0)), c);
    c.order = (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), c);
    c.limit = (n: number) => ((slice = [0, n - 1]), c);
    c.range = (from: number, to: number) => ((slice = [from, to]), c);
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve);
    return c;
  };
  // deno-lint-ignore no-explicit-any
  return { db: { from: (table: string) => query(table) } as any, reads };
}

const CONTA = "ws-1";
const OTHER = "ws-2";
const NOW = new Date("2026-11-04T15:00:00Z");

const unit = (id: string, over: Row = {}): Row => ({
  id,
  conta_id: CONTA,
  client_id: 7,
  location_name: `locations/${id}`,
  title: `Unidade ${id}`,
  status: "active",
  maps_uri: null,
  data_through: "2026-10-29",
  average_rating: "4.8",
  total_review_count: 100,
  created_at: `2026-01-0${id.length}T00:00:00Z`,
  ...over,
});

const DAY_MS = 86_400_000;
const days = (start: string, end: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};
const metricRows = (loc: string, start: string, end: string, conta = CONTA): Row[] =>
  days(start, end).map((day, i) => ({
    conta_id: conta,
    location_name: loc,
    day,
    business_impressions_desktop_maps: 1,
    business_impressions_desktop_search: 2,
    business_impressions_mobile_maps: 3 + (i % 2),
    business_impressions_mobile_search: 4,
    call_clicks: 2,
    business_direction_requests: 1,
    website_clicks: i % 3,
    messaging_clicks: 0,
    business_bookings: 0,
    business_food_menu_clicks: 0,
  }));

const rating = (loc: string, day: string, avg: number, count: number): Row => ({
  conta_id: CONTA,
  location_name: loc,
  day,
  average_rating: avg,
  total_review_count: count,
});

const review = (id: string, loc: string, stars: number, createTime: string, comment: string | null, name = "Ana Paula Souza"): Row => ({
  conta_id: CONTA,
  location_name: loc,
  review_id: id,
  reviewer_name: name,
  star_rating: stars,
  comment,
  create_time: createTime,
  has_reply: false,
});

function baseTables(): Record<string, Row[]> {
  return {
    gbp_locations: [unit("a"), unit("bb")],
    gbp_metrics_daily: [
      ...metricRows("locations/a", "2026-07-01", "2026-10-29"),
      ...metricRows("locations/bb", "2026-07-01", "2026-10-29"),
      // Outro workspace com a mesma unidade: nunca entra.
      ...metricRows("locations/a", "2026-10-01", "2026-10-29", OTHER),
    ],
    gbp_rating_daily: [
      rating("locations/a", "2026-08-31", 4.7, 90),
      rating("locations/a", "2026-09-30", 4.8, 95),
      rating("locations/a", "2026-10-29", 4.8, 100),
      rating("locations/bb", "2026-09-30", 4.6, 50),
      rating("locations/bb", "2026-10-29", 4.6, 55),
    ],
    gbp_reviews: [
      review("r1", "locations/a", 5, "2026-10-20T12:00:00Z", "Ótimo atendimento"),
      review("r2", "locations/bb", 4, "2026-10-25T12:00:00Z", "Bom"),
      review("r3", "locations/a", 5, "2026-10-27T12:00:00Z", "   "),
      review("r4", "locations/a", 2, "2026-10-28T12:00:00Z", "Ruim"),
    ],
    gbp_search_keywords_monthly: [],
  };
}

Deno.test("no units -> null", async () => {
  const { db } = makeDb({ gbp_locations: [] });
  assertEquals(await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW), null);
});

Deno.test("window = report month clipped to data_through; prev = same number of days right before", async () => {
  const { db } = makeDb(baseTables());
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s.window, { start: "2026-10-01", end: "2026-10-29", prevStart: "2026-09-02", prevEnd: "2026-09-30" });
  assertEquals(s.daily.length, 29);
  assertEquals(s.units.map((u) => u.id), ["a", "bb"]);
});

Deno.test("KPIs equal the gbp-analytics overview for the same range", async () => {
  const { db } = makeDb(baseTables());
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  const { db: db2 } = makeDb(baseTables());
  const units = baseTables().gbp_locations as never;
  const overview = await buildOverview(db2, CONTA, units, { kind: "range", start: "2026-10-01", end: "2026-10-31" }, NOW);
  for (const [id, entry] of Object.entries(overview.kpis)) {
    assertEquals(s.kpis[id as keyof typeof s.kpis].value, entry.value, id);
    assertEquals(s.kpis[id as keyof typeof s.kpis].prev, entry.prev, id);
  }
  assertEquals(s.kpis.avg_rating.unit, "rating");
  assertEquals(s.kpis.calls.unit, "count");
  // 29 dias × 2 unidades × 2 ligações; o outro workspace não soma.
  assertEquals(s.kpis.calls.value, 116);
});

Deno.test("window after data_through: section present, window null, every KPI null", async () => {
  const t = baseTables();
  t.gbp_locations = [unit("a", { data_through: "2026-09-30" })];
  const { db } = makeDb(t);
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s.window, null);
  for (const e of Object.values(s.kpis)) assertEquals(e.value, null);
  assertEquals(s.highlight, null);
  assertEquals(s.unit_rows.length, 1);
});

Deno.test("revoked unit holds no window back", async () => {
  const t = baseTables();
  t.gbp_locations = [unit("a"), unit("bb", { status: "revoked", data_through: "2026-10-10" })];
  const { db } = makeDb(t);
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s.window?.end, "2026-10-29");
  assertEquals(s.unit_rows.find((u) => u.id === "bb")?.status, "revoked");
});

Deno.test("keywords: report month when stored, else the previous closed month", async () => {
  const t = baseTables();
  t.gbp_search_keywords_monthly = [
    { conta_id: CONTA, location_name: "locations/a", month: "2026-09-01", keyword: "dermatologista", value: 40, threshold: null },
    { conta_id: CONTA, location_name: "locations/bb", month: "2026-09-01", keyword: "dermatologista", value: 10, threshold: null },
    { conta_id: CONTA, location_name: "locations/bb", month: "2026-09-01", keyword: "pintas", value: null, threshold: 15 },
  ];
  const { db } = makeDb(t);
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s.keywords.month, "2026-09");
  assertEquals(s.keywords.rows, [
    { keyword: "dermatologista", value: 50, threshold: null },
    { keyword: "pintas", value: null, threshold: 15 },
  ]);
});

Deno.test("highlight: newest 5 stars with text inside the window, else 4 stars", async () => {
  const { db } = makeDb(baseTables());
  const s = (await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s.highlight, {
    reviewer: "Ana S.",
    rating: 5,
    comment: "Ótimo atendimento",
    unit_title: "Unidade a",
    date: "2026-10-20",
  });

  const t = baseTables();
  t.gbp_reviews = [
    review("r2", "locations/bb", 4, "2026-10-25T12:00:00Z", "x".repeat(HIGHLIGHT_MAX_CHARS + 20)),
    // Antes da janela (30/09 21h em SP = 01/10 00h UTC): não conta.
    review("r5", "locations/a", 5, "2026-10-01T00:30:00Z", "Fora do mês"),
  ];
  const { db: db2 } = makeDb(t);
  const s2 = (await loadGoogleReportSection(db2, CONTA, 7, "2026-10", NOW))!;
  assertEquals(s2.highlight?.rating, 4);
  assertEquals([...s2.highlight!.comment].length, HIGHLIGHT_MAX_CHARS + 1);
  assert(s2.highlight!.comment.endsWith("…"));
});

Deno.test("abbreviateReviewer", () => {
  assertEquals(abbreviateReviewer("Mariana Costa Lima"), "Mariana L.");
  assertEquals(abbreviateReviewer("Mariana"), "Mariana");
  assertEquals(abbreviateReviewer("  "), "Cliente do Google");
  assertEquals(abbreviateReviewer(null), "Cliente do Google");
  assertEquals(abbreviateReviewer("josé ávila"), "josé Á.");
});

Deno.test("every query carries conta_id", async () => {
  const { db, reads } = makeDb(baseTables());
  await loadGoogleReportSection(db, CONTA, 7, "2026-10", NOW);
  assert(reads.length > 0);
  for (const r of reads) assert(r.conta, `${r.table} read without conta_id`);
});
