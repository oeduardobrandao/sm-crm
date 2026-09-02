// Typed service for the get_workflow_analytics RPC (Fase 2 analytics rebuild,
// Task 4). The RPC (supabase/migrations/20260903000020_workflow_analytics_rpc.sql)
// returns a fail-closed jsonb payload: NULL when there is no active workspace
// or the plan lacks feature_analytics_reports. This module maps that jsonb
// through unchanged (field names verbatim from the migration's
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
}

export interface EtapaAgg {
  nome: string;
  media_dias: number | null;
  amostras: number;
  atraso_pct: number | null;
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
}

export interface WorkflowAnalytics {
  kpis: WorkflowAnalyticsKpis;
  etapas: EtapaAgg[];
  semanas: SemanaAgg[];
  semanas_criados_sem_conclusao: { semana: string; criados: number }[];
  equipe: EquipeAgg[];
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
