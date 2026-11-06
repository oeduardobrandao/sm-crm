import { useQuery } from '@tanstack/react-query';
import { getIntlLocale, i18n } from '@mesaas/i18n';
import {
  getAcordoVersoes,
  getRentabilidade,
  type AcordoVersao,
  type MetaPeriodo,
  type ModeloAcordo,
  type RentabilidadeSeeded,
} from '@/store';

export const UNIDADES = ['arte', 'vídeo', 'gravação', 'post'] as const;

/** Meta periods in the order the select lists them. */
export const PERIODOS: MetaPeriodo[] = ['dia_util', 'semana', 'mes'];

/** Display label of an agreement model, resolved in the current UI language. */
export function modeloLabel(modelo: ModeloAcordo): string {
  return i18n.t(`member:acordoHelpers.modelo.${modelo}`);
}

/** One-line explanation of an agreement model, resolved in the current UI language. */
export function modeloDescricao(modelo: ModeloAcordo): string {
  return i18n.t(`member:acordoHelpers.modeloDescricao.${modelo}`);
}

const DIAS_UTEIS_NO_MES = 22;
const SEMANAS_NO_MES = 4.3;

/** The monthly equivalent of a meta: 22 dias úteis or 4,3 semanas per month. */
export function metaPorMes(quantidade: number, periodo: MetaPeriodo): number {
  const fator =
    periodo === 'dia_util' ? DIAS_UTEIS_NO_MES : periodo === 'semana' ? SEMANAS_NO_MES : 1;
  return Math.round(quantidade * fator);
}

// Lives with regraTexto (financeiro/v2/format.ts), which pluralises the same way.
export { unidadeComNumero } from '../financeiro/v2/format';

export function periodoLabel(periodo: MetaPeriodo): string {
  return PERIODOS.includes(periodo) ? i18n.t(`member:acordoHelpers.periodo.${periodo}`) : periodo;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * '2026-10-01' -> 'out 2026' ('Oct 2026' in en); a start that is not the 1st keeps its
 * day: '15 out 2026' ('Oct 15, 2026' in en).
 */
export function rotuloValeDesde(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map((p) => parseInt(p, 10));
  if (!ano || !mes || !dia) return iso;
  if (getIntlLocale() === 'pt-BR') {
    const base = `${MESES[mes - 1] ?? ''} ${ano}`;
    return dia === 1 ? base : `${dia} ${base}`;
  }
  const mesEn = MONTHS_EN[mes - 1] ?? '';
  return dia === 1 ? `${mesEn} ${ano}` : `${mesEn} ${dia}, ${ano}`;
}

/** '2026-10-05' -> '05/10/2026' ('10/05/2026' in en). */
export function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  if (!(ano && mes && dia)) return iso;
  return getIntlLocale() === 'pt-BR' ? `${dia}/${mes}/${ano}` : `${mes}/${dia}/${ano}`;
}

/** The version in force at `inicio`: the greatest `vale_desde` not after it. */
export function versaoVigente(versoes: AcordoVersao[], inicio: string): AcordoVersao | undefined {
  let melhor: AcordoVersao | undefined;
  for (const v of versoes) {
    if (v.vale_desde <= inicio && (!melhor || v.vale_desde > melhor.vale_desde)) melhor = v;
  }
  return melhor;
}

/**
 * The member's agreement history plus the current period's payload, which tells which
 * version is in force and which clients the member serves.
 */
export function useAcordoAtual(membroId: number) {
  const rent = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', 'atual'],
    queryFn: () => getRentabilidade(),
  });
  const versoes = useQuery({
    queryKey: ['financeiro-v2', 'acordo', membroId],
    queryFn: () => getAcordoVersoes(membroId),
  });
  const payload: RentabilidadeSeeded | null = rent.data?.seeded ? rent.data : null;
  const inicio = payload?.periodo.inicio ?? null;
  const atual = inicio && versoes.data ? versaoVigente(versoes.data, inicio) : undefined;
  return {
    payload,
    inicio,
    versoes: versoes.data ?? [],
    atual,
    isLoading: rent.isLoading || versoes.isLoading,
    isError: rent.isError || versoes.isError,
  };
}

/** Readable name for a stored contract path (the object name is a uuid). */
export function contratoRotulo(path: string): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1]?.toLowerCase();
  return ext
    ? i18n.t('member:acordoHelpers.contratoComExtensao', { ext })
    : i18n.t('member:acordoHelpers.contrato');
}
