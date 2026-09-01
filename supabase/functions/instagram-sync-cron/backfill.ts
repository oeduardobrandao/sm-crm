// Backfill mensal durável + passo de manutenção do instagram-sync-cron.
// Spec §3.1 decisão 2 + §4.2.3 — o backfill DIÁRIO de 90d morreu no
// checkpoint; o backfill que persiste é MENSAL (instagram_account_metrics_monthly),
// andando do mês anterior completo até 12 meses para trás ou até a Graph
// devolver um mês inteiramente vazio (fim real da retenção).
//
// Este módulo roda como um passo de MANUTENÇÃO, separado do batch de sync:
// seletor próprio (`authorization_status='active'` + token presente +
// `metrics_backfilled_at is null`), independente de `auto_sync_enabled` e de
// `feature_auto_sync_cron` — contas de qualquer plano recebem o backfill
// mensal, não só as com sync automático ativo.
//
// O fechamento mensal recorrente (Task 7, `closePreviousMonthIfMissing`)
// também roda AQUI, para as contas JÁ backfilladas — nunca no caminho
// por-conta do sync batch (achado Codex P1: rodar fetch extra por conta a
// cada sync horário multiplicaria o custo Graph por 24x/dia à toa).
import {
  type AccountMetric, type DailyValues,
  fetchAccountTotalsDetailed, fetchFollowerCountDeltas, fetchReachDaily,
} from "../_shared/instagram-account-metrics.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import { closePreviousMonthIfMissing } from "./monthly-close.ts";
import { buildDailyRows } from "./daily-ingest.ts";

const DAY = 86400;
const MONTHLY_TABLE = "instagram_account_metrics_monthly";
// Cap: nunca anda mais de 12 meses para trás a partir do mês corrente, mesmo
// que a Graph continue devolvendo dados (nunca deveria, retenção é 90d, mas
// é uma rede de segurança contra um bug de normalização fazendo o cursor
// andar para sempre).
const MAX_MONTHS_BACK = 12;
// Página de contas JÁ backfilladas revisadas por tick para fechamento mensal.
// Não precisa ser grande: closePreviousMonthIfMissing é idempotente e barato
// (uma linha já existente == zero chamadas Graph), então mesmo com muitas
// contas o custo real por tick é dominado pelas que realmente têm um mês novo
// para fechar. As contas já fechadas no mês corrente são EXCLUÍDAS do
// seletor (ver runMaintenanceStep) antes do limit, então esta página nunca
// starva contas com id alto -- o conjunto elegível encolhe a cada fechamento.
const CLOSE_PAGE_LIMIT = 50;

const MONTHLY_METRICS: AccountMetric[] = [
  "reach", "views", "saves", "accounts_engaged",
  "profile_views", "website_clicks", "follows_and_unfollows",
];

