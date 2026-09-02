import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import {
  getWorkflowAnalytics,
  NotEntitledError,
  ANALYTICS_TZ,
  type WorkflowAnalytics,
} from './workflowAnalytics';

type Mocked = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __queueSupabaseRpc: (name: string, ...r: Array<{ data?: unknown; error?: unknown }>) => void;
  __getSupabaseCalls: () => Array<{ table: string; operation: string; payload?: unknown }>;
};
const mocked = supabaseModule as Mocked;

beforeEach(() => mocked.__resetSupabaseMock());

// A fully-populated jsonb payload matching the shape of get_workflow_analytics'
// jsonb_build_object calls verbatim (supabase/migrations/20260903000020_workflow_analytics_rpc.sql).
const fullPayload: WorkflowAnalytics = {
  kpis: {
    concluidos: 12,
    concluidos_prev: 9,
    ativos: 4,
    tempo_medio_dias: 3.5,
    tempo_medio_prev: 4.1,
    pontualidade_pct: 82,
    pontualidade_prev: 75,
    etapas_avaliadas: 20,
  },
  etapas: [{ nome: 'Roteiro', media_dias: 2.1, amostras: 5, atraso_pct: 10 }],
  semanas: [{ semana: '2026-08-24', concluidos: 3, criados: 5 }],
  semanas_criados_sem_conclusao: [{ semana: '2026-08-31', criados: 2 }],
  equipe: [
    { membro_id: 7, concluidas: 4, media_dias: 1.9, no_prazo: 3, atrasadas: 1, avaliadas: 4 },
  ],
};

const RANGE = {
  from: new Date('2026-08-01T00:00:00Z'),
  to: new Date('2026-09-01T00:00:00Z'),
};

function rpcCall() {
  return mocked.__getSupabaseCalls().find((c) => c.table === 'rpc:get_workflow_analytics');
}

describe('getWorkflowAnalytics', () => {
  it('maps a full jsonb payload through unchanged', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', { data: fullPayload, error: null });
    const res = await getWorkflowAnalytics(RANGE);
    expect(res).toEqual(fullPayload);
  });

  it('throws NotEntitledError when data is null (not entitled / no active workspace)', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', { data: null, error: null });
    await expect(getWorkflowAnalytics(RANGE)).rejects.toBeInstanceOf(NotEntitledError);
  });

  it('rejects when supabase returns an error', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(getWorkflowAnalytics(RANGE)).rejects.toBeTruthy();
  });

  it('sends the exact p_* param names, ANALYTICS_TZ, and null defaults for omitted filters', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', { data: fullPayload, error: null });
    await getWorkflowAnalytics(RANGE);
    expect(rpcCall()?.payload).toEqual({
      p_from: RANGE.from.toISOString(),
      p_to: RANGE.to.toISOString(),
      p_tz: ANALYTICS_TZ,
      p_cliente_id: null,
      p_template_id: null,
      p_membro_id: null,
    });
  });

  it('passes through provided cliente/template/membro filters as the exact p_* names', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', { data: fullPayload, error: null });
    await getWorkflowAnalytics({ ...RANGE, clienteId: 3, templateId: 8, membroId: 12 });
    expect(rpcCall()?.payload).toEqual({
      p_from: RANGE.from.toISOString(),
      p_to: RANGE.to.toISOString(),
      p_tz: ANALYTICS_TZ,
      p_cliente_id: 3,
      p_template_id: 8,
      p_membro_id: 12,
    });
  });

  it('maps an explicit null filter the same as an omitted one', async () => {
    mocked.__queueSupabaseRpc('get_workflow_analytics', { data: fullPayload, error: null });
    await getWorkflowAnalytics({ ...RANGE, clienteId: null, templateId: null, membroId: null });
    expect(rpcCall()?.payload).toEqual({
      p_from: RANGE.from.toISOString(),
      p_to: RANGE.to.toISOString(),
      p_tz: ANALYTICS_TZ,
      p_cliente_id: null,
      p_template_id: null,
      p_membro_id: null,
    });
  });
});
