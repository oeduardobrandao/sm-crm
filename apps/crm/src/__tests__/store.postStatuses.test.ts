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
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

const DEF = {
  id: 'def-1',
  conta_id: 'conta-1',
  nome: 'Em design',
  cor: '#7c5cff',
  behaves_as: 'revisao_interna',
  ordem: 0,
  arquivado: false,
};

describe('store post status definitions', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPostStatusDefinitions excludes archived by default, ordered by ordem then nome', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_definitions', 'select', {
      data: [DEF],
      error: null,
    });

    const result = await store.getPostStatusDefinitions();

    expect(result).toHaveLength(1);
    const call = getCalls('post_status_definitions', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['arquivado', false] });
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['ordem', { ascending: true }],
    });
    expect(call.modifiers).toContainEqual({ method: 'order', args: ['nome', { ascending: true }] });
  });

  it('getPostStatusDefinitions includeArchived skips the arquivado filter', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_definitions', 'select', {
      data: [DEF, { ...DEF, id: 'def-2', arquivado: true }],
      error: null,
    });

    const result = await store.getPostStatusDefinitions({ includeArchived: true });

    expect(result).toHaveLength(2);
    const call = getCalls('post_status_definitions', 'select').at(-1)!;
    expect(call.modifiers).not.toContainEqual({ method: 'eq', args: ['arquivado', false] });
  });

  it('createPostStatusDefinition inserts with conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_definitions', 'insert', {
      data: DEF,
      error: null,
    });

    const result = await store.createPostStatusDefinition({
      nome: 'Em design',
      cor: '#7c5cff',
      behaves_as: 'revisao_interna',
      ordem: 0,
      icone: null,
    });

    expect(result).toMatchObject({ id: 'def-1' });
    const call = getCalls('post_status_definitions', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      nome: 'Em design',
      behaves_as: 'revisao_interna',
      conta_id: 'conta-1',
    });
  });

  it('archivePostStatusDefinition only flips arquivado (detach is the DB trigger)', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_definitions', 'update', {
      data: null,
      error: null,
    });

    await store.archivePostStatusDefinition('def-1');

    const call = getCalls('post_status_definitions', 'update').at(-1)!;
    expect(call.payload).toEqual({ arquivado: true });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'def-1'] });
    expect(getCalls('workflow_posts')).toHaveLength(0);
  });

  it('deletePostStatusDefinition deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_definitions', 'delete', {
      data: null,
      error: null,
    });

    await store.deletePostStatusDefinition('def-1');

    const call = getCalls('post_status_definitions', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'def-1'] });
  });
});

describe('store post status automations', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('createPostStatusAutomation inserts with conta_id and config', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_automations', 'insert', {
      data: { id: 'auto-1' },
      error: null,
    });

    await store.createPostStatusAutomation({
      trigger_status: 'correcao_cliente',
      trigger_custom_status_id: null,
      action_type: 'notify',
      config: { target: 'responsavel' },
    });

    const call = getCalls('post_status_automations', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      trigger_status: 'correcao_cliente',
      action_type: 'notify',
      conta_id: 'conta-1',
    });
  });

  it('updatePostStatusAutomation patches by id', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_automations', 'update', {
      data: { id: 'auto-1', ativo: false },
      error: null,
    });

    await store.updatePostStatusAutomation('auto-1', { ativo: false });

    const call = getCalls('post_status_automations', 'update').at(-1)!;
    expect(call.payload).toEqual({ ativo: false });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'auto-1'] });
  });
});
