import { useQuery } from '@tanstack/react-query';
import {
  getAcordoVersoes,
  getRentabilidade,
  type AcordoVersao,
  type MetaPeriodo,
  type ModeloAcordo,
  type RentabilidadeSeeded,
} from '@/store';

export const UNIDADES = ['arte', 'vídeo', 'gravação', 'post'] as const;

export const PERIODO_OPCOES: { value: MetaPeriodo; label: string }[] = [
  { value: 'dia_util', label: 'dia útil' },
  { value: 'semana', label: 'semana' },
  { value: 'mes', label: 'mês' },
];

export const MODELO_LABEL: Record<ModeloAcordo, string> = {
  mensal_meta: 'Mensal com meta',
  mensal_limite: 'Mensal com limite',
  por_entrega: 'Por entrega',
};

export const MODELO_DESCRICAO: Record<ModeloAcordo, string> = {
  mensal_meta: 'Valor fixo por mês e uma meta de entregas.',
  mensal_limite: 'Valor fixo por mês para atender até um número de clientes.',
  por_entrega: 'Recebe por cada entrega feita.',
};

const DIAS_UTEIS_NO_MES = 22;
const SEMANAS_NO_MES = 4.3;

/** The monthly equivalent of a meta: 22 dias úteis or 4,3 semanas per month. */
export function metaPorMes(quantidade: number, periodo: MetaPeriodo): number {
  const fator =
    periodo === 'dia_util' ? DIAS_UTEIS_NO_MES : periodo === 'semana' ? SEMANAS_NO_MES : 1;
  return Math.round(quantidade * fator);
}

/** 'arte' -> 'artes', 'gravação' -> 'gravações'; singular when quantidade is 1. */
export function unidadeComNumero(unidade: string, quantidade: number): string {
  if (quantidade === 1) return unidade;
  return unidade.endsWith('ão') ? `${unidade.slice(0, -2)}ões` : `${unidade}s`;
}

export function periodoLabel(periodo: MetaPeriodo): string {
  return PERIODO_OPCOES.find((p) => p.value === periodo)?.label ?? periodo;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-10-01' -> 'out 2026'; a start that is not the 1st keeps its day: '15 out 2026'. */
export function rotuloValeDesde(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map((p) => parseInt(p, 10));
  if (!ano || !mes || !dia) return iso;
  const base = `${MESES[mes - 1] ?? ''} ${ano}`;
  return dia === 1 ? base : `${dia} ${base}`;
}

/** '2026-10-05' -> '05/10/2026'. */
export function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
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
