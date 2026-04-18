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

describe('store hub and ideias helpers', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('manages client hub tokens', async () => {
    mockedSupabase.__queueSupabaseResult('client_hub_tokens', 'select', {
      data: { id: 'token-id', token: 'hub-token', is_active: true },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('client_hub_tokens', 'insert', {
      data: { id: 'token-new', token: 'hub-new', is_active: true },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('client_hub_tokens', 'update', {
      data: null,
      error: null,
    });

    await expect(store.getHubToken(14)).resolves.toEqual({
      id: 'token-id',
      token: 'hub-token',
      is_active: true,
    });
    await expect(store.createHubToken(14, 'conta-1')).resolves.toEqual({
      id: 'token-new',
      token: 'hub-new',
      is_active: true,
    });
    await expect(store.setHubTokenActive('token-new', false)).resolves.toBeUndefined();

    expect(getCalls('client_hub_tokens', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      conta_id: 'conta-1',
    });
    expect(getCalls('client_hub_tokens', 'update').at(-1)?.payload).toEqual({ is_active: false });
  });

  it('loads and mutates hub brand assets', async () => {
    mockedSupabase.__queueSupabaseResult('hub_brand', 'select', {
      data: { cliente_id: 14, primary_color: '#0f766e' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('hub_brand_files', 'select', {
      data: [{ id: 'f1', name: 'Manual da Marca', display_order: 0 }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('hub_brand', 'upsert', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('hub_brand_files', 'insert', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('hub_brand_files', 'delete', { data: null, error: null });

    await expect(store.getHubBrand(14)).resolves.toEqual({
      brand: { cliente_id: 14, primary_color: '#0f766e' },
      files: [{ id: 'f1', name: 'Manual da Marca', display_order: 0 }],
    });

    await store.upsertHubBrand(14, { primary_color: '#1d4ed8', font_primary: 'DM Sans' });
    await store.addHubBrandFile(14, 'Guia de Voz', 'https://cdn.mesaas.com/guia.pdf', 'pdf', 1);
    await store.removeHubBrandFile('f1');

    expect(getCalls('hub_brand', 'upsert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      primary_color: '#1d4ed8',
      font_primary: 'DM Sans',
    });
    expect(getCalls('hub_brand_files', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      name: 'Guia de Voz',
      file_url: 'https://cdn.mesaas.com/guia.pdf',
      file_type: 'pdf',
      display_order: 1,
    });
  });

  it('upserts hub pages and resolves the workspace slug', async () => {
    mockedSupabase.__queueSupabaseResult('hub_pages', 'select', {
      data: [{ id: 'page-1', title: 'Boas-vindas', display_order: 0 }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('hub_pages', 'update', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('hub_pages', 'insert', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('hub_pages', 'delete', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'mesaas' },
      error: null,
    });

    await expect(store.getHubPages(14)).resolves.toEqual([{ id: 'page-1', title: 'Boas-vindas', display_order: 0 }]);
    await store.upsertHubPage({
      id: 'page-1',
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Boas-vindas',
      content: [],
      display_order: 0,
      created_at: '2026-04-01T00:00:00.000Z',
    });
    await store.upsertHubPage({
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Resultados',
      content: [],
      display_order: 1,
    });
    await store.removeHubPage('page-1');

    await expect(store.getWorkspaceSlug()).resolves.toBe('mesaas');
    expect(getCalls('hub_pages', 'update').at(-1)?.modifiers).toContainEqual({
      method: 'eq',
      args: ['id', 'page-1'],
    });
    expect(getCalls('hub_pages', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Resultados',
      content: [],
      display_order: 1,
    });
  });

  it('handles hub briefing CRUD with display-order sequencing', async () => {
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'select',
      {
        data: [{ id: 'q1', question: 'Quais metas vocês têm?', display_order: 0 }],
        error: null,
      },
      {
        data: { display_order: 3 },
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'insert', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'update',
      { data: null, error: null },
      { data: null, error: null },
    );
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'delete', { data: null, error: null });

    await expect(store.getHubBriefingQuestions(14)).resolves.toEqual([
      { id: 'q1', question: 'Quais metas vocês têm?', display_order: 0 },
    ]);
    await store.addHubBriefingQuestion(14, 'conta-1', 'Qual é a persona principal?', 'Estratégia');
    await store.updateHubBriefingQuestionSection('q1', 'Mídia paga');
    await store.updateHubBriefingQuestion('q1', 'Qual é o orçamento mensal?');
    await store.deleteHubBriefingQuestion('q1');

    expect(getCalls('hub_briefing_questions', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      conta_id: 'conta-1',
      question: 'Qual é a persona principal?',
      display_order: 4,
      section: 'Estratégia',
      answer: null,
    });
    expect(getCalls('hub_briefing_questions', 'update')[0].payload).toEqual({ section: 'Mídia paga' });
    expect(getCalls('hub_briefing_questions', 'update')[1].payload).toEqual({ question: 'Qual é o orçamento mensal?' });
  });

  it('filters ideias, updates comments, and toggles reactions on and off', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'select', {
      data: [{ id: 'ideia-1', titulo: 'Campanha de Inverno' }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('ideias', 'update',
      { data: null, error: null },
      { data: null, error: null },
    );
    mockedSupabase.__queueSupabaseResult('ideia_reactions', 'select',
      { data: null, error: null },
      { data: { id: 'react-1' }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('ideia_reactions', 'insert', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('ideia_reactions', 'delete', { data: null, error: null });

    await expect(store.getIdeias({ cliente_id: 14 })).resolves.toEqual([
      { id: 'ideia-1', titulo: 'Campanha de Inverno' },
    ]);
    await store.updateIdeiaStatus('ideia-1', 'em_analise');
    await store.upsertIdeiaComentario('ideia-1', 'Boa base, mas vamos reforçar a oferta.', 7);
    await store.toggleIdeiaReaction('ideia-1', 7, '🔥');
    await store.toggleIdeiaReaction('ideia-1', 7, '🔥');

    const ideiasCall = getCalls('ideias', 'select').at(-1)!;
    expect(ideiasCall.modifiers).toContainEqual({ method: 'eq', args: ['cliente_id', 14] });
    expect(getCalls('ideias', 'update')[0].payload).toEqual({ status: 'em_analise' });
    expect(getCalls('ideias', 'update')[1].payload).toEqual({
      comentario_agencia: 'Boa base, mas vamos reforçar a oferta.',
      comentario_autor_id: 7,
      comentario_at: expect.any(String),
    });
    expect(getCalls('ideia_reactions', 'insert').at(-1)?.payload).toEqual({
      ideia_id: 'ideia-1',
      membro_id: 7,
      emoji: '🔥',
    });
    expect(getCalls('ideia_reactions', 'delete').at(-1)?.modifiers).toContainEqual({
      method: 'eq',
      args: ['id', 'react-1'],
    });
  });
});
