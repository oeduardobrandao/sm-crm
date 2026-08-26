import { useQueries } from '@tanstack/react-query';
import { getClientes, getMembros, getWorkflows } from '../../store';
import { getPortfolioSummary } from '../../services/analytics';
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
 * ['membros'], ['workflows'], ['portfolioSummary']) para herdar as invalidações
 * existentes; a única chave própria é ['hub-token-any'] (ver store/hub.ts).
 * refetchOnWindowFocus fica no default (true) para a volta de deep links.
 */
export function useGuideSignals(enabled: boolean): GuideSignals {
  const [clientesQ, membrosQ, workflowsQ, portfolioQ, hubQ] = useQueries({
    queries: [
      { queryKey: ['clientes'], queryFn: getClientes, enabled },
      { queryKey: ['membros'], queryFn: getMembros, enabled },
      { queryKey: ['workflows'], queryFn: getWorkflows, enabled },
      { queryKey: ['portfolioSummary'], queryFn: () => getPortfolioSummary(), enabled },
      { queryKey: ['hub-token-any'], queryFn: hasAnyHubToken, enabled },
    ],
  });

  const values: Partial<Record<SignalKey, boolean>> = {};
  if (clientesQ.status === 'success') values.hasCliente = clientesQ.data.length > 0;
  if (membrosQ.status === 'success') values.hasMembro = membrosQ.data.length > 0;
  if (workflowsQ.status === 'success') values.hasWorkflow = workflowsQ.data.length > 0;
  if (portfolioQ.status === 'success') values.hasInstagram = portfolioQ.data.accounts.length > 0;
  if (hubQ.status === 'success') values.hasHubToken = hubQ.data;

  const latestClienteId =
    clientesQ.status === 'success' && clientesQ.data.length > 0
      ? clientesQ.data.reduce<number>((max, c) => (c.id! > max ? c.id! : max), clientesQ.data[0]!.id!)
      : null;

  return {
    values,
    latestClienteId,
    clientes: { status: clientesQ.status, count: clientesQ.data?.length ?? 0 },
    workflows: { status: workflowsQ.status, count: workflowsQ.data?.length ?? 0 },
  };
}
