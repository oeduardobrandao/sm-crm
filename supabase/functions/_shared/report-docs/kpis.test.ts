import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeKpis, type KpiSources } from "./kpis.ts";

const post = (over: Partial<KpiSources["allPosts"][number]> = {}) => ({
  reach: 100, likes: 10, comments: 2, saved: 3, shares: 1, ...over,
});

const base = (): KpiSources => ({
  accountMonth: {
    reach: 400, views: 8000, saves: 6, accounts_engaged: 52,
    profile_views: 500, website_clicks: 40,
    follows_and_unfollows: { follows: 120, unfollows: 20, net: 100 },
  },
  accountPrevMonth: {
    reach: 200, views: 6500, saves: 3, accounts_engaged: 16,
    profile_views: 450, website_clicks: 50,
    follows_and_unfollows: { follows: 70, unfollows: 20, net: 50 },
  },
  followersClose: 1200,
  followersPrevClose: 1100,
  followerHistory: [{ follower_count: 1150 }],
  allPosts: [post(), post({ reach: 300, likes: 30 })],
  prevMonthPostsCount: 1,
});

Deno.test("caso completo: 9 KPIs com prev na mesma base", () => {
  const k = computeKpis(base());
  assertEquals(k.views.value, 8000);
  assertEquals(k.views.prev, 6500);
  assertEquals(k.followers_gained.value, 100);
  assertEquals(k.followers_gained.prev, 50);
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
  // engagement: accounts_engaged / reach * 100, mesma fonte (accountMonth)
  assertEquals(k.engagement_rate.value, 13);
  assertEquals(k.engagement_rate.prev, 8);
  assertEquals(k.engagement_rate.unit, "pct");
});

Deno.test("KPI_LABELS_PT.reach usa 'Alcance acumulado' (checkpoint decision)", async () => {
  const { KPI_LABELS_PT } = await import("./kpis.ts");
  assertEquals(KPI_LABELS_PT.reach, "Alcance acumulado");
});

Deno.test("accountMonth null: reach/views/saves/profile_views/website_clicks somem (cards se omitem)", () => {
  const s = base();
  s.accountMonth = null;
  const k = computeKpis(s);
  assertEquals(k.reach.value, null);
  assertEquals(k.reach.prev, null);
  assertEquals(k.views.value, null);
  assertEquals(k.saves.value, null);
  assertEquals(k.profile_views.value, null);
  assertEquals(k.website_clicks.value, null);
});

Deno.test("prev null quando só o mês atual tem dado (accountPrevMonth null)", () => {
  const s = base();
  s.accountPrevMonth = null;
  const k = computeKpis(s);
  assertEquals(k.reach.value, 400);
  assertEquals(k.reach.prev, null);
  assertEquals(k.views.value, 8000);
  assertEquals(k.views.prev, null);
  assertEquals(k.saves.prev, null);
  assertEquals(k.profile_views.prev, null);
  assertEquals(k.website_clicks.prev, null);
});

Deno.test("prev null quando o campo específico falta no accountPrevMonth mesmo com o mês presente", () => {
  const s = base();
  s.accountPrevMonth = { ...s.accountPrevMonth, reach: null };
  const k = computeKpis(s);
  assertEquals(k.reach.value, 400);
  assertEquals(k.reach.prev, null);
});

Deno.test("value null (campo específico ausente no accountMonth): card omite-se, prev também null", () => {
  const s = base();
  s.accountMonth = { ...s.accountMonth, views: null };
  const k = computeKpis(s);
  assertEquals(k.views.value, null);
  assertEquals(k.views.prev, null); // invariante: sem valor, sem prev
});

Deno.test("followers_gained via net do accountMonth; prev via net do accountPrevMonth", () => {
  const k = computeKpis(base());
  assertEquals(k.followers_gained.value, 100);
  assertEquals(k.followers_gained.prev, 50);
});

Deno.test("followers_gained: accountMonth sem follows_and_unfollows cai no fallback close-to-close", () => {
  const s = base();
  s.accountMonth = { ...s.accountMonth, follows_and_unfollows: null };
  s.accountPrevMonth = { ...s.accountPrevMonth, follows_and_unfollows: null };
  s.followersClose = 4419;
  s.followersPrevClose = 4300;
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, 119); // 4419 - 4300
  assertEquals(k.followers_gained.prev, null); // fallback close-to-close nunca expõe prev
});

Deno.test("followers_gained: fallback close-to-close exige os DOIS closes (um só -> null)", () => {
  const s = base();
  s.accountMonth = { ...s.accountMonth, follows_and_unfollows: null };
  s.accountPrevMonth = { ...s.accountPrevMonth, follows_and_unfollows: null };
  s.followersClose = 4419;
  s.followersPrevClose = null;
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, null);
  assertEquals(k.followers_gained.prev, null);
});

