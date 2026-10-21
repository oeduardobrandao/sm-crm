import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAllClienteDatas,
  getClientes,
  getMembros,
  getScheduledPosts,
  getTransacoes,
  getWorkflowEtapasByWorkflowIds,
  getWorkflows,
} from '../../../store';
import type { FinancialAccess } from '@/lib/financialAccess';
import { getPostPublishState } from '../../entregas/postLabels';
import { NICHE_CALENDARS } from '../nicheCalendars/registry';
import { expandirComemorativas } from './comemorativas';
import { calcularPrazos, workflowsAtivosIds } from './prazos';
import {
  diaLocal,
  expandirDatasClientes,
  expandirPagamentos,
  expandirRecebimentos,
} from './recorrencias';
import type { CamadaItem, CamadasAtivas } from './tipos';

export interface PeriodoCamadas {
  start: Date;
  /** Exclusive. */
  end: Date;
}

/**
 * The read-only layer items of the visible range. Each query runs only while its
 * layer is on; the financial ones also need `canSeeFinancials === true` (the
 * toggles are hidden otherwise, and `'unknown'` counts as no). Query keys are the
 * ones the rest of the app already uses, so the cache is shared and purged with
 * them on a permission change.
 */
export function useCamadas(
  periodo: PeriodoCamadas | null,
  ativas: CamadasAtivas,
  canSeeFinancials: FinancialAccess | undefined,
  nichoKey: string,
): CamadaItem[] {
  const financeiro = canSeeFinancials === true;
  const recebimentos = ativas.recebimentos && financeiro;
  const pagamentos = ativas.pagamentos && financeiro;
  const startISO = periodo?.start.toISOString() ?? '';
  const endISO = periodo?.end.toISOString() ?? '';

  const postsQ = useQuery({
    queryKey: ['scheduled-posts', startISO, endISO],
    queryFn: () => getScheduledPosts(startISO, endISO),
    enabled: ativas.posts && periodo !== null,
    staleTime: 30_000,
  });
  const clientesQ = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: ativas.prazos || ativas.datas || recebimentos,
  });
  const membrosQ = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
    enabled: pagamentos,
  });
  const transacoesQ = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
    enabled: recebimentos || pagamentos,
  });
  const workflowsQ = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: ativas.prazos,
  });
  const workflows = workflowsQ.data;
  // Same key (and value) as the "Calendário" tab's deadline query.
  const etapasQ = useQuery({
    queryKey: ['calendar-deadlines', (workflows ?? []).map((w) => w.id).join(',')],
    queryFn: () => getWorkflowEtapasByWorkflowIds(workflowsAtivosIds(workflows ?? [])),
    enabled: ativas.prazos && (workflows?.length ?? 0) > 0,
  });
  const datasQ = useQuery({
    queryKey: ['allClienteDatas'],
    queryFn: getAllClienteDatas,
    enabled: ativas.datas,
  });

  // Guard the reads as well as the fetches: a key populated elsewhere (Entregas,
  // Financeiro) keeps its cached data on a disabled observer.
  const posts = ativas.posts ? postsQ.data : undefined;
  const clientes = clientesQ.data;
  const membros = pagamentos ? membrosQ.data : undefined;
  const transacoes = recebimentos || pagamentos ? transacoesQ.data : undefined;
  const etapas = ativas.prazos ? etapasQ.data : undefined;
  const datas = ativas.datas ? datasQ.data : undefined;

  return useMemo(() => {
    if (!periodo) return [];
    const { start, end } = periodo;
    const itens: CamadaItem[] = [];

    for (const p of posts ?? []) {
      itens.push({
        camada: 'posts',
        id: `posts:${p.id}`,
        inicio: p.scheduled_at,
        post: p,
        estado: getPostPublishState(p),
      });
    }
    if (ativas.prazos && workflows && etapas) {
      // Remaining days from now, at render: never frozen at fetch time.
      for (const prazo of calcularPrazos(workflows, etapas, clientes ?? [])) {
        if (prazo.deadlineDate < start || prazo.deadlineDate >= end) continue;
        const dia = diaLocal(prazo.deadlineDate);
        itens.push({ camada: 'prazos', id: `prazos:${prazo.workflowId}`, dia, prazo });
      }
    }
    if (recebimentos && clientes && transacoes) {
      itens.push(...expandirRecebimentos(clientes, transacoes, start, end));
    }
    if (pagamentos && membros && transacoes) {
      itens.push(...expandirPagamentos(membros, transacoes, start, end));
    }
    if (ativas.datas && clientes) {
      itens.push(...expandirDatasClientes(clientes, datas ?? [], start, end));
    }
    if (ativas.comemorativas) {
      const niche = NICHE_CALENDARS.find((n) => n.key === nichoKey) ?? NICHE_CALENDARS[0];
      if (niche) itens.push(...expandirComemorativas(niche, start, end));
    }
    return itens;
  }, [
    periodo,
    posts,
    ativas.prazos,
    ativas.datas,
    ativas.comemorativas,
    workflows,
    etapas,
    clientes,
    recebimentos,
    pagamentos,
    membros,
    transacoes,
    datas,
    nichoKey,
  ]);
}
