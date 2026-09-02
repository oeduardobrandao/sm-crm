// Typed service for the get_workflow_analytics RPC (Fase 2 analytics rebuild,
// Task 4; extended by Fase 3 "Métricas de eventos", Task 3). The RPC
// (supabase/migrations/20260903000020_workflow_analytics_rpc.sql, superset-
// extended by 20260903000030_workflow_analytics_events.sql) returns a
// fail-closed jsonb payload: NULL when there is no active workspace or the
// plan lacks feature_analytics_reports. This module maps that jsonb through
// unchanged (field names and nullability verbatim from the migrations'
// jsonb_build_object calls) and turns the NULL sentinel into a typed error so
// callers (Task 5) can distinguish "not entitled" from "no data yet".
import { supabase } from '../lib/supabase';

export const ANALYTICS_TZ = 'America/Sao_Paulo';

export interface WorkflowAnalyticsKpis {
  concluidos: number;
  concluidos_prev: number;
  ativos: number;
  tempo_medio_dias: number | null;
  tempo_medio_prev: number | null;
  pontualidade_pct: number | null;
  pontualidade_prev: number | null;
  etapas_avaliadas: number;
  // Fase 3 (20260903000030): base de comparação do delta de pontualidade.
  // count(*) FILTER(...) -- nunca null.
  etapas_avaliadas_prev: number;
  // % de fluxos com atividade na janela que sofreram >= 1 reversão. Divisão
  // por NULLIF(count(DISTINCT workflow_id), 0) -- null quando não há nenhum
  // evento na janela. SEMPRE do workspace inteiro, ignora p_membro_id.
  retrabalho_pct: number | null;
  retrabalho_prev: number | null;
}

export interface EtapaAgg {
  nome: string;
  media_dias: number | null;
  amostras: number;
  atraso_pct: number | null;
  // Fase 3: round(100.0 * COALESCE(reverts, 0) / NULLIF(conclusoes, 0)) --
  // null quando a etapa não teve nenhuma conclusão registrada na janela; 0
  // quando teve conclusão e nenhuma devolução. Vem de ev_win (workflow_events),
  // que NÃO filtra por p_membro_id -- ao contrário dos irmãos deste objeto,
  // este número é sempre do workspace inteiro para a etapa.
  retrabalho_pct: number | null;
}

export interface SemanaAgg {
  semana: string;
  concluidos: number;
  criados: number;
}

export interface EquipeAgg {
  membro_id: number;
  concluidas: number;
  media_dias: number | null;
  no_prazo: number;
  atrasadas: number;
  avaliadas: number;
  // Fase 3: ambos COALESCE(..., 0) -- nunca null.
  retrabalho: number;
  atividade: number;
}

/** Fase 3: cobertura do log de eventos, por fonte, sem janela e sem filtros
 *  (workflow_events e post_status_events nasceram em datas diferentes e vêm
 *  de triggers best-effort). min(created_at) por fonte -- null quando essa
 *  fonte não tem nenhum evento ainda para o workspace. */
export interface WorkflowAnalyticsHorizonte {
  workflow_events_since: string | null;
  post_events_since: string | null;
}

export interface AprovacaoClienteBucket {
  faixa: string;
  quantidade: number;
}

export interface AprovacaoClientePorCliente {
  cliente_id: number;
  // percentile_cont sobre os ciclos fechados PELO CLIENTE -- null quando o
  // cliente só tem ciclos pendentes (amostras 0, pendentes > 0); a linha
  // ainda aparece (NULLS LAST), não é omitida.
  mediana_horas: number | null;
  amostras: number;
  pendentes: number;
}

/** Fase 3: latência do ciclo de aprovação pelo cliente
 *  (post_status_events: abre em to_status='enviado_cliente', fecha no
 *  primeiro evento seguinte do mesmo post com from_status='enviado_cliente';
 *  fechado-pelo-cliente = source='client' OR post_approval_id IS NOT NULL).
 *  Ignora p_membro_id de propósito -- mede o cliente, não um responsável. */
export interface AprovacaoCliente {
  // percentile_cont sobre `latencias` -- null quando não há nenhum ciclo
  // fechado pelo cliente na janela.
  mediana_horas: number | null;
  amostras: number;
  pendentes: number;
  resolvidos_internamente: number;
  // As 5 faixas sempre saem, na mesma ordem, mesmo zeradas (VALUES fixo) --
  // nunca um array vazio, ao contrário de por_cliente/origem/etapas(topo).
  buckets: AprovacaoClienteBucket[];
  por_cliente: AprovacaoClientePorCliente[];
  // Complemento: fluxos de aprovação-do-cliente SEM nenhum post associado.
  etapas: {
    amostras: number;
    mediana_horas: number | null;
  };
}

export interface OrigemAgg {
  // workflows.created_via: text NOT NULL DEFAULT 'human', CHECK IN ('human','agent').
  origem: string;
  concluidos: number;
  // avg(...) dentro de um GROUP BY que só existe quando há >= 1 linha --
  // nunca null para um grupo presente no array.
  tempo_medio_dias: number;
}

export interface WorkflowAnalytics {
  kpis: WorkflowAnalyticsKpis;
  etapas: EtapaAgg[];
  semanas: SemanaAgg[];
  semanas_criados_sem_conclusao: { semana: string; criados: number }[];
  equipe: EquipeAgg[];
  horizonte: WorkflowAnalyticsHorizonte;
  aprovacao_cliente: AprovacaoCliente;
  origem: OrigemAgg[];
}

/** Thrown when the RPC returns NULL: no active workspace, or the workspace's
 *  plan lacks feature_analytics_reports (fail-closed guard in the RPC). */
export class NotEntitledError extends Error {
  constructor() {
    super('not_entitled');
    this.name = 'NotEntitledError';
  }
}

export interface WorkflowAnalyticsParams {
  from: Date;
  to: Date;
  clienteId?: number | null;
  templateId?: number | null;
  membroId?: number | null;
}

export async function getWorkflowAnalytics(
  params: WorkflowAnalyticsParams,
): Promise<WorkflowAnalytics> {
  const { from, to, clienteId, templateId, membroId } = params;
  const { data, error } = await supabase.rpc('get_workflow_analytics', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_tz: ANALYTICS_TZ,
    p_cliente_id: clienteId ?? null,
    p_template_id: templateId ?? null,
    p_membro_id: membroId ?? null,
  });
  if (error) throw error;
  if (data === null) throw new NotEntitledError();
  return data as WorkflowAnalytics;
}
