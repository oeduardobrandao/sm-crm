import { assertEquals } from "jsr:@std/assert";
import { buildEmailKpis } from "../_shared/report-template/email-kpis.ts";

Deno.test("buildEmailKpis: tudo presente, com pct_change em views", () => {
  const result = buildEmailKpis({
    viewsMonth: 48200,
    prevViewsMonth: 40000,
    interactions: 1200,
    followersGained: 87,
  });
  assertEquals(result, {
    views: { value: 48200, pct_change: 21 },
    interactions: { value: 1200 },
    followers_gained: { value: 87 },
  });
});

Deno.test("buildEmailKpis: prev null -> views sem pct_change", () => {
  const result = buildEmailKpis({
    viewsMonth: 48200,
    prevViewsMonth: null,
    interactions: 1200,
    followersGained: 87,
  });
  assertEquals(result, {
    views: { value: 48200 },
    interactions: { value: 1200 },
    followers_gained: { value: 87 },
  });
});

Deno.test("buildEmailKpis: prev 0 -> views sem pct_change (evita divisão por zero)", () => {
  const result = buildEmailKpis({
    viewsMonth: 500,
    prevViewsMonth: 0,
    interactions: 1200,
    followersGained: 87,
  });
  assertEquals(result, {
    views: { value: 500 },
    interactions: { value: 1200 },
    followers_gained: { value: 87 },
  });
});

Deno.test("buildEmailKpis: viewsMonth null -> entrada views ausente, resto presente", () => {
  const result = buildEmailKpis({
    viewsMonth: null,
    prevViewsMonth: 40000,
    interactions: 1200,
    followersGained: 87,
  });
  assertEquals(result, {
    interactions: { value: 1200 },
    followers_gained: { value: 87 },
  });
});

Deno.test("buildEmailKpis: pct_change arredonda a inteiro (positivo e negativo)", () => {
  const up = buildEmailKpis({
    viewsMonth: 333,
    prevViewsMonth: 300,
    interactions: 0,
    followersGained: 0,
  });
  // (333-300)/300 * 100 = 11.0 -> 11
  assertEquals(up?.views?.pct_change, 11);

  const down = buildEmailKpis({
    viewsMonth: 260,
    prevViewsMonth: 300,
    interactions: 0,
    followersGained: 0,
  });
  // (260-300)/300 * 100 = -13.333... -> -13
  assertEquals(down?.views?.pct_change, -13);
});

Deno.test("buildEmailKpis: interactions/followers sempre presentes quando finitos, mesmo em zero", () => {
  const result = buildEmailKpis({
    viewsMonth: null,
    prevViewsMonth: null,
    interactions: 0,
    followersGained: 0,
  });
  assertEquals(result, {
    interactions: { value: 0 },
    followers_gained: { value: 0 },
  });
});

Deno.test("buildEmailKpis: nada tem valor -> null", () => {
  const result = buildEmailKpis({
    viewsMonth: null,
    prevViewsMonth: null,
    interactions: NaN,
    followersGained: NaN,
  });
  assertEquals(result, null);
});

Deno.test("buildEmailKpis: interactions/followers nunca carregam pct_change", () => {
  const result = buildEmailKpis({
    viewsMonth: null,
    prevViewsMonth: null,
    interactions: 500,
    followersGained: 20,
  });
  assertEquals(result?.interactions?.pct_change, undefined);
  assertEquals(result?.followers_gained?.pct_change, undefined);
});