Deno.test("followers_gained: prev do net só quando os DOIS nets são positivos", () => {
  const s = base();
  s.accountMonth = {
    ...s.accountMonth,
    follows_and_unfollows: { follows: 10, unfollows: 30, net: -20 },
  };
  s.accountPrevMonth = {
    ...s.accountPrevMonth,
    follows_and_unfollows: { follows: 70, unfollows: 20, net: 50 },
  };
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, -20);
  assertEquals(k.followers_gained.prev, null); // net do mês corrente não é positivo
});

Deno.test("followers_gained: net corrente positivo mas prev negativo -> prev suprimido", () => {
  const s = base();
  s.accountMonth = {
    ...s.accountMonth,
    follows_and_unfollows: { follows: 120, unfollows: 20, net: 100 },
  };
  s.accountPrevMonth = {
    ...s.accountPrevMonth,
    follows_and_unfollows: { follows: 5, unfollows: 40, net: -35 },
  };
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, 100);
  assertEquals(k.followers_gained.prev, null);
});

Deno.test("followers_total: followersClose direto; prev = followersPrevClose", () => {
  const k = computeKpis(base());
  assertEquals(k.followers_total.value, 1200);
  assertEquals(k.followers_total.prev, 1100);
});

Deno.test("followers_total: sem close, fallback último ponto do history do mês, sem prev", () => {
  const s = base();
  s.followersClose = null;
  s.followersPrevClose = null;
  s.followerHistory = [{ follower_count: 1150 }, { follower_count: 1234 }];
  const k = computeKpis(s);
  assertEquals(k.followers_total.value, 1234);
  assertEquals(k.followers_total.prev, null);
});

Deno.test("followers_total: sem close e sem history -> null", () => {
  const s = base();
  s.followersClose = null;
  s.followersPrevClose = null;
  s.followerHistory = [];
  const k = computeKpis(s);
  assertEquals(k.followers_total.value, null);
  assertEquals(k.followers_total.prev, null);
});

Deno.test("engagement_rate: accounts_engaged/reach * 100, mesma fonte accountMonth", () => {
  const k = computeKpis(base());
  assertEquals(k.engagement_rate.value, 13);
});

Deno.test("engagement_rate: accounts_engaged ausente -> null", () => {
  const s = base();
  s.accountMonth = { ...s.accountMonth, accounts_engaged: null };
  const k = computeKpis(s);
  assertEquals(k.engagement_rate.value, null);
  assertEquals(k.engagement_rate.prev, null);
});

Deno.test("engagement_rate: reach ausente -> null", () => {
  const s = base();
  s.accountMonth = { ...s.accountMonth, reach: null };
  const k = computeKpis(s);
  assertEquals(k.engagement_rate.value, null);
});

Deno.test("engagement_rate: prev exige as duas métricas na MESMA fonte (accountPrevMonth)", () => {
  const s = base();
  s.accountPrevMonth = { ...s.accountPrevMonth, accounts_engaged: null };
  const k = computeKpis(s);
  assertEquals(k.engagement_rate.value, 13);
  assertEquals(k.engagement_rate.prev, null);
});

Deno.test("posts_count: allPosts.length; prev = prevMonthPostsCount", () => {
  const k = computeKpis(base());
  assertEquals(k.posts_count.value, 2);
  assertEquals(k.posts_count.prev, 1);
});

Deno.test("posts_count: prevMonthPostsCount null (query falhou) nunca vira zero", () => {
  const s = base();
  s.prevMonthPostsCount = null;
  const k = computeKpis(s);
  assertEquals(k.posts_count.prev, null);
});

Deno.test("mês sem posts: posts_count 0, engagement/reach seguem a base de conta (não somam posts)", () => {
  const s = base();
  s.allPosts = [];
  const k = computeKpis(s);
  assertEquals(k.posts_count.value, 0);
  assertEquals(k.reach.value, 400); // reach agora vem de accountMonth, não da soma de posts
});

Deno.test("conta conectada no meio do mês não inventa ganho", () => {
  const k = computeKpis({
    accountMonth: null, accountPrevMonth: null,
    followersClose: 4419, followersPrevClose: null,
    followerHistory: [{ follower_count: 4412 }, { follower_count: 4419 }],
    allPosts: [], prevMonthPostsCount: null,
  });
  assertEquals(k.followers_gained.value, null); // era 7 no bug original
  assertEquals(k.followers_total.value, 4419);
});
