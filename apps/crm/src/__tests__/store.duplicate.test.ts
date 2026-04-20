import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __setCurrentUser: (user: { id: string } | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store duplicateWorkflow', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('creates a fresh workflow copy with all steps reset', async () => {
    mockedSupabase.__queueSupabaseResult('workflows', 'select', {
      data: {
        id: 10,
        cliente_id: 1,
        titulo: 'Social Mensal',
        template_id: 5,
        status: 'concluido',
        etapa_atual: 2,
        recorrente: true,
      },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select', {
      data: [
        { id: 101, ordem: 0, nome: 'Briefing', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'padrao', status: 'concluido' },
        { id: 102, ordem: 1, nome: 'Design', prazo_dias: 3, tipo_prazo: 'corridos', responsavel_id: 1, tipo: 'padrao', status: 'concluido' },
        { id: 103, ordem: 2, nome: 'Aprovação', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'aprovacao_cliente', status: 'concluido' },
      ],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflows', 'insert', {
      data: { id: 20, cliente_id: 1, titulo: 'Social Mensal', status: 'ativo', etapa_atual: 0 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'insert',
      { data: { id: 201, ordem: 0, status: 'ativo' }, error: null },
      { data: { id: 202, ordem: 1, status: 'pendente' }, error: null },
      { data: { id: 203, ordem: 2, status: 'pendente' }, error: null },
    );

    const result = await store.duplicateWorkflow(10);

    expect(result).toMatchObject({ id: 20, status: 'ativo', etapa_atual: 0 });

    const etapaInserts = getCalls('workflow_etapas', 'insert');
    expect(etapaInserts).toHaveLength(3);

    expect(etapaInserts[0].payload).toMatchObject({ status: 'ativo', ordem: 0, workflow_id: 20 });
    expect(etapaInserts[0].payload).toHaveProperty('iniciado_em');

    expect(etapaInserts[1].payload).toMatchObject({ status: 'pendente', ordem: 1 });
    expect(etapaInserts[2].payload).toMatchObject({ status: 'pendente', ordem: 2, tipo: 'aprovacao_cliente' });
  });

  it('cleans up the new workflow if etapa inserts fail', async () => {
    mockedSupabase.__queueSupabaseResult('workflows', 'select', {
      data: { id: 10, cliente_id: 1, titulo: 'Social', template_id: null, status: 'concluido', etapa_atual: 0, recorrente: false },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select', {
      data: [{ id: 101, ordem: 0, nome: 'Briefing', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'padrao', status: 'concluido' }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflows', 'insert', {
      data: { id: 30, cliente_id: 1, titulo: 'Social', status: 'ativo', etapa_atual: 0 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'insert', {
      data: null,
      error: { message: 'DB constraint violation' },
    });
    mockedSupabase.__queueSupabaseResult('workflows', 'delete', { data: null, error: null });

    await expect(store.duplicateWorkflow(10)).rejects.toThrow();

    const deleteCalls = getCalls('workflows', 'delete');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(deleteCalls.at(-1)!.modifiers).toContainEqual({ method: 'eq', args: ['id', 30] });
  });
});
