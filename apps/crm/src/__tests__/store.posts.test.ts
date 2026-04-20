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
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store workflow posts', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('addWorkflowPost inserts with conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: { id: 100, titulo: 'Post Instagram', workflow_id: 5, conta_id: 'conta-1' },
      error: null,
    });

    const result = await store.addWorkflowPost({
      workflow_id: 5,
      titulo: 'Post Instagram',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
    });

    expect(result).toMatchObject({ id: 100, titulo: 'Post Instagram' });
    const call = getCalls('workflow_posts', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ conta_id: 'conta-1', workflow_id: 5 });
  });

  it('updateWorkflowPost patches by id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', {
      data: { id: 100, status: 'revisao_interna' },
      error: null,
    });

    await store.updateWorkflowPost(100, { status: 'revisao_interna' });

    const call = getCalls('workflow_posts', 'update').at(-1)!;
    expect(call.payload).toEqual({ status: 'revisao_interna' });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
  });

  it('removeWorkflowPost deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'delete', { data: null, error: null });

    await store.removeWorkflowPost(100);

    const call = getCalls('workflow_posts', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
  });

  it('reorderWorkflowPosts updates ordem for each post', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update',
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    await store.reorderWorkflowPosts([
      { id: 101, ordem: 0 },
      { id: 102, ordem: 1 },
      { id: 103, ordem: 2 },
    ]);

    const updates = getCalls('workflow_posts', 'update');
    expect(updates).toHaveLength(3);
  });

  it('getWorkflowPostsCounts returns a map of workflow_id to count', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { workflow_id: 5 },
        { workflow_id: 5 },
        { workflow_id: 7 },
      ],
      error: null,
    });

    const counts = await store.getWorkflowPostsCounts([5, 7]);

    expect(counts.get(5)).toBe(2);
    expect(counts.get(7)).toBe(1);
  });

  it('getWorkflowPostsCounts returns empty map for empty input', async () => {
    const counts = await store.getWorkflowPostsCounts([]);
    expect(counts.size).toBe(0);
  });

  it('sendPostsToCliente updates aprovado_interno posts to enviado_cliente', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', { data: null, error: null });

    await store.sendPostsToCliente(5);

    const call = getCalls('workflow_posts', 'update').at(-1)!;
    expect(call.payload).toEqual({ status: 'enviado_cliente' });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflow_id', 5] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['status', 'aprovado_interno'] });
  });

  it('approvePostsInternally updates all non-final posts to aprovado_cliente', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', { data: null, error: null });

    await store.approvePostsInternally(5);

    const call = getCalls('workflow_posts', 'update').at(-1)!;
    expect(call.payload).toEqual({ status: 'aprovado_cliente' });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflow_id', 5] });
    expect(call.modifiers).toContainEqual({ method: 'not', args: ['status', 'in', '(agendado,postado)'] });
  });

  it('getPostApprovals returns empty array for no post ids', async () => {
    const result = await store.getPostApprovals([]);
    expect(result).toEqual([]);
  });

  it('getPostApprovals queries with in filter', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: [
        { id: 1, post_id: 100, action: 'aprovado', comentario: 'Ótimo!', is_workspace_user: false, created_at: '2026-04-15' },
      ],
      error: null,
    });

    const result = await store.getPostApprovals([100, 101]);

    expect(result).toHaveLength(1);
    const call = getCalls('post_approvals', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['post_id', [100, 101]] });
  });
});
