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
  __queueSupabaseRpc: (
    name: string,
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

  it('addWorkflowPost does not touch sync_mentions when conteudo is null', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: { id: 100, titulo: 'Post Instagram', workflow_id: 5, conta_id: 'conta-1' },
      error: null,
    });

    await store.addWorkflowPost({
      workflow_id: 5,
      titulo: 'Post Instagram',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
    });

    expect(getCalls('rpc:sync_mentions', 'rpc')).toHaveLength(0);
  });

  it('addWorkflowPost syncs mentions extracted from a conteudo doc with mention nodes', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: { id: 100, titulo: 'Post Instagram', workflow_id: 5, conta_id: 'conta-1' },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { entityType: 'membro', id: 12, label: 'Ana', parentId: null },
            },
            { type: 'text', text: ' confere isso' },
            {
              type: 'mention',
              attrs: { entityType: 'cliente', id: 3, label: 'Acme', parentId: null },
            },
          ],
        },
      ],
    };

    await store.addWorkflowPost({
      workflow_id: 5,
      titulo: 'Post Instagram',
      conteudo: doc,
      conteudo_plain: 'confere isso',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
    });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_host_type: 'workflow_post',
      p_host_id: 100,
      p_membro_ids: [12],
    });
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

  it('updateWorkflowPost does not touch sync_mentions when conteudo is not part of the patch', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', {
      data: { id: 100, status: 'revisao_interna' },
      error: null,
    });

    await store.updateWorkflowPost(100, { status: 'revisao_interna' });

    expect(getCalls('rpc:sync_mentions', 'rpc')).toHaveLength(0);
  });

  it('updateWorkflowPost syncs mentions extracted from a conteudo doc with mention nodes', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', {
      data: { id: 100, conteudo: {} },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { entityType: 'membro', id: 12, label: 'Ana', parentId: null },
            },
            { type: 'text', text: ' confere isso' },
            {
              type: 'mention',
              attrs: { entityType: 'cliente', id: 3, label: 'Acme', parentId: null },
            },
          ],
        },
      ],
    };

    await store.updateWorkflowPost(100, { conteudo: doc });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_host_type: 'workflow_post',
      p_host_id: 100,
      p_membro_ids: [12],
    });
  });

  it('updateWorkflowPost syncs an empty array when conteudo is written with no mention nodes', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', {
      data: { id: 100, conteudo: null },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.updateWorkflowPost(100, { conteudo: null });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_host_type: 'workflow_post',
      p_host_id: 100,
      p_membro_ids: [],
    });
  });

  it('updateWorkflowPost resolves even when sync_mentions rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update', {
      data: { id: 100, conteudo: null },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', {
      data: null,
      error: { message: 'boom' },
    });

    await expect(store.updateWorkflowPost(100, { conteudo: null })).resolves.toMatchObject({
      id: 100,
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('removeWorkflowPost deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'delete', { data: null, error: null });

    await store.removeWorkflowPost(100);

    const call = getCalls('workflow_posts', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
  });

  it('reorderWorkflowPosts updates ordem for each post', async () => {
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'update',
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
      data: [{ workflow_id: 5 }, { workflow_id: 5 }, { workflow_id: 7 }],
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

  it('getPostPreview selects detail fields by id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: {
        conteudo_plain: 'Texto do post',
        responsavel_id: 9,
        ig_caption: 'Legenda IG',
        published_at: null,
        instagram_permalink: null,
      },
      error: null,
    });

    const preview = await store.getPostPreview(100);

    expect(preview).toEqual({
      conteudo_plain: 'Texto do post',
      responsavel_id: 9,
      ig_caption: 'Legenda IG',
      published_at: null,
      instagram_permalink: null,
    });
    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
  });

  it('getPostPreview coerces nulls to safe defaults', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: {
        conteudo_plain: null,
        responsavel_id: null,
        ig_caption: null,
        published_at: null,
        instagram_permalink: null,
      },
      error: null,
    });

    const preview = await store.getPostPreview(7);
    expect(preview.conteudo_plain).toBe('');
    expect(preview.responsavel_id).toBeNull();
  });

  it('getWorkflowAwaitingClientePostsCounts returns an empty map when no workflow ids are given', async () => {
    const result = await store.getWorkflowAwaitingClientePostsCounts([]);
    expect(result.size).toBe(0);
  });

  it('getWorkflowAwaitingClientePostsCounts counts enviado_cliente posts per workflow', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [{ workflow_id: 1 }, { workflow_id: 1 }, { workflow_id: 2 }],
      error: null,
    });
    const result = await store.getWorkflowAwaitingClientePostsCounts([1, 2]);
    expect(result.get(1)).toBe(2);
    expect(result.get(2)).toBe(1);
    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['workflow_id', [1, 2]] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['status', 'enviado_cliente'] });
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
    expect(call.modifiers).toContainEqual({
      method: 'not',
      args: ['status', 'in', '(agendado,postado)'],
    });
  });

  it('getPostApprovals returns empty array for no post ids', async () => {
    const result = await store.getPostApprovals([]);
    expect(result).toEqual([]);
  });

  it('getWorkflowPostResponsaveis returns a map of workflow_id to responsavel arrays', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { workflow_id: 5, responsavel_id: 10 },
        { workflow_id: 5, responsavel_id: 20 },
        { workflow_id: 7, responsavel_id: 10 },
      ],
      error: null,
    });

    const map = await store.getWorkflowPostResponsaveis([5, 7]);

    expect(map.get(5)).toEqual([10, 20]);
    expect(map.get(7)).toEqual([10]);
    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['workflow_id', [5, 7]] });
    expect(call.modifiers).toContainEqual({ method: 'not', args: ['responsavel_id', 'is', null] });
  });

  it('getWorkflowPostResponsaveis deduplicates responsavel_id per workflow', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { workflow_id: 5, responsavel_id: 10 },
        { workflow_id: 5, responsavel_id: 10 },
        { workflow_id: 5, responsavel_id: 10 },
      ],
      error: null,
    });

    const map = await store.getWorkflowPostResponsaveis([5]);

    expect(map.get(5)).toEqual([10]);
  });

  it('getWorkflowPostResponsaveis returns empty map for empty input', async () => {
    const map = await store.getWorkflowPostResponsaveis([]);
    expect(map.size).toBe(0);
  });

  it('getPostApprovals queries with in filter', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: [
        {
          id: 1,
          post_id: 100,
          action: 'aprovado',
          comentario: 'Ótimo!',
          is_workspace_user: false,
          created_at: '2026-04-15',
        },
      ],
      error: null,
    });

    const result = await store.getPostApprovals([100, 101]);

    expect(result).toHaveLength(1);
    const call = getCalls('post_approvals', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['post_id', [100, 101]] });
  });

  it('getScheduledPosts merges the wired arm with the avulso arm and re-sorts by scheduled_at', async () => {
    // Two-query merge (Promise.all): the FIRST 'workflow_posts' select call is the
    // wired (workflows!inner) arm, the SECOND is the avulso (.is('workflow_id', null))
    // arm -- see the shared supabaseMock's per-table/operation FIFO queue.
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      {
        data: [
          {
            id: 1,
            workflow_id: 5,
            titulo: 'Post A',
            tipo: 'feed',
            status: 'aprovado_cliente',
            scheduled_at: '2026-06-16T17:00:00.000Z',
            published_at: null,
            ig_caption: 'Legenda',
            instagram_permalink: null,
            publish_error: null,
            ordem: 0,
            responsavel_id: 10,
            workflows: {
              titulo: 'Posts Junho',
              cliente_id: 7,
              status: 'ativo',
              clientes: { nome: 'Yasmin' },
            },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 2,
            workflow_id: null,
            cliente_id: 9,
            titulo: 'Post avulso',
            tipo: 'feed',
            status: 'rascunho',
            scheduled_at: '2026-06-10T12:00:00.000Z',
            published_at: null,
            ig_caption: null,
            instagram_permalink: null,
            publish_error: null,
            ordem: 0,
            responsavel_id: null,
            clientes: { nome: 'Beto' },
          },
        ],
        error: null,
      },
    );

    const result = await store.getScheduledPosts(
      '2026-06-01T03:00:00.000Z',
      '2026-07-01T03:00:00.000Z',
    );

    expect(result).toHaveLength(2);
    // The avulso post (06-10) sorts before the wired one (06-16) after the merge.
    expect(result.map((p) => p.id)).toEqual([2, 1]);
    expect(result[1]).toMatchObject({
      id: 1,
      workflow_id: 5,
      cliente_id: 7,
      cliente_nome: 'Yasmin',
      workflow_titulo: 'Posts Junho',
      status: 'aprovado_cliente',
      scheduled_at: '2026-06-16T17:00:00.000Z',
    });
    expect(result[0]).toMatchObject({
      id: 2,
      workflow_id: null,
      cliente_id: 9,
      cliente_nome: 'Beto',
      workflow_titulo: null,
      status: 'rascunho',
      scheduled_at: '2026-06-10T12:00:00.000Z',
    });

    const calls = getCalls('workflow_posts', 'select');
    expect(calls).toHaveLength(2);
    const [wiredCall, avulsoCall] = calls;

    expect(wiredCall.modifiers).toContainEqual({
      method: 'eq',
      args: ['workflows.status', 'ativo'],
    });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'gte',
      args: ['scheduled_at', '2026-06-01T03:00:00.000Z'],
    });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'lt',
      args: ['scheduled_at', '2026-07-01T03:00:00.000Z'],
    });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'not',
      args: ['scheduled_at', 'is', null],
    });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'order',
      args: ['scheduled_at', { ascending: true }],
    });

    expect(avulsoCall.modifiers).toContainEqual({ method: 'is', args: ['workflow_id', null] });
    expect(avulsoCall.modifiers).toContainEqual({
      method: 'gte',
      args: ['scheduled_at', '2026-06-01T03:00:00.000Z'],
    });
    expect(avulsoCall.modifiers).toContainEqual({
      method: 'lt',
      args: ['scheduled_at', '2026-07-01T03:00:00.000Z'],
    });
    expect(avulsoCall.modifiers).toContainEqual({
      method: 'not',
      args: ['scheduled_at', 'is', null],
    });
  });
});

