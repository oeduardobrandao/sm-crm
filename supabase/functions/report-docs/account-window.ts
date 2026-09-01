// Cadeia de fontes de conta por janela de mês (spec §4.2/§4.3, Task 10):
// 1. Graph ao vivo (`fetchAccountTotals`, resolvido pelo chamador)
// 2. campo a campo null -> linha de `instagram_account_metrics_monthly`
// 3. campo a campo ainda null -> SÓ para métricas ADITIVAS (nunca reach/
//    accounts_engaged, que a Graph não deduplica entre dias -- baseline
//    instagram-account-metrics.ts) -> soma das `*_day` de
//    `instagram_account_metrics_daily`, e SÓ com cobertura completa do mês
//    (todos os dias do mês com o campo não-null; parcial fica null, nunca
//    extrapola)
// 4. ainda null -> o card se omite (kpis.ts já trata isso)
//
// Pure e testável sem PostgREST: quem monta `monthlyRow`/`dailyRows` a partir
// das queries é snapshot-source.ts.
import type { AccountTotals, FollowsBreakdown } from "../_shared/instagram-account-metrics.ts";

/** Linha de `instagram_account_metrics_monthly` (spec §4.2, migration
 * 20260901100000) reduzida aos campos que a cadeia lê. */
export interface MonthlyMetricsRow {
  reach_month: number | null;
  views_month: number | null;
  saves_month: number | null;
  accounts_engaged_month: number | null;
  profile_views_month: number | null;
  website_clicks_month: number | null;
  follows_month: number | null;
  unfollows_month: number | null;
}

/** Uma linha de `instagram_account_metrics_daily` reduzida às colunas `*_day`
 * (migration 20260901100000). */
export interface DailyMetricsRow {
  reach_day: number | null;
  views_day: number | null;
  saves_day: number | null;
  accounts_engaged_day: number | null;
  profile_views_day: number | null;
  website_clicks_day: number | null;
  follows_day: number | null;
  unfollows_day: number | null;
}

type SimpleMetric = "reach" | "views" | "saves" | "accounts_engaged" | "profile_views" | "website_clicks";
// Métricas de únicos: a Graph nunca deduplica entre dias, então somar `*_day`
// produziria um "acumulado" mascarado de único -- proibido por definição
// (spec §4.1/§4.2), nunca por falta de dado.
const UNIQUE_METRICS: ReadonlySet<SimpleMetric> = new Set(["reach", "accounts_engaged"]);

const MONTHLY_FIELD: Record<SimpleMetric, keyof MonthlyMetricsRow> = {
  reach: "reach_month",
  views: "views_month",
  saves: "saves_month",
  accounts_engaged: "accounts_engaged_month",
  profile_views: "profile_views_month",
  website_clicks: "website_clicks_month",
};

const DAILY_FIELD: Partial<Record<SimpleMetric, keyof DailyMetricsRow>> = {
  views: "views_day",
  saves: "saves_day",
  profile_views: "profile_views_day",
  website_clicks: "website_clicks_day",
};

/** Dias corridos do mês (fim exclusivo - início), ambos "YYYY-MM-DD". Pura:
 * não depende de fuso -- os dois limites são dias UTC "flat" (00:00Z). */
export function daysInMonth(startDate: string, endDateExclusive: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDateExclusive}T00:00:00Z`);
  return Math.round((endMs - startMs) / 86_400_000);
}

/** O "close" de um mês (spec §4.2.4) é a linha do ÚLTIMO DIA do mês -- nunca
 * "última linha disponível dentro do mês" (foi exatamente esse bug que
 * produziu o "7" da Healing Hands: uma sincronização atrasada fazia o close
 * cair num dia no meio do mês). */
export function lastDayOfMonth(endDateExclusive: string): string {
  const ms = Date.parse(`${endDateExclusive}T00:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Soma de `*_day` só com cobertura COMPLETA: `daysInMonth` linhas, cada uma
