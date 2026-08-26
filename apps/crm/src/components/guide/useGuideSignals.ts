import { useQueries } from '@tanstack/react-query';
import { getClientes, getMembros, getWorkflows } from '../../store';
import { hasAnyInstagramAccount } from '../../services/analytics';
import { hasAnyHubToken } from '../../store/hub';
import type { SignalKey } from './guideContent';

export interface GuideSignals {
  /** Chave ausente = inconclusivo (query pending ou em erro). NUNCA `data ?? []`. */
  values: Partial<Record<SignalKey, boolean>>;
  latestClienteId: number | null;
  clientes: { status: 'pending' | 'error' | 'success'; count: number };
  workflows: { status: 'pending' | 'error' | 'success'; count: number };
}

/**
 * Sinais de conclusão do guia. Reusa as query keys do app (['clientes'],
 * ['membros'], ['workflows']) para herdar as invalidações existentes; as
 * chaves próprias são ['ig-account-any'] e ['hub-token-any'] (ver
 * services/analytics.ts e store/hub.ts). Ambas são count/head que LANÇAM em
 * erro — nunca a agregação getPortfolioSummary, que engole falhas e devolveria
 * um falso confirmado. O callback do OAuth do Instagram recarrega a página
 * inteira, então a chave própria não perde invalidação relevante ali, e
 * refetchOnWindowFocus (default) cobre o resto.
 */
export function useGuideSignals(enabled: boolean): GuideSignals {
  const [clientesQ, membrosQ, workflowsQ, igQ, hubQ] = useQueries({
    queries: [
      { queryKey: ['clientes'], queryFn: getClientes, enabled },
      { queryKey: ['membros'], queryFn: getMembros, enabled },
      { queryKey: ['workflows'], queryFn: getWorkflows, enabled },
      { queryKey: ['ig-account-any'], queryFn: hasAnyInstagramAccount, enabled },
      { queryKey: ['hub-token-any'], queryFn: hasAnyHubToken, enabled },
    ],
  });

  const values: Partial<Record<SignalKey, boolean>> = {};
  if (clientesQ.status === 'success') values.hasCliente = clientesQ.data.length > 0;
  if (membrosQ.status === 'success') values.hasMembro = membrosQ.data.length > 0;
  if (workflowsQ.status === 'success') values.hasWorkflow = workflowsQ.data.length > 0;
  if (igQ.status === 'success') values.hasInstagram = igQ.data;
  if (hubQ.status === 'success') values.hasHubToken = hubQ.data;

  // getClientes() ordena created_at desc, id desc — data[0] é sempre o mais
  // recente. Um reduce por maior id erra para clientes importados/backfilled,
  // que podem carregar um id maior com created_at mais antigo.
  const latestClienteId =
    clientesQ.status === 'success' && clientesQ.data.length > 0
      ? (clientesQ.data[0]!.id ?? null)
      : null;

  return {
    values,
    latestClienteId,
    clientes: { status: clientesQ.status, count: clientesQ.data?.length ?? 0 },
    workflows: { status: workflowsQ.status, count: workflowsQ.data?.length ?? 0 },
  };
}
