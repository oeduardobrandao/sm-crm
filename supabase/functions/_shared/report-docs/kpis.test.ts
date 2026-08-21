import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeKpis, type KpiSources } from "./kpis.ts";

const post = (over: Partial<KpiSources["allPosts"][number]> = {}) => ({
  reach: 100, likes: 10, comments: 2, saved: 3, shares: 1, ...over,
});

const base = (): KpiSources => ({
  allPosts: [post(), post({ reach: 300, likes: 30 })],
  prevMonthPosts: [post({ reach: 200 })],
  currSnapshot: {
    followers_count: 1200, profile_views_28d: 500, website_clicks_28d: 40,
  },
  prevSnapshot: {
    followers_count: 1100, profile_views_28d: 450, website_clicks_28d: 50,
  },
  prevPrevSnapshot: { followers_count: 1050 },
  followerHistory: [{ follower_count: 1150 }],
  liveFollowerCount: 1234,
});

Deno.test("caso completo: 8 KPIs com prev na mesma base", () => {
  const k = computeKpis(base());
  assertEquals(k.followers_gained.value, 100);          // 1200 - 1100
  assertEquals(k.followers_gained.prev, 50);            // 1100 - 1050
  assertEquals(k.followers_total.value, 1200);
  assertEquals(k.followers_total.prev, 1100);
  assertEquals(k.reach.value, 400);
  assertEquals(k.reach.prev, 200);
  assertEquals(k.saves.value, 6);
  assertEquals(k.saves.prev, 3);
  assertEquals(k.posts_count.value, 2);
  assertEquals(k.posts_count.prev, 1);
  assertEquals(k.profile_views.value, 500);
  assertEquals(k.profile_views.prev, 450);
  assertEquals(k.website_clicks.value, 40);
  assertEquals(k.website_clicks.prev, 50);
  // engagement: (10+2+3+1 + 30+2+3+1) / 400 * 100 = 13.0 ; prev: 16/200*100 = 8.0
  assertEquals(k.engagement_rate.value, 13);
  assertEquals(k.engagement_rate.prev, 8);
  assertEquals(k.engagement_rate.unit, "pct");
});

Deno.test("sem snapshots: followers_gained cai pro history (sem prev); followers_total idem", () => {
  const s = base();
  s.currSnapshot = null;
  s.prevSnapshot = null;
  s.prevPrevSnapshot = null;
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, 84);  // live 1234 - primeiro history 1150
  assertEquals(k.followers_gained.prev, null);
  assertEquals(k.followers_total.value, 1150); // último ponto do history do mês
  assertEquals(k.followers_total.prev, null);
  assertEquals(k.profile_views.value, null);   // 28d sem snapshot do mês: some
  assertEquals(k.website_clicks.value, null);
});

Deno.test("ganho negativo em qualquer mês retém o prev de followers_gained", () => {
  const s = base();
  s.currSnapshot = { ...s.currSnapshot!, followers_count: 1000 }; // ganho -100
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, -100);
  assertEquals(k.followers_gained.prev, null);
});

Deno.test("mês anterior sem posts: reach/saves/engagement/posts_count sem prev", () => {
  const s = base();
  s.prevMonthPosts = [];
  const k = computeKpis(s);
  assertEquals(k.reach.prev, null);
  assertEquals(k.saves.prev, null);
  assertEquals(k.engagement_rate.prev, null);
  assertEquals(k.posts_count.prev, null);
});

Deno.test("prevMonthPosts null (query falhou) nunca vira zero", () => {
  const s = base();
  s.prevMonthPosts = null;
  const k = computeKpis(s);
  assertEquals(k.posts_count.prev, null);
});

Deno.test("soma anterior zero = desconhecido, não colapso: prev retido", () => {
  const s = base();
  s.prevMonthPosts = [post({ reach: 0, saved: 0, likes: 0, comments: 0, shares: 0 })];
  const k = computeKpis(s);
  assertEquals(k.reach.prev, null);
  assertEquals(k.saves.prev, null);
  assertEquals(k.engagement_rate.prev, null); // alcance anterior 0: razão indefinida
  assertEquals(k.posts_count.prev, 1);        // contagem é contagem: 1 post existiu
});

Deno.test("mês sem posts: engagement value 0, reach 0", () => {
  const s = base();
  s.allPosts = [];
  const k = computeKpis(s);
  assertEquals(k.reach.value, 0);
  assertEquals(k.engagement_rate.value, 0);
  assertEquals(k.posts_count.value, 0);
});

Deno.test("sem nenhuma base: followers_gained fica null, nunca 0", () => {
  const s = base();
  s.currSnapshot = null;
  s.prevSnapshot = null;
  s.prevPrevSnapshot = null;
  s.followerHistory = [];
  s.liveFollowerCount = null;
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, null);
  assertEquals(k.followers_gained.prev, null);
});
