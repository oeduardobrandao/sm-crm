import { addDays, addMonths, format, parseISO } from 'date-fns';
import { getDateFnsLocale, getIntlLocale, i18n } from '@mesaas/i18n';
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

/**
 * Label of a period in the UI language. The RPCs send `rotulo` in Portuguese
 * (`financeiro_periodo_rotulo`: 'out 2026', '15 out a 14 nov'), so Portuguese shows it as is
 * and any other language rebuilds it from the dates with the same three cases: a full
 * calendar month, a span inside one year, a span across years. `fim` is exclusive.
 */
export function rotuloPeriodo(p: Pick<PeriodoFinanceiro, 'inicio' | 'fim' | 'rotulo'>): string {
  if (getIntlLocale() === 'pt-BR') return p.rotulo;
  const inicio = parseISO(p.inicio);
  const fimExclusivo = parseISO(p.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fimExclusivo.getTime())) return p.rotulo;
  const locale = getDateFnsLocale();
  const ultimo = addDays(fimExclusivo, -1);
  const mesInteiro =
    inicio.getDate() === 1 && addMonths(inicio, 1).getTime() === fimExclusivo.getTime();
  if (mesInteiro) return format(inicio, i18n.t('financeV2:periodo.formatoMes'), { locale });
  const padrao =
    inicio.getFullYear() !== ultimo.getFullYear()
      ? i18n.t('financeV2:periodo.formatoDiaAno')
      : i18n.t('financeV2:periodo.formatoDia');
  return i18n.t('financeV2:periodo.intervalo', {
    inicio: format(inicio, padrao, { locale }),
    fim: format(ultimo, padrao, { locale }),
  });
}