describe('searchPostsForMention', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('returns [] without querying for a blank term', async () => {
    const result = await store.searchPostsForMention('   ');
    expect(result).toEqual([]);
    expect(getCalls('workflow_posts', 'select')).toHaveLength(0);
  });

  it('wraps the trimmed term in %...% and caps at 5', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [{ id: 1, titulo: 'Post de lançamento', workflow_id: 9 }],
      error: null,
    });

    const result = await store.searchPostsForMention('  lançamento  ');

    expect(result).toEqual([{ id: 1, titulo: 'Post de lançamento', workflow_id: 9 }]);
    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'ilike', args: ['titulo', '%lançamento%'] });
    expect(call.modifiers).toContainEqual({ method: 'limit', args: [5] });
  });

  it('escapes %, _ and \\ in the search term before building the ILIKE pattern', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', { data: [], error: null });

    await store.searchPostsForMention('100%_off\\promo');

    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({
      method: 'ilike',
      args: ['titulo', '%100\\%\\_off\\\\promo%'],
    });
  });
});

describe('getPostStatusEvents', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
  });

  it('queries post_status_events for the given post ids, ordered by created_at', async () => {
    mockedSupabase.__queueSupabaseResult('post_status_events', 'select', {
      data: [
        {
          id: 1,
          post_id: 10,
          from_status: 'rascunho',
          to_status: 'revisao_interna',
          source: 'workspace_user',
          actor_user_id: 'user-1',
          actor_name: 'Eduardo Souza',
          post_approval_id: null,
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
      error: null,
    });

    const result = await store.getPostStatusEvents([10, 11]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ post_id: 10, source: 'workspace_user' });

    const call = getCalls('post_status_events', 'select').at(-1)!;
    expect(call.modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'in', args: ['post_id', [10, 11]] }),
        expect.objectContaining({ method: 'order', args: ['created_at', { ascending: true }] }),
      ]),
    );
  });

  it('returns [] without querying when no post ids are given', async () => {
    const result = await store.getPostStatusEvents([]);
    expect(result).toEqual([]);
    expect(getCalls('post_status_events')).toHaveLength(0);
  });
});

