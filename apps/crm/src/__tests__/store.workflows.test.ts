import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('store workflow and portal functions', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it.each([
    {
      name: 'getWorkflowTemplates',
      table: 'workflow_templates',
      operation: 'select' as const,
      run: () => store.getWorkflowTemplates(),
      response: [{ id: 1, nome: 'Social Mensal' }],
      modifier: { method: 'order', args: ['created_at', { ascending: false }] },
    },
    {
      name: 'addWorkflowTemplate',
      table: 'workflow_templates',
      operation: 'insert' as const,
      run: () => store.addWorkflowTemplate({
        nome: 'Social Mensal',
        etapas: [{ nome: 'Briefing', prazo_dias: 2, tipo_prazo: 'uteis' }],
      }),
      response: { id: 1, nome: 'Social Mensal' },
      payload: {
        nome: 'Social Mensal',
        etapas: [{ nome: 'Briefing', prazo_dias: 2, tipo_prazo: 'uteis' }],
        user_id: 'user-1',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'updateWorkflowTemplate',
      table: 'workflow_templates',
      operation: 'update' as const,
      run: () => store.updateWorkflowTemplate(1, { nome: 'Social Quinzenal' }),
      response: { id: 1, nome: 'Social Quinzenal' },
      payload: { nome: 'Social Quinzenal' },
      modifier: { method: 'eq', args: ['id', 1] },
    },
    {
      name: 'removeWorkflowTemplate',
      table: 'workflow_templates',
      operation: 'delete' as const,
      run: () => store.removeWorkflowTemplate(1),
      response: null,
      modifier: { method: 'eq', args: ['id', 1] },
    },
  ])('$name issues the expected workflow template query', async ({ table, operation, run, response, payload, modifier }) => {
    mockedSupabase.__queueSupabaseResult(table, operation, { data: response, error: null });

    await run();

    const call = getCalls(table, operation).at(-1)!;
    expect(call).toBeDefined();
    if (payload) expect(call.payload).toEqual(payload);
    if (modifier) expect(call.modifiers).toContainEqual(modifier);
  });

  it('propagates pending template steps to active workflows only', async () => {
    mockedSupabase.__queueSupabaseResult('workflows', 'select', {
      data: [{ id: 10 }, { id: 11 }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select',
      {
        data: [
          { id: 101, ordem: 0, status: 'pendente' },
          { id: 102, ordem: 1, status: 'concluido' },
        ],
        error: null,
      },
      {
        data: [
          { id: 111, ordem: 0, status: 'pendente' },
        ],
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'update',
      { data: null, error: null },
      { data: null, error: null },
    );

    await store.propagateTemplateToWorkflows(5, [
      { nome: 'Briefing atualizado', prazo_dias: 3, tipo_prazo: 'uteis', tipo: 'padrao' },
      { nome: 'Publicação', prazo_dias: 5, tipo_prazo: 'corridos', tipo: 'padrao' },
    ]);

    const updates = getCalls('workflow_etapas', 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0].payload).toMatchObject({ nome: 'Briefing atualizado', prazo_dias: 3 });
    expect(updates[1].payload).toMatchObject({ nome: 'Briefing atualizado', prazo_dias: 3 });
  });

  it('completes a step and activates the next workflow stage', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'update',
      { data: { id: 501, status: 'concluido' }, error: null },
      { data: { id: 502, status: 'ativo' }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select',
      {
        data: [
          { id: 501, ordem: 0, status: 'pendente' },
          { id: 502, ordem: 1, status: 'pendente' },
        ],
        error: null,
      },
      {
        data: [
          { id: 501, ordem: 0, status: 'concluido' },
          { id: 502, ordem: 1, status: 'ativo' },
        ],
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('workflows', 'update', {
      data: { id: 40, etapa_atual: 1, status: 'ativo' },
      error: null,
    });

    const result = await store.completeEtapa(40, 501);

    expect(result.workflow).toMatchObject({ id: 40, etapa_atual: 1, status: 'ativo' });
    expect(result.etapas).toEqual([
      { id: 501, ordem: 0, status: 'concluido' },
      { id: 502, ordem: 1, status: 'ativo' },
    ]);
  });

  it('reverts the active step back to the previous stage', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select',
      {
        data: [
          { id: 601, ordem: 0, status: 'concluido' },
          { id: 602, ordem: 1, status: 'ativo' },
        ],
        error: null,
      },
      {
        data: [
          { id: 601, ordem: 0, status: 'ativo' },
          { id: 602, ordem: 1, status: 'pendente' },
        ],
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'update',
      { data: { id: 602, status: 'pendente' }, error: null },
      { data: { id: 601, status: 'ativo' }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('workflows', 'update', {
      data: { id: 55, etapa_atual: 0, status: 'ativo' },
      error: null,
    });

    const result = await store.revertEtapa(55);

    expect(result.workflow).toMatchObject({ etapa_atual: 0 });
    expect(result.etapas[0].status).toBe('ativo');
    expect(result.etapas[1].status).toBe('pendente');
  });

  it('creates a portal token only once and reuses existing shares', async () => {
    mockedSupabase.__queueSupabaseResult('portal_tokens', 'select', {
      data: { token: 'portal-existente' },
      error: null,
    });

    await expect(store.createPortalToken(77)).resolves.toBe('portal-existente');

    mockedSupabase.__queueSupabaseResult('portal_tokens', 'select', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('portal_tokens', 'insert', {
      data: { token: 'portal-novo' },
      error: null,
    });

    await expect(store.createPortalToken(78)).resolves.toBe('portal-novo');
    expect(getCalls('portal_tokens', 'insert').at(-1)?.payload).toEqual({
      workflow_id: 78,
      conta_id: 'conta-1',
    });
  });

  it('maps workflow posts with nested property definitions', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        {
          id: 1,
          titulo: 'Post de Lançamento',
          post_property_values: [
            {
              id: 99,
              property_definition_id: 7,
              value: 'https://www.notion.so/lancamento',
              template_property_definitions: {
                id: 7,
                name: 'Link de apoio',
                type: 'url',
              },
            },
          ],
        },
      ],
      error: null,
    });

    const posts = await store.getWorkflowPostsWithProperties(14);

    expect(posts[0].property_values[0]).toEqual({
      id: 99,
      post_id: 1,
      property_definition_id: 7,
      value: 'https://www.notion.so/lancamento',
      definition: {
        id: 7,
        name: 'Link de apoio',
        type: 'url',
      },
    });
  });

  it('supports workflow post, property definition, and select option mutations', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'insert', {
      data: { id: 9, titulo: 'Carrossel Abril' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update',
      { data: { id: 9, titulo: 'Carrossel Abril V2' }, error: null },
      { data: null, error: null },
      { data: { id: 9, is_cover: true }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'insert', {
      data: { id: 3, name: 'CTA' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'update', {
      data: { id: 3, name: 'CTA principal' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_property_values', 'upsert', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_select_options', 'insert', {
      data: { id: 4, label: 'Stories' },
      error: null,
    });

    await expect(store.addWorkflowPost({
      workflow_id: 2,
      titulo: 'Carrossel Abril',
      conteudo: null,
      conteudo_plain: 'Legenda',
      tipo: 'carrossel',
      ordem: 0,
      status: 'rascunho',
    })).resolves.toMatchObject({ id: 9 });

    await expect(store.updateWorkflowPost(9, { titulo: 'Carrossel Abril V2' })).resolves.toMatchObject({
      titulo: 'Carrossel Abril V2',
    });
    await expect(store.sendPostsToCliente(2)).resolves.toBeUndefined();

    await expect(store.createPropertyDefinition(8, {
      name: 'CTA',
      type: 'text',
      config: {},
      portal_visible: true,
      display_order: 0,
    })).resolves.toMatchObject({ id: 3 });

    await expect(store.updatePropertyDefinition(3, { name: 'CTA principal' })).resolves.toMatchObject({
      name: 'CTA principal',
    });
    await expect(store.upsertPostPropertyValue(9, 3, 'Fale conosco no WhatsApp')).resolves.toBeUndefined();
    await expect(store.createWorkflowSelectOption(2, 3, 'Stories', '#06b6d4')).resolves.toMatchObject({
      label: 'Stories',
    });

    expect(getCalls('workflow_posts', 'insert').at(-1)?.payload).toMatchObject({
      workflow_id: 2,
      conta_id: 'conta-1',
    });
    expect(getCalls('post_property_values', 'upsert').at(-1)?.payload).toMatchObject({
      post_id: 9,
      property_definition_id: 3,
      value: 'Fale conosco no WhatsApp',
      updated_at: expect.any(String),
    });
  });

  it('inserts workspace replies for portal and post approvals', async () => {
    mockedSupabase.__queueSupabaseResult('portal_tokens', 'select',
      { data: { token: 'portal-123' }, error: null },
      { data: { token: 'portal-123' }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('portal_approvals', 'insert', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_approvals', 'insert', {
      data: null,
      error: null,
    });

    await store.replyToPortalApproval(20, 7, 'Ajustar a headline com foco em conversão.');
    await store.replyToPostApproval(55, 20, 'Trocar a imagem principal por uma versão com logo.');

    expect(getCalls('portal_approvals', 'insert').at(-1)?.payload).toEqual({
      workflow_etapa_id: 7,
      token: 'portal-123',
      action: 'mensagem',
      comentario: 'Ajustar a headline com foco em conversão.',
      is_workspace_user: true,
    });
    expect(getCalls('post_approvals', 'insert').at(-1)?.payload).toEqual({
      post_id: 55,
      token: 'portal-123',
      action: 'mensagem',
      comentario: 'Trocar a imagem principal por uma versão com logo.',
      is_workspace_user: true,
    });
  });

  it('replyToPostApproval works without portal token', async () => {
    mockedSupabase.__queueSupabaseResult('portal_tokens', 'select', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_approvals', 'insert', {
      data: null,
      error: null,
    });

    await expect(store.replyToPostApproval(1, 2, 'mensagem')).resolves.not.toThrow();
  });
});

describe('getDeadlineInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns prazo_dias unchanged when the step is not active', () => {
    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 5,
      tipo_prazo: 'corridos',
      status: 'pendente',
      iniciado_em: null,
    } as never);

    expect(result).toEqual({ diasRestantes: 5, horasRestantes: 0, estourado: false, urgente: false });
  });

  it('returns prazo_dias unchanged when iniciado_em is missing on an active step', () => {
    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 3,
      tipo_prazo: 'corridos',
      status: 'ativo',
      iniciado_em: null,
    } as never);

    expect(result.diasRestantes).toBe(3);
    expect(result.estourado).toBe(false);
  });

  it('uses calendar time for tipo_prazo=corridos', () => {
    // 5 days deadline, 2 calendar days elapsed → 3 days left
    vi.setSystemTime(new Date('2026-04-10T12:00:00.000Z'));

    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 5,
      tipo_prazo: 'corridos',
      status: 'ativo',
      iniciado_em: '2026-04-08T12:00:00.000Z',
    } as never);

    expect(result.diasRestantes).toBe(3);
    expect(result.estourado).toBe(false);
    expect(result.urgente).toBe(false);
  });

  it('skips weekends when tipo_prazo=uteis', () => {
    // Start Fri 2026-04-10 12:00, now Mon 2026-04-13 12:00.
    // Calendar elapsed = 3 days, but business days elapsed = 1 (only Monday counted — Sat/Sun skipped).
    // So with prazo=5 uteis → 5 - 1 = 4 days remaining.
    vi.setSystemTime(new Date('2026-04-13T12:00:00.000Z'));

    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 5,
      tipo_prazo: 'uteis',
      status: 'ativo',
      iniciado_em: '2026-04-10T12:00:00.000Z',
    } as never);

    expect(result.diasRestantes).toBe(4);
    expect(result.estourado).toBe(false);
  });

  it('marks estourado=true when deadline has passed', () => {
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));

    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      status: 'ativo',
      iniciado_em: '2026-04-10T12:00:00.000Z',
    } as never);

    expect(result.estourado).toBe(true);
    expect(result.urgente).toBe(false);
  });

  it('marks urgente=true when 24h or less remain and not yet overdue', () => {
    // 2-day deadline (48h), 36h elapsed → 12h remaining, inside the 24h window.
    vi.setSystemTime(new Date('2026-04-11T12:00:00.000Z'));

    const result = store.getDeadlineInfo({
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      status: 'ativo',
      iniciado_em: '2026-04-10T00:00:00.000Z',
    } as never);

    expect(result.urgente).toBe(true);
    expect(result.estourado).toBe(false);
  });
});

describe('getWorkflowPostsCounts', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('returns an empty Map when given no workflow ids (no DB round-trip)', async () => {
    const result = await store.getWorkflowPostsCounts([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(getCalls('workflow_posts', 'select')).toHaveLength(0);
  });

  it('aggregates rows into a Map keyed by workflow_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { workflow_id: 10 },
        { workflow_id: 10 },
        { workflow_id: 10 },
        { workflow_id: 20 },
      ],
      error: null,
    });

    const result = await store.getWorkflowPostsCounts([10, 20, 30]);

    expect(result.get(10)).toBe(3);
    expect(result.get(20)).toBe(1);
    expect(result.get(30)).toBeUndefined();

    const calls = getCalls('workflow_posts', 'select');
    expect(calls).toHaveLength(1);
    expect(calls[0].selectArgs).toEqual(expect.arrayContaining([['workflow_id']]));
    expect(calls[0].modifiers).toEqual(
      expect.arrayContaining([
        { method: 'in', args: ['workflow_id', [10, 20, 30]] },
      ]),
    );
  });

  it('throws when Supabase returns an error', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(store.getWorkflowPostsCounts([1])).rejects.toBeTruthy();
  });
});
