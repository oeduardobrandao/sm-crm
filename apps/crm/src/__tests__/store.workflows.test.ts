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
});
