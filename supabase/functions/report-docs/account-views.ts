// Views da conta no mês do relatório, congeladas no data_snapshot na geração.
// Reusa a matemática de janelas de instagram-analytics/views.ts (import
// cross-function; precedente: snapshot-source.ts importa os mappers do gerador
// v2). Regras herdadas de lá: a janela clampa nos 90 dias de retenção de
// insights do Graph — um mês PARCIALMENTE fora da retenção não congela um
// número enganoso no relatório (vira null); prev só existe quando a janela
// anterior inteira cabe na retenção.
import { parseViewsRange, sumViewsRange } from "../instagram-analytics/views.ts";
import { monthWindow } from "../_shared/report-docs/month-window.ts";

export interface AccountViewsResult {
  value: number | null;
  prev: number | null;
}

const DAY_MS = 86_400_000;

export async function fetchAccountViews(
  fetchFn: typeof fetch,
  accessToken: string,
  month: string,
  nowSec: number,
): Promise<AccountViewsResult> {
  const w = monthWindow(month);
  // parseViewsRange espera end INCLUSIVO (soma +1 dia por conta própria).
  const endInclusive = new Date(Date.parse(`${w.endDateExclusive}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  const params = new URLSearchParams({ start: w.startDate, end: endInclusive });
  const parsed = parseViewsRange(params, nowSec);
  if (!parsed.ok || parsed.range.partial) return { value: null, prev: null };

  const { since, until, prev } = parsed.range;
  const [value, prevValue] = await Promise.all([
    sumViewsRange(fetchFn, accessToken, since, until),
    prev
      ? sumViewsRange(fetchFn, accessToken, prev.since, prev.until)
      : Promise.resolve<number | null>(null),
  ]);
  return { value, prev: prevValue };
}
