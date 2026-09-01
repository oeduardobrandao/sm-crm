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
