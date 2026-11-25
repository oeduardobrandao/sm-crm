import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { loadInstagramHealth, reportCutoffIso } from "./health-section.ts";

type Row = Record<string, unknown>;
interface Fx {
  history?: Row[];
  benchmarks?: Row[];
  metrics?: Row | null;
  metricsError?: boolean;
  post?: Row | null;
  band?: string | null;
}

// Fake que APLICA eq/lte/gte/order/limit nas linhas em memória e registra as RPCs.
function makeDb(fx: Fx) {
  const rpcs: { fn: string; args: Row }[] = [];
  // deno-lint-ignore no-explicit-any
  const query = (table: string): any => {
    let rows: Row[] = table === "instagram_follower_history"
      ? [...(fx.history ?? [])]
      : table === "ig_peer_benchmarks"
      ? [...(fx.benchmarks ?? [])]
      : fx.post ? [fx.post] : [];
    let asc = true;
    let lim = Infinity;
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === undefined || r[col] === v)), c);
    c.lte = (col: string, v: unknown) => ((rows = rows.filter((r) => String(r[col]) <= String(v))), c);
    c.gte = (col: string, v: unknown) => ((rows = rows.filter((r) => String(r[col]) >= String(v))), c);
    c.order = (_col: string, o?: { ascending?: boolean }) => ((asc = o?.ascending !== false), c);
    c.limit = (n: number) => ((lim = n), c);
    const out = () => {
      const sorted = table === "instagram_follower_history"
        ? [...rows].sort((a, b) => (asc ? 1 : -1) * String(a.date).localeCompare(String(b.date)))
        : rows;
      return sorted.slice(0, lim);
    };
    c.maybeSingle = () => Promise.resolve({ data: out()[0] ?? null, error: null });
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: out(), error: null }).then(resolve);
    return c;
  };
  const db = {
    from: (t: string) => query(t),
    rpc: (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      if (fn === "ig_follower_band") {
        const f = args.p_followers as number;
        const band = fx.band !== undefined ? fx.band : f < 1000 ? "lt1k" : f < 5000 ? "1k_5k" : f < 20000 ? "5k_20k" : "20k_100k";
        return Promise.resolve({ data: band, error: null });
      }
      if (fx.metricsError) return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({ data: fx.metrics === undefined ? [METRICS] : fx.metrics ? [fx.metrics] : [], error: null });
    },
  };
  return { db, rpcs };
}

const METRICS: Row = {
  engagement_rate: "0.034", posts_30d: 9, reel_views: "1200", reels_share: "0.25",
  best_post_id: null, best_post_ratio: null,
};
const cuts = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
const AS_OF = "2026-10-01T03:00:00.000Z";
// deno-lint-ignore no-explicit-any
const deps = (cache?: (url: string) => string | null): any => ({
  fetch: () => Promise.reject(new Error("no fetch")),
  storage: {},
  _cache: cache,
});

Deno.test("reportCutoffIso: mês corrente usa a geração, mês fechado usa endExclusive", () => {
  assertEquals(reportCutoffIso("2026-12-01T03:00:00.000Z", "2026-11-25T12:00:00.000Z"), "2026-11-25T12:00:00.000Z");
  assertEquals(reportCutoffIso("2026-10-01T03:00:00.000Z", "2026-11-25T12:00:00.000Z"), "2026-10-01T03:00:00.000Z");
});

Deno.test("seguidores do histórico (até 7 dias antes do corte) e RPC com o corte", async () => {
  const { db, rpcs } = makeDb({
    history: [
      { instagram_account_id: "a1", date: "2026-09-28", follower_count: 9100 },
      { instagram_account_id: "a1", date: "2026-09-10", follower_count: 8000 }, // fora da janela de 7 dias
      { instagram_account_id: "a1", date: "2026-10-02", follower_count: 9999 }, // depois do corte
    ],
  });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap?.followers, 9100);
  assertEquals(snap?.band, "5k_20k");
  assertEquals(snap?.as_of, AS_OF);
  const call = rpcs.find((r) => r.fn === "ig_account_health_metrics")!;
  assertEquals(call.args, { p_account_id: "a1", p_as_of: AS_OF, p_followers: 9100 });
  assertEquals(snap?.metrics, { engagement_rate: 0.034, posts_30d: 9, reel_views: 1200, reels_share: 0.25 });
  assertEquals(snap?.best_post, null);
});

