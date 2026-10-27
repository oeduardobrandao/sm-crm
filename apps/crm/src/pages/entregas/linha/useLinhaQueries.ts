import { useQuery } from '@tanstack/react-query';
import {
  listColunas,
  listItens,
  listLinhasDoMes,
  listRespostas,
  type LinhaColuna,
  type LinhaEditorial,
  type LinhaItem,
  type LinhaResposta,
} from '@/store/linhaEditorial';

export const linhasKey = (periodo: string) => ['linha', periodo] as const;
export const linhaItensKey = (linhaId: string | null | undefined) =>
  ['linha-itens', linhaId] as const;
export const linhaColunasKey = ['linha-colunas'] as const;
export const linhaRespostasKey = (linhaId: string | null | undefined) =>
  ['linha-respostas', linhaId] as const;

/**
 * Everything the linha editorial view reads. `periodo` is `YYYY-MM-01`; `linhaId` is the
 * selected client's linha (null while the client has none, which parks the three per-linha
 * queries). Columns are workspace-wide, so their key carries no linha.
 */
export function useLinhaQueries(periodo: string, linhaId: string | null) {
  const linhas = useQuery<LinhaEditorial[]>({
    queryKey: linhasKey(periodo),
    queryFn: () => listLinhasDoMes(periodo),
  });
  const itens = useQuery<LinhaItem[]>({
    queryKey: linhaItensKey(linhaId),
    queryFn: () => listItens(linhaId!),
    enabled: !!linhaId,
  });
  const colunas = useQuery<LinhaColuna[]>({
    queryKey: linhaColunasKey,
    queryFn: listColunas,
  });
  const respostas = useQuery<LinhaResposta[]>({
    queryKey: linhaRespostasKey(linhaId),
    queryFn: () => listRespostas(linhaId!),
    enabled: !!linhaId,
  });
  return { linhas, itens, colunas, respostas };
}
