// Fechamento do agregado mensal (métricas de únicos não são reconstruíveis
// a partir da soma de dias -- este é o único histórico paritário além dos
// 90d de retenção da Graph). Spec §4.2 (item 4).
import {
  type AccountMetric, fetchAccountTotalsDetailed,
} from "../_shared/instagram-account-metrics.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import { CLOSED_DAYS_WINDOW } from "./daily-ingest.ts";

const DAY = 86400;
const RETENTION_DAYS = 90;
const TABLE = "instagram_account_metrics_monthly";

const MONTHLY_METRICS: AccountMetric[] = [
  "reach", "views", "saves", "accounts_engaged",
  "profile_views", "website_clicks", "follows_and_unfollows",
];

function currentMonthOf(nowSec: number): string {
  const d = new Date(nowSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Idempotente: se a linha do mês anterior já existe, retorna sem chamada
// Graph. Ordem das guardas é parte do contrato (achados Codex P1):
//   1) janela de finalização -- não fecha antes de CLOSED_DAYS_WINDOW dias
//      dentro do mês novo (mesma razão do D-1..D-3 diário: fechar no tick 1
//      do dia 1 congelaria dados que a Meta ainda revisa);
//   2) mês anterior fora da retenção de 90d da Graph (aritmética local, sem
//      Graph) -- evita reconsultar para sempre um mês irrecuperável;
//   3) linha já existe -- idempotência, sem Graph;
//   4) fetch (via fetchAccountTotalsDetailed, achado P1 da rodada 3): se
//      QUALQUER métrica falhou (erro de chunk/rede, não uma resposta
//      honestamente vazia), NÃO insere linha nenhuma -- a linha só existiria
//      pela metade e a guarda 3 (idempotência) bloquearia o refill dessa
//      métrica para sempre, já que este módulo não tem outro marcador de
//      "já processado" além da própria linha. A ausência da linha É o
//      caminho de retry: o próximo tick de manutenção refaz o fetch inteiro.
//      Sem nenhuma falha, insere -- mesmo quando toda métrica veio
//      honestamente null (fim real da retenção para essa conta): a linha
//      (ainda que só de nulls) marca o mês como já verificado e evita
//      reconsultar a Graph à toa em todo tick seguinte.
// deno-lint-ignore no-explicit-any
export async function closePreviousMonthIfMissing(
  db: any, fetchFn: typeof fetch, accountId: string, accessToken: string,
  nowSec: number,
): Promise<void> {
  const currentMonth = currentMonthOf(nowSec);
  const currentStart = Date.parse(monthWindow(currentMonth).start) / 1000;
  if (nowSec < currentStart + CLOSED_DAYS_WINDOW * DAY) return;

  const prevMonth = prevMonthOf(currentMonth);
  const prevWindow = monthWindow(prevMonth);
  const prevEndSec = Date.parse(prevWindow.endExclusive) / 1000;
  if (prevEndSec <= nowSec - RETENTION_DAYS * DAY) return;

  const { data: existing } = await db
    .from(TABLE)
    .select("id")
    .eq("instagram_account_id", accountId)
    .eq("month", prevWindow.startDate)
    .maybeSingle();
  if (existing) return;

  const since = Date.parse(prevWindow.start) / 1000;
  const until = Date.parse(prevWindow.endExclusive) / 1000;
  const { totals, failedMetrics } = await fetchAccountTotalsDetailed(
    fetchFn, accessToken, MONTHLY_METRICS, since, until,
  );

  if (failedMetrics.length > 0) {
    // Falha transitória em ao menos uma métrica -- não insere linha nenhuma
    // (nem parcial): sem outro marcador de "já processado", uma linha pela
    // metade bloquearia o refill dessa métrica para sempre via a guarda de
    // idempotência acima. A ausência da linha é o próprio retry -- o próximo
    // tick de manutenção refaz o fetch inteiro para este mês.
    console.warn(
      `[IG-SYNC-CRON] monthly close: mês ${prevWindow.startDate} da conta ${accountId} teve falha em ` +
      `${failedMetrics.join(",")} -- não insere, próximo tick reprocessa (linha ausente é o retry).`,
    );
    return;
  }

  const row = {
    instagram_account_id: accountId,
    month: prevWindow.startDate,
    reach_month: totals.reach ?? null,
    views_month: totals.views ?? null,
    saves_month: totals.saves ?? null,
    accounts_engaged_month: totals.accounts_engaged ?? null,
    profile_views_month: totals.profile_views ?? null,
    website_clicks_month: totals.website_clicks ?? null,
    follows_month: totals.follows_and_unfollows?.follows ?? null,
    unfollows_month: totals.follows_and_unfollows?.unfollows ?? null,
  };

  const { error } = await db.from(TABLE).insert(row);
  if (error) console.warn(`[IG-SYNC-CRON] monthly close insert failed: ${error.message}`);
}

const STORY_INSIGHTS_TABLE = "instagram_story_insights";
const DAILY_TABLE = "instagram_account_metrics_daily";

/**
 * Closes the STORIES portion of the monthly aggregate for one account/month.
 * Independent of closePreviousMonthIfMissing above: stories totals are summed
 * from our own instagram_story_insights table (populated by the hourly
 * story-ingest, Task 3), not fetched from the Graph API, so none of the
 * retention/idempotency-via-Graph-fetch guards above apply here.
 *
 * Coverage guard: only writes the stories_* columns when at least one daily
 * row for the month has stories_count_day set -- i.e. the hourly sync's story
 * ingest actually ran for this account during the month. Without this guard
 * an account with zero Stories activity tracked would get a fabricated
 * all-zero row instead of staying NULL (no data collected, not "zero
 * stories").
 *
 * Idempotent via `.is("stories_count_month", null)` on the update: once a
 * month's stories totals are written, a later tick never recomputes them.
 */
// deno-lint-ignore no-explicit-any
export async function closeStoriesForMonth(
  db: any, accountId: string, month: string,
): Promise<void> {
  const monthStart = `${month}-01`;
  const nextMonthStart = `${nextMonth(month)}-01`;

  // Coverage signal: only write stories columns if the account has at least
  // one daily row with stories_count_day set for the month. Both bounds are
  // full "YYYY-MM-DD" dates (not bare "YYYY-MM") -- snapshot_date is a `date`
  // column, and Postgres's date parser requires all three fields.
  const { data: coverage } = await db
    .from(DAILY_TABLE)
    .select("id")
    .eq("instagram_account_id", accountId)
    .gte("snapshot_date", monthStart)
    .lt("snapshot_date", nextMonthStart)
    .not("stories_count_day", "is", null)
    .limit(1)
    .maybeSingle();

  if (!coverage) return; // No stories data collected this month; leave NULL

  // Aggregate from the per-story insights table. A failed read here must
  // NOT be treated as "zero stories": the coverage guard above already
  // confirmed real stories exist for this month, so defaulting a failed
  // read to an empty array would write a false all-zero total and lock it
  // in via the `.is("stories_count_month", null)` idempotency guard below
  // (review finding). Bail without writing instead -- the row stays NULL,
  // which is exactly the signal the stories-retry pass in backfill.ts looks
  // for on a later tick.
  const { data: agg, error: aggError } = await db
    .from(STORY_INSIGHTS_TABLE)
    .select("reach, impressions, replies, taps_forward, taps_back, exits")
    .eq("instagram_account_id", accountId)
    .gte("posted_at", `${monthStart}T00:00:00Z`)
    .lt("posted_at", `${nextMonthStart}T00:00:00Z`);

  if (aggError) {
    console.warn(
      `[IG-SYNC-CRON] closeStoriesForMonth: aggregate query failed for ${accountId}/${month}: ${aggError.message}`,
    );
    return;
  }

  const rows = agg ?? [];
  const totals = {
    stories_count_month: rows.length,
    // deno-lint-ignore no-explicit-any
    stories_reach_month: rows.reduce((s: number, r: any) => s + (r.reach ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    stories_impressions_month: rows.reduce((s: number, r: any) => s + (r.impressions ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    stories_replies_month: rows.reduce((s: number, r: any) => s + (r.replies ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    stories_taps_forward_month: rows.reduce((s: number, r: any) => s + (r.taps_forward ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    stories_taps_back_month: rows.reduce((s: number, r: any) => s + (r.taps_back ?? 0), 0),
    // deno-lint-ignore no-explicit-any
    stories_exits_month: rows.reduce((s: number, r: any) => s + (r.exits ?? 0), 0),
  };

  const { error } = await db
    .from(TABLE)
    .update(totals)
    .eq("instagram_account_id", accountId)
    .eq("month", monthStart)
    .is("stories_count_month", null);
  if (error) {
    console.warn(`[IG-SYNC-CRON] closeStoriesForMonth: update failed for ${accountId}/${month}: ${error.message}`);
  }
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