describe('posts avulsos', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('createAvulsoPost inserts a workflow-less post with the fixed defaults + conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: {
        id: 200,
        workflow_id: null,
        cliente_id: 9,
        titulo: 'Post avulso',
        conta_id: 'conta-1',
      },
      error: null,
    });

    const result = await store.createAvulsoPost({
      cliente_id: 9,
      titulo: 'Post avulso',
      tipo: 'feed',
    });

    expect(result).toMatchObject({ id: 200, titulo: 'Post avulso' });
    const call = getCalls('workflow_posts', 'insert').at(-1)!;
    expect(call.payload).toEqual({
      cliente_id: 9,
      titulo: 'Post avulso',
      tipo: 'feed',
      is_express: false,
      workflow_id: null,
      status: 'rascunho',
      ordem: 0,
      conteudo: null,
      conteudo_plain: '',
      conta_id: 'conta-1',
    });
  });

  it('createAvulsoPost honors an explicit is_express', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: { id: 201 },
      error: null,
    });

    await store.createAvulsoPost({
      cliente_id: 9,
      titulo: 'Post expresso',
      tipo: 'reels',
      is_express: true,
    });

    const call = getCalls('workflow_posts', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ is_express: true });
  });

  it('getStandalonePost selects the post with its client name and maps cliente_nome', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: {
        id: 300,
        workflow_id: null,
        cliente_id: 9,
        titulo: 'Post avulso',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        clientes: { nome: 'Beto' },
      },
      error: null,
    });

    const result = await store.getStandalonePost(300);

    expect(result).toMatchObject({ id: 300, titulo: 'Post avulso', cliente_nome: 'Beto' });
    expect((result as { clientes?: unknown }).clientes).toBeUndefined();
    const call = getCalls('workflow_posts', 'select').at(-1)!;
    expect(call.selectArgs).toContainEqual(['*, clientes(nome)']);
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 300] });
    expect(call.modifiers).toContainEqual({ method: 'maybeSingle', args: [] });
  });

  it('getStandalonePost returns null when the post is gone', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: null,
      error: null,
    });

    expect(await store.getStandalonePost(999)).toBeNull();
  });

  it('detachPostsFromWorkflow calls the RPC with the post ids and the archive flag', async () => {
    mockedSupabase.__queueSupabaseRpc('detach_posts_from_flow', {
      data: { ok: true, detached: 2, archived_workflow_ids: [] },
      error: null,
    });

    const result = await store.detachPostsFromWorkflow([10, 11]);

    expect(result).toEqual({ ok: true, detached: 2, archived_workflow_ids: [] });
    const call = getCalls('rpc:detach_posts_from_flow', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_post_ids: [10, 11], p_archive_empty_flow: false });
  });

  it('detachPostsFromWorkflow forwards an explicit archiveEmptyFlow', async () => {
    mockedSupabase.__queueSupabaseRpc('detach_posts_from_flow', {
      data: { ok: true, detached: 1, archived_workflow_ids: [5] },
      error: null,
    });

    await store.detachPostsFromWorkflow([10], true);

    const call = getCalls('rpc:detach_posts_from_flow', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_post_ids: [10], p_archive_empty_flow: true });
  });

  it('attachPostToWorkflow calls the RPC with a single-element post id array', async () => {
    mockedSupabase.__queueSupabaseRpc('attach_posts_to_flow', {
      data: { ok: true, attached: 1 },
      error: null,
    });

    const result = await store.attachPostToWorkflow(10, 5);

    expect(result).toEqual({ ok: true, attached: 1 });
    const call = getCalls('rpc:attach_posts_to_flow', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_post_ids: [10], p_workflow_id: 5 });
  });

  it('reorderBoardPosts calls the RPC with parallel arrays and skips the call for an empty list', async () => {
    mockedSupabase.__queueSupabaseRpc('reorder_board_posts', { data: null, error: null });

    await store.reorderBoardPosts([
      { id: 7, board_ordem: 1024 },
      { id: 9, board_ordem: null },
    ]);
    const call = getCalls('rpc:reorder_board_posts', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_post_ids: [7, 9], p_ordens: [1024, null] });

    await store.reorderBoardPosts([]);
    expect(getCalls('rpc:reorder_board_posts', 'rpc')).toHaveLength(1);
  });

  it('detachPostsFromWorkflow retries once on a 40P01 deadlock and succeeds', async () => {
    mockedSupabase.__queueSupabaseRpc(
      'detach_posts_from_flow',
      { data: null, error: { code: '40P01', message: 'deadlock detected' } },
      { data: { ok: true, detached: 1, archived_workflow_ids: [] }, error: null },
    );

    const result = await store.detachPostsFromWorkflow([10]);

    expect(result).toEqual({ ok: true, detached: 1, archived_workflow_ids: [] });
    expect(getCalls('rpc:detach_posts_from_flow', 'rpc')).toHaveLength(2);
  });

  it('attachPostToWorkflow retries once on a 40P01 deadlock and succeeds', async () => {
    mockedSupabase.__queueSupabaseRpc(
      'attach_posts_to_flow',
      { data: null, error: { code: '40P01', message: 'deadlock detected' } },
      { data: { ok: true, attached: 1 }, error: null },
    );

    const result = await store.attachPostToWorkflow(10, 5);

    expect(result).toEqual({ ok: true, attached: 1 });
    expect(getCalls('rpc:attach_posts_to_flow', 'rpc')).toHaveLength(2);
  });

  it('detachPostsFromWorkflow does not retry more than once and throws the second error', async () => {
    mockedSupabase.__queueSupabaseRpc(
      'detach_posts_from_flow',
      { data: null, error: { code: '40P01', message: 'deadlock detected' } },
      { data: null, error: { code: '40P01', message: 'deadlock detected again' } },
    );

    await expect(store.detachPostsFromWorkflow([10])).rejects.toMatchObject({ code: '40P01' });
    expect(getCalls('rpc:detach_posts_from_flow', 'rpc')).toHaveLength(2);
  });

  it('detachPostsFromWorkflow does not retry a non-deadlock error', async () => {
    mockedSupabase.__queueSupabaseRpc('detach_posts_from_flow', {
      data: null,
      error: { code: 'P0001', message: 'post_not_found' },
    });

    await expect(store.detachPostsFromWorkflow([10])).rejects.toMatchObject({ code: 'P0001' });
    expect(getCalls('rpc:detach_posts_from_flow', 'rpc')).toHaveLength(1);
  });

  it('movePostsToNewFlow calls the RPC with the batch, declared source and new-flow options', async () => {
    mockedSupabase.__queueSupabaseRpc('move_posts_to_new_flow', {
      data: { ok: true, moved: 2, target_workflow_id: 99, archived_workflow_ids: [] },
      error: null,
    });

    const result = await store.movePostsToNewFlow([10, 11], 5, {
      titulo: 'Fluxo (continuação)',
      startOrdem: 2,
    });

    expect(result).toEqual({
      ok: true,
      moved: 2,
      target_workflow_id: 99,
      archived_workflow_ids: [],
    });
    const call = getCalls('rpc:move_posts_to_new_flow', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_post_ids: [10, 11],
      p_source_workflow_id: 5,
      p_titulo: 'Fluxo (continuação)',
      p_start_ordem: 2,
      p_archive_empty_flow: false,
    });
  });

  it('movePostsToNewFlow forwards an explicit archiveEmptyFlow', async () => {
    mockedSupabase.__queueSupabaseRpc('move_posts_to_new_flow', {
      data: { ok: true, moved: 1, target_workflow_id: 99, archived_workflow_ids: [5] },
      error: null,
    });

    await store.movePostsToNewFlow([10], 5, {
      titulo: 'Fluxo (continuação)',
      startOrdem: 0,
      archiveEmptyFlow: true,
    });

    const call = getCalls('rpc:move_posts_to_new_flow', 'rpc').at(-1)!;
    expect(call.payload).toMatchObject({ p_archive_empty_flow: true });
  });

  it('movePostsToExistingFlow calls the RPC with the declared source and target', async () => {
    mockedSupabase.__queueSupabaseRpc('move_posts_to_existing_flow', {
      data: { ok: true, moved: 1, target_workflow_id: 8, archived_workflow_ids: [] },
      error: null,
    });

    const result = await store.movePostsToExistingFlow([10], 5, 8);

    expect(result).toEqual({
      ok: true,
      moved: 1,
      target_workflow_id: 8,
      archived_workflow_ids: [],
    });
    const call = getCalls('rpc:move_posts_to_existing_flow', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_post_ids: [10],
      p_source_workflow_id: 5,
      p_target_workflow_id: 8,
      p_archive_empty_flow: false,
    });
  });

  it('movePostsToNewFlow retries once on a 40P01 deadlock and succeeds', async () => {
    mockedSupabase.__queueSupabaseRpc(
      'move_posts_to_new_flow',
      { data: null, error: { code: '40P01', message: 'deadlock detected' } },
      {
        data: { ok: true, moved: 1, target_workflow_id: 99, archived_workflow_ids: [] },
        error: null,
      },
    );

    const result = await store.movePostsToNewFlow([10], 5, { titulo: 'X', startOrdem: 0 });

    expect(result).toMatchObject({ ok: true, target_workflow_id: 99 });
    expect(getCalls('rpc:move_posts_to_new_flow', 'rpc')).toHaveLength(2);
  });

  it('movePostsToExistingFlow retries once on a 40P01 deadlock and succeeds', async () => {
    mockedSupabase.__queueSupabaseRpc(
      'move_posts_to_existing_flow',
      { data: null, error: { code: '40P01', message: 'deadlock detected' } },
      {
        data: { ok: true, moved: 1, target_workflow_id: 8, archived_workflow_ids: [] },
        error: null,
      },
    );

    const result = await store.movePostsToExistingFlow([10], 5, 8);

    expect(result).toMatchObject({ ok: true, target_workflow_id: 8 });
    expect(getCalls('rpc:move_posts_to_existing_flow', 'rpc')).toHaveLength(2);
  });

  it('movePostsToNewFlow does not retry a non-deadlock error', async () => {
    mockedSupabase.__queueSupabaseRpc('move_posts_to_new_flow', {
      data: null,
      error: { code: 'P0001', message: 'post_not_in_source_flow' },
    });

    await expect(
      store.movePostsToNewFlow([10], 5, { titulo: 'X', startOrdem: 0 }),
    ).rejects.toMatchObject({ code: 'P0001' });
    expect(getCalls('rpc:move_posts_to_new_flow', 'rpc')).toHaveLength(1);
  });

  it('getActivePosts includes avulso posts (any status) merged with wired active-workflow posts', async () => {
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      {
        data: [
          {
            id: 1,
            workflow_id: 5,
            titulo: 'Post no fluxo',
            tipo: 'feed',
            status: 'aprovado_cliente',
            scheduled_at: '2026-06-16T17:00:00.000Z',
            ordem: 0,
            workflows: {
              titulo: 'Fluxo A',
              cliente_id: 7,
              status: 'ativo',
              clientes: { nome: 'Yasmin' },
            },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 2,
            workflow_id: null,
            cliente_id: 9,
            titulo: 'Post avulso postado',
            tipo: 'feed',
            status: 'postado',
            scheduled_at: null,
            ordem: 0,
            clientes: { nome: 'Beto' },
          },
        ],
        error: null,
      },
    );

    const result = await store.getActivePosts();

    expect(result).toHaveLength(2);
    const avulso = result.find((p) => p.id === 2)!;
    expect(avulso).toMatchObject({
      workflow_id: null,
      workflow_titulo: null,
      cliente_id: 9,
      cliente_nome: 'Beto',
      status: 'postado',
    });

    const calls = getCalls('workflow_posts', 'select');
    expect(calls).toHaveLength(2);
    expect(calls[1].modifiers).toContainEqual({ method: 'is', args: ['workflow_id', null] });
    // The avulso arm has no status filter -- "ativo" for an avulso post means
    // simply "exists", any status.
    expect(calls[1].modifiers).not.toContainEqual(
      expect.objectContaining({ method: 'eq', args: expect.arrayContaining(['status']) }),
    );
  });

  it('getActivePosts interleaves undated avulsos with undated wired posts by id (no kind segregation)', async () => {
    const wiredRow = (id: number) => ({
      id,
      workflow_id: 5,
      titulo: `Fluxo ${id}`,
      tipo: 'feed',
      status: 'rascunho',
      scheduled_at: null,
      ordem: 0,
      workflows: {
        titulo: 'Fluxo A',
        cliente_id: 7,
        status: 'ativo',
        clientes: { nome: 'Yasmin' },
      },
    });
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      { data: [wiredRow(1), wiredRow(30)], error: null },
      {
        data: [
          {
            id: 2,
            workflow_id: null,
            cliente_id: 9,
            titulo: 'Avulso antigo',
            tipo: 'feed',
            status: 'rascunho',
            scheduled_at: null,
            ordem: 0,
            clientes: { nome: 'Beto' },
          },
        ],
        error: null,
      },
    );

    const result = await store.getActivePosts();

    // Without the id tie-break the stable sort keeps concat order (1, 30, 2),
    // rendering every undated avulso below every undated wired post.
    expect(result.map((p) => p.id)).toEqual([1, 2, 30]);
  });

  it('getClientePosts filters the avulso arm by cliente_id and workflow_id null', async () => {
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      { data: [], error: null },
      {
        data: [
          {
            id: 3,
            workflow_id: null,
            titulo: 'Post avulso',
            tipo: 'feed',
            status: 'rascunho',
            scheduled_at: null,
            ordem: 0,
          },
        ],
        error: null,
      },
    );

    const result = await store.getClientePosts(9);

    expect(result).toEqual([
      {
        id: 3,
        workflow_id: null,
        titulo: 'Post avulso',
        tipo: 'feed',
        status: 'rascunho',
        custom_status_id: null,
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: null,
        platform: undefined,
        ig_trial_strategy: null,
      },
    ]);

    const calls = getCalls('workflow_posts', 'select');
    expect(calls[1].modifiers).toContainEqual({ method: 'eq', args: ['cliente_id', 9] });
    expect(calls[1].modifiers).toContainEqual({ method: 'is', args: ['workflow_id', null] });
  });

  it('getAssignedPendingPosts merges the wired arm with the avulso arm, sorted by created_at across both', async () => {
    // Two-query merge (Promise.all): the FIRST 'workflow_posts' select call is the
    // wired (workflows!inner) arm, the SECOND is the avulso (.is('workflow_id', null))
    // arm -- see the shared supabaseMock's per-table/operation FIFO queue.
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      {
        data: [
          {
            id: 1,
            workflow_id: 5,
            titulo: 'A',
            status: 'rascunho',
            custom_status_id: null,
            created_at: '2026-08-01T10:00:00Z',
            workflows: { titulo: 'Fluxo A', status: 'ativo', clientes: { nome: 'Yasmin' } },
          },
          {
            id: 2,
            workflow_id: 5,
            titulo: 'B',
            status: 'revisao_interna',
            custom_status_id: null,
            created_at: '2026-08-03T10:00:00Z',
            workflows: { titulo: 'Fluxo A', status: 'ativo', clientes: { nome: 'Yasmin' } },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 3,
            workflow_id: null,
            titulo: 'C avulso',
            status: 'correcao_cliente',
            custom_status_id: null,
            // Sits BETWEEN the two wired rows' created_at -- proves the merge
            // sort interleaves across arms instead of just concatenating them.
            created_at: '2026-08-02T10:00:00Z',
            clientes: { nome: 'Beto' },
          },
        ],
        error: null,
      },
    );

    const rows = await store.getAssignedPendingPosts(42);

    expect(rows.map((r) => r.id)).toEqual([1, 3, 2]);
    expect(rows).toEqual([
      {
        id: 1,
        workflow_id: 5,
        titulo: 'A',
        status: 'rascunho',
        custom_status_id: null,
        workflow_titulo: 'Fluxo A',
        cliente_nome: 'Yasmin',
      },
      {
        id: 3,
        workflow_id: null,
        titulo: 'C avulso',
        status: 'correcao_cliente',
        custom_status_id: null,
        workflow_titulo: null,
        cliente_nome: 'Beto',
      },
      {
        id: 2,
        workflow_id: 5,
        titulo: 'B',
        status: 'revisao_interna',
        custom_status_id: null,
        workflow_titulo: 'Fluxo A',
        cliente_nome: 'Yasmin',
      },
    ]);
    // created_at is selected only to drive the merge sort -- never part of the
    // returned AssignedPendingPost shape.
    for (const r of rows) expect(r).not.toHaveProperty('created_at');

    const calls = getCalls('workflow_posts', 'select');
    expect(calls).toHaveLength(2);
    const [wiredCall, avulsoCall] = calls;

    expect(wiredCall.modifiers).toContainEqual({
      method: 'eq',
      args: ['workflows.status', 'ativo'],
    });
    expect(wiredCall.modifiers).toContainEqual({ method: 'eq', args: ['responsavel_id', 42] });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'in',
      args: ['status', store.ASSIGNEE_PENDING_POST_STATUSES],
    });
    expect(wiredCall.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: true }],
    });

    expect(avulsoCall.modifiers).toContainEqual({ method: 'is', args: ['workflow_id', null] });
    expect(avulsoCall.modifiers).toContainEqual({ method: 'eq', args: ['responsavel_id', 42] });
    expect(avulsoCall.modifiers).toContainEqual({
      method: 'in',
      args: ['status', store.ASSIGNEE_PENDING_POST_STATUSES],
    });
    expect(avulsoCall.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: true }],
    });
    // No workflow-status gate on the avulso arm -- there is no workflow to be
    // "ativo" for a post with no workflow.
    expect(avulsoCall.modifiers).not.toContainEqual(
      expect.objectContaining({ method: 'eq', args: expect.arrayContaining(['workflows.status']) }),
    );
  });
});