// com o campo não-null. Uma única lacuna (dia sem linha OU linha com o campo
// null) já invalida a soma inteira -- nunca extrapola de uma amostra parcial.
function daySum(
  dailyRows: readonly DailyMetricsRow[],
  field: keyof DailyMetricsRow,
  totalDays: number,
): number | null {
  if (dailyRows.length !== totalDays) return null;
  let sum = 0;
  for (const row of dailyRows) {
    const v = row[field];
    if (typeof v !== "number") return null;
    sum += v;
  }
  return sum;
}

function resolveSimpleMetric(
  metric: SimpleMetric,
  live: Partial<AccountTotals> | null,
  monthlyRow: MonthlyMetricsRow | null,
  dailyRows: readonly DailyMetricsRow[],
  totalDays: number,
): number | null {
  const liveVal = live?.[metric];
  if (typeof liveVal === "number") return liveVal;

  const monthlyVal = monthlyRow?.[MONTHLY_FIELD[metric]];
  if (typeof monthlyVal === "number") return monthlyVal;

  if (UNIQUE_METRICS.has(metric)) return null; // nunca soma de *_day

  const dailyField = DAILY_FIELD[metric];
  if (!dailyField) return null;
  return daySum(dailyRows, dailyField, totalDays);
}

function resolveFollowsAndUnfollows(
  live: Partial<AccountTotals> | null,
  monthlyRow: MonthlyMetricsRow | null,
  dailyRows: readonly DailyMetricsRow[],
  totalDays: number,
): FollowsBreakdown | null {
  if (live?.follows_and_unfollows) return live.follows_and_unfollows;

  const mFollows = monthlyRow?.follows_month;
  const mUnfollows = monthlyRow?.unfollows_month;
  if (typeof mFollows === "number" && typeof mUnfollows === "number") {
    return { follows: mFollows, unfollows: mUnfollows, net: mFollows - mUnfollows };
  }

  const dFollows = daySum(dailyRows, "follows_day", totalDays);
  const dUnfollows = daySum(dailyRows, "unfollows_day", totalDays);
  if (dFollows !== null && dUnfollows !== null) {
    return { follows: dFollows, unfollows: dUnfollows, net: dFollows - dUnfollows };
  }
  return null;
}

/** Resolve AccountTotals para UMA janela de mês, campo a campo, pela cadeia
 * ao-vivo -> linha mensal -> soma diária (só aditivas) -> omite. `live` é o
 * resultado (já clampado em min(fim, agora) pelo chamador) de
 * `fetchAccountTotals`, ou `null` quando a fonte ao vivo inteira faltou
 * (sem token, ou falha degradada com warn). Nunca retorna `null` no topo:
 * cada campo carrega seu próprio null quando indisponível, mesma convenção
 * de `Partial<AccountTotals>` que `kpis.ts` já espera. */
export function resolveAccountWindow(
  live: Partial<AccountTotals> | null,
  monthlyRow: MonthlyMetricsRow | null,
  dailyRows: readonly DailyMetricsRow[],
  totalDays: number,
): Partial<AccountTotals> {
  return {
    reach: resolveSimpleMetric("reach", live, monthlyRow, dailyRows, totalDays),
    views: resolveSimpleMetric("views", live, monthlyRow, dailyRows, totalDays),
    saves: resolveSimpleMetric("saves", live, monthlyRow, dailyRows, totalDays),
    accounts_engaged: resolveSimpleMetric("accounts_engaged", live, monthlyRow, dailyRows, totalDays),
    profile_views: resolveSimpleMetric("profile_views", live, monthlyRow, dailyRows, totalDays),
    website_clicks: resolveSimpleMetric("website_clicks", live, monthlyRow, dailyRows, totalDays),
    follows_and_unfollows: resolveFollowsAndUnfollows(live, monthlyRow, dailyRows, totalDays),
  };
}
