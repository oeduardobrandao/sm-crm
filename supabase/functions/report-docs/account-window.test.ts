import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  daysInMonth, lastDayOfMonth, resolveAccountWindow, type DailyMetricsRow, type MonthlyMetricsRow,
} from "./account-window.ts";

const emptyMonthly: MonthlyMetricsRow = {
  reach_month: null, views_month: null, saves_month: null, accounts_engaged_month: null,
  profile_views_month: null, website_clicks_month: null, follows_month: null, unfollows_month: null,
};

function dayRow(overrides: Partial<DailyMetricsRow> = {}): DailyMetricsRow {
  return {
    reach_day: null, views_day: null, saves_day: null, accounts_engaged_day: null,
    profile_views_day: null, website_clicks_day: null, follows_day: null, unfollows_day: null,
    ...overrides,
  };
}

Deno.test("daysInMonth: julho tem 31 dias, fevereiro (não bissexto) tem 28", () => {
  assertEquals(daysInMonth("2026-07-01", "2026-08-01"), 31);
  assertEquals(daysInMonth("2026-02-01", "2026-03-01"), 28);
});

Deno.test("lastDayOfMonth: endDateExclusive - 1 dia", () => {
  assertEquals(lastDayOfMonth("2026-08-01"), "2026-07-31");
  assertEquals(lastDayOfMonth("2026-03-01"), "2026-02-28");
});

Deno.test("resolveAccountWindow: elo 1 (ao vivo) vence quando presente", () => {
  const out = resolveAccountWindow(
    { reach: 500, views: 300, follows_and_unfollows: { follows: 10, unfollows: 2, net: 8 } },
    { ...emptyMonthly, reach_month: 999, views_month: 999 },
    [],
    31,
  );
  assertEquals(out.reach, 500);
  assertEquals(out.views, 300);
  assertEquals(out.follows_and_unfollows, { follows: 10, unfollows: 2, net: 8 });
});

Deno.test("resolveAccountWindow: elo 2 (linha mensal) preenche o que o ao-vivo não trouxe", () => {
  const out = resolveAccountWindow(
    { reach: 500 }, // views ausente no ao-vivo
    { ...emptyMonthly, reach_month: 111, views_month: 222, saves_month: 15 },
    [],
    31,
  );
  assertEquals(out.reach, 500); // ao vivo vence
  assertEquals(out.views, 222); // cai pra linha mensal
  assertEquals(out.saves, 15);
});

Deno.test("resolveAccountWindow: elo 3 (soma diária) só para aditivas, com cobertura completa", () => {
  const days = Array.from({ length: 31 }, () => dayRow({ views_day: 10, saves_day: 2 }));
  const out = resolveAccountWindow(null, null, days, 31);
  assertEquals(out.views, 310); // 31 * 10
  assertEquals(out.saves, 62); // 31 * 2
});

Deno.test("resolveAccountWindow: cobertura PARCIAL (dia faltando) nunca extrapola", () => {
  const days = Array.from({ length: 30 }, () => dayRow({ views_day: 10 })); // 30 de 31 dias
  const out = resolveAccountWindow(null, null, days, 31);
  assertEquals(out.views, null);
});

Deno.test("resolveAccountWindow: um dia com o campo null dentro da janela também invalida a soma", () => {
  const days = [
    ...Array.from({ length: 30 }, () => dayRow({ views_day: 10 })),
    dayRow({ views_day: null }), // 31º dia sem o dado
  ];
  const out = resolveAccountWindow(null, null, days, 31);
  assertEquals(out.views, null);
});

Deno.test("resolveAccountWindow: reach/accounts_engaged NUNCA somam *_day, mesmo com cobertura completa", () => {
  const days = Array.from({ length: 31 }, () => dayRow({ reach_day: 20, accounts_engaged_day: 5 }));
  const out = resolveAccountWindow(null, null, days, 31);
  assertEquals(out.reach, null);
  assertEquals(out.accounts_engaged, null);
});

Deno.test("resolveAccountWindow: nenhum elo disponível -> null (card se omite)", () => {
  const out = resolveAccountWindow(null, null, [], 31);
  assertEquals(out.reach, null);
  assertEquals(out.views, null);
  assertEquals(out.saves, null);
  assertEquals(out.accounts_engaged, null);
  assertEquals(out.profile_views, null);
  assertEquals(out.website_clicks, null);
  assertEquals(out.follows_and_unfollows, null);
});

Deno.test("resolveAccountWindow: follows_and_unfollows cai pra linha mensal quando o ao-vivo não trouxe", () => {
  const out = resolveAccountWindow(
    {},
    { ...emptyMonthly, follows_month: 50, unfollows_month: 20 },
    [],
    31,
  );
  assertEquals(out.follows_and_unfollows, { follows: 50, unfollows: 20, net: 30 });
});

Deno.test("resolveAccountWindow: follows_and_unfollows soma diária só com cobertura completa dos DOIS campos", () => {
  const daysPartialUnfollows = [
    ...Array.from({ length: 30 }, () => dayRow({ follows_day: 2, unfollows_day: 1 })),
    dayRow({ follows_day: 2, unfollows_day: null }),
  ];
  const out = resolveAccountWindow(null, null, daysPartialUnfollows, 31);
  assertEquals(out.follows_and_unfollows, null);

  const daysFull = Array.from({ length: 31 }, () => dayRow({ follows_day: 2, unfollows_day: 1 }));
  const outFull = resolveAccountWindow(null, null, daysFull, 31);
  assertEquals(outFull.follows_and_unfollows, { follows: 62, unfollows: 31, net: 31 });
});