function currentMonthOf(nowSec: number): string {
  const d = new Date(nowSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Próximo mês-alvo do backfill, puro. `cursor` é o dia 1 do mês mais antigo
 * já preenchido (ou null se a conta nunca rodou o backfill). O alvo é sempre
 * um mês para trás do cursor (ou, sem cursor, o mês anterior completo ao
 * corrente). `done` vira true quando o alvo já está a mais de
 * MAX_MONTHS_BACK meses do mês corrente — o chamador não deve fazer fetch
 * nesse caso, só marcar `metrics_backfilled_at`.
 */
export function nextBackfillMonth(
  cursor: string | null, nowSec: number,
): { month: string; done: boolean } {
  const currentMonth = currentMonthOf(nowSec);
  const cursorMonth = cursor ? cursor.slice(0, 7) : currentMonth;
  const targetMonth = prevMonthOf(cursorMonth);
  const targetDate = monthWindow(targetMonth).startDate;
  const monthsBack = monthsBetween(targetMonth, currentMonth);
  return { month: targetDate, done: monthsBack > MAX_MONTHS_BACK };
}

function addDaysUtc(dateStr: string, deltaDays: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + deltaDays * DAY * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ancora os DELTAS diários de follower_count (Graph devolve variação
 * dia-a-dia, não total corrente — ver instagram-account-metrics.ts) em
 * totais absolutos, andando do presente para trás: total[data mais recente
 * do mapa] = currentTotal (o follower_count atual da conta); para cada dia
 * `d` coberto, total[dia anterior a d] = total[d] - delta[d]. Pura.
 *
 * O andar para trás exige contiguidade dia-a-dia: assim que o próximo dia
 * esperado não está no mapa de deltas, a função para ali — nunca inventa um
 * total para um dia sem dado.
 */
export function anchorFollowerTotals(
  currentTotal: number, deltas: Map<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (deltas.size === 0) return result;

  const dates = [...deltas.keys()].sort().reverse(); // mais recente primeiro
  let total = currentTotal;
  let expectedDate = dates[0];
  result.set(expectedDate, total);

  for (const d of dates) {
    if (d !== expectedDate) break; // buraco no mapa de deltas: para, sem fabricar
    const delta = deltas.get(d)!;
    total = total - delta;
    expectedDate = addDaysUtc(expectedDate, -1);
    result.set(expectedDate, total);
  }

  return result;
}

// deno-lint-ignore no-explicit-any
async function upsertFollowerHistory(
  db: any, accountId: string, totals: Map<string, number>,
): Promise<void> {
  const dates = [...totals.keys()];
  if (dates.length === 0) return;

  // Checagem em lote (mesma regra do sync: nunca sobrescrever entrada
  // 'manual'), mas para até ~31 dias de uma vez em vez de um select por dia.
  const { data: existing } = await db
    .from("instagram_follower_history")
    .select("date, source")
    .eq("instagram_account_id", accountId)
    .in("date", dates);
  const manualDates = new Set(
    (existing ?? [])
      .filter((r: { source: string }) => r.source === "manual")
      .map((r: { date: string }) => r.date),
  );

  const rows = [...totals.entries()]
    .filter(([date]) => !manualDates.has(date))
    .map(([date, follower_count]) => ({
      instagram_account_id: accountId, date, follower_count, source: "api",
    }));
  if (rows.length === 0) return;

  const { error } = await db
    .from("instagram_follower_history")
    .upsert(rows, { onConflict: "instagram_account_id,date" });
  if (error) console.warn(`[IG-SYNC-CRON] backfill follower_history upsert failed: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
async function backfillReachDaily(
  db: any, fetchFn: typeof fetch, accessToken: string, accountId: string, nowSec: number,
): Promise<void> {
  const since = nowSec - 90 * DAY;
  const reachMap = await fetchReachDaily(fetchFn, accessToken, since, nowSec);
  const daily = new Map<string, Partial<DailyValues>>();
  for (const [date, reach] of reachMap) daily.set(date, { reach });
  const rows = buildDailyRows(accountId, daily);
  if (rows.length === 0) return;
  const { error } = await db.rpc("upsert_metrics_daily", { p_rows: rows });
  if (error) console.warn(`[IG-SYNC-CRON] backfill reach_day upsert failed: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
async function backfillFollowerHistory(
  db: any, fetchFn: typeof fetch, accessToken: string, accountId: string,
  currentFollowerCount: number, nowSec: number,
): Promise<void> {
  const since = nowSec - 30 * DAY;
  const deltas = await fetchFollowerCountDeltas(fetchFn, accessToken, since, nowSec);
  const totals = anchorFollowerTotals(currentFollowerCount, deltas);
  await upsertFollowerHistory(db, accountId, totals);
}

// deno-lint-ignore no-explicit-any
async function markBackfilled(db: any, accountId: string): Promise<void> {
  const { error } = await db
    .from("instagram_accounts")
    .update({ metrics_backfilled_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) console.warn(`[IG-SYNC-CRON] failed to mark metrics_backfilled_at for account ${accountId}: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
async function markExpired(db: any, accountId: string): Promise<void> {
  await db.from("instagram_accounts").update({ authorization_status: "expired" }).eq("id", accountId);
}

function isTokenExpired(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "TOKEN_EXPIRED";
}

interface PendingAccount {
  id: string;
  encrypted_access_token: string;
  follower_count: number;
  metrics_backfill_cursor: string | null;
}

/**
 * Roda um tick de backfill para UMA conta: no primeiro tick (cursor null),
 * também tenta os extras de melhor esforço (reach_day 90d + histórico de
 * seguidores por delta) ANTES do mês — se falharem, loga e segue com o mês
 * mesmo assim (a semântica de cursor pertence só aos meses; estes extras não
 * são retentados automaticamente depois que o cursor avança).
 *
 * Retorna true quando a conta teve progresso nesta chamada (mês inserido +
 * cursor avançado, ou marcada como concluída); false em TOKEN_EXPIRED ou
 * falha de escrita (cursor intocado — o próximo tick tenta de novo).
 */
// deno-lint-ignore no-explicit-any
async function backfillOneAccount(
  db: any, fetchFn: typeof fetch, decryptToken: (b64: string) => Promise<string>,
  account: PendingAccount, nowSec: number,
): Promise<boolean> {
  const accessToken = await decryptToken(account.encrypted_access_token);
  const isFirstTick = account.metrics_backfill_cursor === null;

  if (isFirstTick) {
    try {
      await backfillReachDaily(db, fetchFn, accessToken, account.id, nowSec);
    } catch (e) {
      // TOKEN_EXPIRED aqui é tratado igual ao caminho do mês: marca expirado e
      // pula para a próxima conta imediatamente, em vez de gastar o fetch do
      // mês sabendo que o token já está morto.
      if (isTokenExpired(e)) {
        await markExpired(db, account.id);
        return false;
      }
      console.warn(
        `[IG-SYNC-CRON] backfill reach_day 90d falhou para a conta ${account.id} ` +
        `(não-fatal, não é retentado automaticamente depois que o cursor avançar):`, e,
      );
    }
    try {
      await backfillFollowerHistory(db, fetchFn, accessToken, account.id, account.follower_count, nowSec);
    } catch (e) {
      if (isTokenExpired(e)) {
        await markExpired(db, account.id);
        return false;
      }
      console.warn(
        `[IG-SYNC-CRON] backfill de histórico de seguidores falhou para a conta ${account.id} ` +
        `(não-fatal, não é retentado automaticamente depois que o cursor avançar):`, e,
      );
    }
  }

  const target = nextBackfillMonth(account.metrics_backfill_cursor, nowSec);
  if (target.done) {
    await markBackfilled(db, account.id);
    return true;
  }

  const targetMonth = target.month.slice(0, 7);
  const window = monthWindow(targetMonth);
  const since = Date.parse(window.start) / 1000;
  const until = Date.parse(window.endExclusive) / 1000;

  let totals;
  let failedMetrics: AccountMetric[];
  try {
    ({ totals, failedMetrics } = await fetchAccountTotalsDetailed(fetchFn, accessToken, MONTHLY_METRICS, since, until));
  } catch (e) {
    if (isTokenExpired(e)) {
      await markExpired(db, account.id);
      return false;
    }
    throw e;
  }

  const row = {
    instagram_account_id: account.id,
    month: target.month,
    reach_month: totals.reach ?? null,
    views_month: totals.views ?? null,
    saves_month: totals.saves ?? null,
    accounts_engaged_month: totals.accounts_engaged ?? null,
    profile_views_month: totals.profile_views ?? null,
    website_clicks_month: totals.website_clicks ?? null,
    follows_month: totals.follows_and_unfollows?.follows ?? null,
    unfollows_month: totals.follows_and_unfollows?.unfollows ?? null,
  };
  const hasAny = [
    row.reach_month, row.views_month, row.saves_month, row.accounts_engaged_month,
    row.profile_views_month, row.website_clicks_month, row.follows_month, row.unfollows_month,
  ].some((v) => v !== null);

  if (!hasAny) {
    if (failedMetrics.length > 0) {
      // Tudo null, mas ao menos uma métrica veio de uma FALHA (erro de
      // chunk/rede), não de um mês honestamente vazio -- fetchAccountTotals
      // sozinho não distingue os dois casos (ambos normalizam pra null por
      // métrica), por isso o backfill usa a variante Detailed aqui. Marcar
      // metrics_backfilled_at neste caso finalizaria a conta permanentemente
      // por causa de uma falha transitória, perdendo todos os meses mais
      // antigos. Não avança o cursor -- o próximo tick reprocessa este MESMO
      // mês, e só finaliza de verdade quando ele vier honestamente vazio.
      console.warn(
        `[IG-SYNC-CRON] backfill: mês ${target.month} da conta ${account.id} veio ` +
        `inteiramente null com falha em ${failedMetrics.join(",")} -- não finalizando ` +
        `o backfill, tick seguinte reprocessa o mesmo mês.`,
      );
      return false;
    }
    // Mês inteiro sem dado e SEM falha (todas as métricas honestamente
    // vazias): fim real da retenção da Graph para esta conta. Não insere
    // linha de nulls, encerra o backfill aqui.
    await markBackfilled(db, account.id);
    return true;
  }

  const { error: upsertError } = await db
    .from(MONTHLY_TABLE)
    .upsert(row, { onConflict: "instagram_account_id,month" });
  if (upsertError) {
    console.warn(`[IG-SYNC-CRON] backfill: upsert mensal falhou para a conta ${account.id}: ${upsertError.message}`);
    return false; // cursor intocado -- próximo tick reprocessa este mês
  }

  const { error: cursorError } = await db
    .from("instagram_accounts")
    .update({ metrics_backfill_cursor: target.month })
    .eq("id", account.id);
  if (cursorError) {
    console.warn(`[IG-SYNC-CRON] backfill: avanço de cursor falhou para a conta ${account.id}: ${cursorError.message}`);
    return false;
  }

  return true;
}

export interface RunMaintenanceStepOptions {
  batchLimit: number;
  nowSec: number;
  /** Override de CLOSE_PAGE_LIMIT -- só para teste (fila pequena e determinística). */
  closeBatchLimit?: number;
}

export interface RunMaintenanceStepResult {
  backfilled: number;
  monthsClosed: number;
}

/**
 * Passo de manutenção do cron: roda ANTES do batch de sync, com seletor e
 * orçamento próprios (spec §4.2.3), independente de auto_sync_enabled e de
 * feature_auto_sync_cron. Duas fases:
 *   1) Contas com metrics_backfilled_at NULL: até `batchLimit` contas, 1 mês
 *      (+ extras de primeiro tick) cada.
 *   2) Contas já backfilladas, EXCLUINDO as que já têm a linha do mês anterior
 *      (até CLOSE_PAGE_LIMIT do restante): closePreviousMonthIfMissing (Task 7)
 *      -- é aqui, e só aqui, que o fechamento mensal recorrente roda. A exclusão
 *      evita starvation: sem ela, `order(id).limit(N)` sempre reseleciona o
 *      mesmo bloco de ids baixos e uma conta com id alto nunca é alcançada.
 *
 * Falha em uma conta nunca derruba o passo inteiro nem o restante do cron:
 * cada conta roda no seu próprio try/catch.
 */
export async function runMaintenanceStep(
  // deno-lint-ignore no-explicit-any
  db: any, fetchFn: typeof fetch, decryptToken: (b64: string) => Promise<string>,
  opts: RunMaintenanceStepOptions,
): Promise<RunMaintenanceStepResult> {
  let backfilled = 0;
  let monthsClosed = 0;

  const { data: pending, error: pendingError } = await db
    .from("instagram_accounts")
    .select("id, encrypted_access_token, follower_count, metrics_backfill_cursor")
    .eq("authorization_status", "active")
    .not("encrypted_access_token", "is", null)
    .is("metrics_backfilled_at", null)
    .order("id", { ascending: true })
    .limit(opts.batchLimit);
  if (pendingError) {
    console.warn(`[IG-SYNC-CRON] backfill: falha ao listar contas pendentes: ${pendingError.message}`);
  }

  for (const account of (pending ?? []) as PendingAccount[]) {
    try {
      const progressed = await backfillOneAccount(db, fetchFn, decryptToken, account, opts.nowSec);
      if (progressed) backfilled++;
    } catch (e) {
      console.warn(`[IG-SYNC-CRON] backfill: falha não-fatal na conta ${account.id}:`, e);
    }
  }

  // Exclui do seletor as contas que JÁ têm a linha do mês anterior -- sem
  // isso, `order("id").limit(N)` sempre devolve o mesmo bloco de ids mais
  // baixos, e uma conta com id fora desse bloco nunca é alcançada assim que
  // o total de contas já-backfilladas passa de N (achado do review). O
  // conjunto "precisa fechar" encolhe para vazio conforme os fechamentos vão
  // acontecendo, então toda conta é alcançada em alguma tick.
  //
  // Durante os dias 1-3 do mês (dentro da janela de finalização de
  // closePreviousMonthIfMissing), a linha do mês anterior ainda não existe
  // para ninguém -- a exclusão fica vazia e todo tick reseleciona até
  // CLOSE_PAGE_LIMIT contas, mas cada chamada retorna sem tocar a Graph (a
  // guarda de janela é a primeira checagem da função). Custo extra: só a
  // query de exclusão abaixo, uma leitura barata.
  const currentMonth = currentMonthOf(opts.nowSec);
  const prevMonthDay1 = monthWindow(prevMonthOf(currentMonth)).startDate;
  const { data: closedAccounts, error: closedError } = await db
    .from(MONTHLY_TABLE)
    .select("instagram_account_id")
    .eq("month", prevMonthDay1);
  if (closedError) {
    console.warn(`[IG-SYNC-CRON] backfill: falha ao listar contas já fechadas em ${prevMonthDay1}: ${closedError.message}`);
  }
  const closedIds = new Set(
    (closedAccounts ?? []).map((r: { instagram_account_id: string }) => r.instagram_account_id),
  );

  let closableQuery = db
    .from("instagram_accounts")
    .select("id, encrypted_access_token")
    .eq("authorization_status", "active")
    .not("encrypted_access_token", "is", null)
    .not("metrics_backfilled_at", "is", null);
  if (closedIds.size > 0) {
    closableQuery = closableQuery.not("id", "in", `(${[...closedIds].join(",")})`);
  }
  const { data: closable, error: closableError } = await closableQuery
    .order("id", { ascending: true })
    .limit(opts.closeBatchLimit ?? CLOSE_PAGE_LIMIT);
  if (closableError) {
    console.warn(`[IG-SYNC-CRON] backfill: falha ao listar contas para fechamento mensal: ${closableError.message}`);
  }

  for (const account of (closable ?? []) as Array<{ id: string; encrypted_access_token: string }>) {
    try {
      const accessToken = await decryptToken(account.encrypted_access_token);
      await closePreviousMonthIfMissing(db, fetchFn, account.id, accessToken, opts.nowSec);
      monthsClosed++;
    } catch (e) {
      if (isTokenExpired(e)) {
        await markExpired(db, account.id);
      } else {
        console.warn(`[IG-SYNC-CRON] backfill: fechamento mensal falhou para a conta ${account.id} (não-fatal):`, e);
      }
    }
  }

  return { backfilled, monthsClosed };
}