Deno.test("sem histórico no corte cai nos seguidores atuais", async () => {
  const { db } = makeDb({ history: [] });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap?.followers, 9274);
});

Deno.test("benchmarks: cortes em string viram number; 98 cortes some", async () => {
  const { db } = makeDb({
    benchmarks: [
      { band: "5k_20k", metric: "engagement_rate", source: "mesaas", sample_size: 40, cuts: cuts(99) },
      { band: "5k_20k", metric: "posts_30d", source: "mercado", sample_size: null, cuts: cuts(98) },
    ],
  });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274);
  const b = snap!.benchmarks;
  assertEquals(Object.keys(b), ["engagement_rate"]);
  assertEquals(b.engagement_rate?.cuts[0], 1);
  assertEquals(typeof b.engagement_rate?.cuts[98], "number");
  assertEquals(b.engagement_rate?.sample_size, 40);
});

Deno.test("faixa nula: snapshot sem benchmarks", async () => {
  const { db } = makeDb({ band: null });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 0);
  assertEquals(snap?.band, null);
  assertEquals(snap?.benchmarks, {});
});

Deno.test("melhor post: id com post, thumbnail estável e URL efêmera vira null", async () => {
  const withBest = { ...METRICS, best_post_id: "p-uuid", best_post_ratio: "3.5" };
  const stable = "https://x.supabase.co/storage/v1/object/public/instagram-posts/a1/ig1.jpg";
  const ok = makeDb({
    metrics: withBest,
    post: { id: "p-uuid", instagram_post_id: "ig1", permalink: "https://instagram.com/p/x", thumbnail_url: stable },
  });
  const snap = await loadInstagramHealth(ok.db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap?.best_post, { ratio: 3.5, permalink: "https://instagram.com/p/x", thumbnail_url: stable });

  // CDN efêmero e o cache falha (fetch rejeita): cachePostThumbnail devolve a URL crua, que vira null.
  const eph = makeDb({
    metrics: withBest,
    post: { id: "p-uuid", instagram_post_id: "ig1", permalink: "https://instagram.com/p/x", thumbnail_url: "https://scontent-gru1-1.cdninstagram.com/v/t51/abc.jpg" },
  });
  const snap2 = await loadInstagramHealth(eph.db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap2?.best_post?.thumbnail_url, null);
  assertEquals(snap2?.best_post?.permalink, "https://instagram.com/p/x");
});

Deno.test("melhor post sem a linha do post: ratio com permalink e miniatura nulos", async () => {
  const { db } = makeDb({ metrics: { ...METRICS, best_post_id: "p-uuid", best_post_ratio: 2 }, post: null });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap?.best_post, { ratio: 2, permalink: null, thumbnail_url: null });
});

Deno.test("melhor post de outra conta não é lido: frase sem link nem miniatura", async () => {
  const { db } = makeDb({
    metrics: { ...METRICS, best_post_id: "p-uuid", best_post_ratio: 2 },
    post: { id: "p-uuid", instagram_account_id: "outra", instagram_post_id: "ig9", permalink: "https://instagram.com/p/y", thumbnail_url: null },
  });
  const snap = await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274);
  assertEquals(snap?.best_post, { ratio: 2, permalink: null, thumbnail_url: null });
});

Deno.test("janela de seguidores em dias UTC: corte de madrugada UTC usa o dia UTC anterior", async () => {
  // 01:00Z de 25/11 ainda é 24/11 em São Paulo; a linha datada 25/11 (dia UTC do corte) fica de fora.
  const { db } = makeDb({
    history: [
      { instagram_account_id: "a1", date: "2026-11-25", follower_count: 9999 },
      { instagram_account_id: "a1", date: "2026-11-24", follower_count: 9200 },
    ],
  });
  const snap = await loadInstagramHealth(db, deps(), "a1", "2026-11-25T01:00:00.000Z", 9274);
  assertEquals(snap?.followers, 9200);
});

Deno.test("erro na RPC devolve null sem lançar", async () => {
  const { db } = makeDb({ metricsError: true });
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await loadInstagramHealth(db, deps(), "a1", AS_OF, 9274), null);
  } finally {
    console.error = orig;
  }
});

Deno.test("exceção lançada devolve null", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await loadInstagramHealth({ from: () => { throw new Error("x"); } }, deps(), "a1", AS_OF, 1);
    assert(r === null);
  } finally {
    console.error = orig;
  }
});
