import type { PeriodoFinanceiro } from '@/store/financeiroV2';

/**
 * Default pick of an editable-periods list without relying on its order (the RPC returns
 * oldest first, `financeiro_periodos_listar` newest first): the open period, else the latest
 * period that is not a projected 'futuro', else the earliest one.
 */
export function periodoPadrao(periodos: PeriodoFinanceiro[]): PeriodoFinanceiro | undefined {
  const aberto = periodos.find((p) => p.status === 'aberto');
  if (aberto) return aberto;
  const porInicio = [...periodos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const reais = porInicio.filter((p) => p.status !== 'futuro');
  return reais.length > 0 ? reais[reais.length - 1] : porInicio[0];
}
