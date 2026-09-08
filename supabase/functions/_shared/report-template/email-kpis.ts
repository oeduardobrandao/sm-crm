import type { EmailKpis } from "./brand-header.ts";

/** Monta a fila de KPIs do e-mail (spec §10). Função pura: sem I/O, sem
 * conhecimento de banco -- o gerador resolve os valores brutos (fonte de
 * paridade para views, acumuladores já computados para interações e
 * seguidores) e passa aqui só para a montagem + regras de ausência.
 *
 * `pct_change` só existe para `views` (única entrada com um mês anterior
 * disponível na mesma fonte); `interactions` e `followers_gained` nunca
 * carregam delta -- YAGNI, a spec permite omitir.
 *
 * Retorna `null` quando NENHUM campo tem valor: a coluna fica null e o
 * e-mail degrada para a versão sem a fila (buildKpiRow/buildReportPreheader
 * já tratam `null` em brand-header.ts / email.ts). */
export function buildEmailKpis(p: {
  viewsMonth: number | null;
  prevViewsMonth: number | null;
  interactions: number;
  followersGained: number;
}): EmailKpis | null {
  const result: EmailKpis = {};

  if (typeof p.viewsMonth === "number" && Number.isFinite(p.viewsMonth)) {
    const pctChange =
      typeof p.prevViewsMonth === "number" && p.prevViewsMonth > 0
        ? Math.round(((p.viewsMonth - p.prevViewsMonth) / p.prevViewsMonth) * 100)
        : undefined;
    result.views = pctChange === undefined
      ? { value: p.viewsMonth }
      : { value: p.viewsMonth, pct_change: pctChange };
  }

  if (Number.isFinite(p.interactions)) {
    result.interactions = { value: p.interactions };
  }

  if (Number.isFinite(p.followersGained)) {
    result.followers_gained = { value: p.followersGained };
  }

  return Object.keys(result).length > 0 ? result : null;
}
