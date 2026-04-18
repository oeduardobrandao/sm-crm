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

function getLastCall(table: string) {
  const call = mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table).at(-1);
  expect(call).toBeDefined();
  return call!;
}

describe('store core helpers and CRUD', () => {
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

  it('formats money according to the current role', () => {
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'agent',
      conta_id: 'conta-1',
    });

    return store.initStoreRole().then(async () => {
      expect(store.formatBRL(1490)).toBe('R$ •••••');

      mockedSupabase.__setCurrentProfile({
        id: 'user-1',
        nome: 'Eduardo Souza',
        role: 'admin',
        conta_id: 'conta-1',
      });
      await store.initStoreRole();

      expect(store.formatBRL(1490)).toContain('R$');
      expect(store.getInitials('Joana Lima')).toBe('JL');
    });
  });

  it('flattens workspace users from the joined Supabase shape', async () => {
    mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
      data: [
        {
          user_id: 'user-2',
          role: 'admin',
          joined_at: '2026-04-01T10:00:00.000Z',
          profiles: {
            id: 'user-2',
            nome: 'Mariana Freitas',
            avatar_url: 'https://cdn.mesaas.com/mariana.jpg',
            created_at: '2026-03-01T10:00:00.000Z',
          },
        },
      ],
      error: null,
    });

    const users = await store.getWorkspaceUsers();

    expect(users).toEqual([
      {
        id: 'user-2',
        nome: 'Mariana Freitas',
        role: 'admin',
        avatar_url: 'https://cdn.mesaas.com/mariana.jpg',
        created_at: '2026-03-01T10:00:00.000Z',
      },
    ]);
    expect(getLastCall('workspace_members').modifiers).toContainEqual({
      method: 'eq',
      args: ['workspace_id', 'conta-1'],
    });
  });

  it('returns an empty workspace list when there is no authenticated user', async () => {
    mockedSupabase.__setCurrentUser(null);

    await expect(store.getMyWorkspaces()).resolves.toEqual([]);
  });

  it('updates the active workspace and clears the cached profile', async () => {
    mockedSupabase.__queueSupabaseResult('profiles', 'update', {
      data: null,
      error: null,
    });

    await store.switchWorkspace('conta-9');

    expect(getLastCall('profiles')).toMatchObject({
      operation: 'update',
      payload: { active_workspace_id: 'conta-9', conta_id: 'conta-9' },
    });
    await expect(supabaseModule.getCurrentProfile()).resolves.toBeNull();
  });

  it('calls the workspace management edge function with the current access token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await store.updateWorkspaceUserRole('user-44', 'admin');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toContain('/functions/v1/manage-workspace-user');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-de-teste',
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: 'update-role',
      targetUserId: 'user-44',
      role: 'admin',
    });
  });

  it('maps legacy transaction rows without status to pago', async () => {
    mockedSupabase.__queueSupabaseResult('transacoes', 'select', {
      data: [
        { id: 1, descricao: 'Mensalidade Clínica Aurora', status: null },
      ],
      error: null,
    });

    await expect(store.getTransacoes()).resolves.toEqual([
      { id: 1, descricao: 'Mensalidade Clínica Aurora', status: 'pago' },
    ]);
  });

  it('projects scheduled transactions only when they are still missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
    try {
      const projected = store.projetarAgendamentos(
        [{ referencia_agendamento: 'cliente_1_2026_04' } as store.Transacao],
        [
          {
            id: 1,
            nome: 'Clínica Aurora',
            status: 'ativo',
            data_pagamento: 10,
            valor_mensal: 3200,
          } as store.Cliente,
        ],
        [
          {
            id: 2,
            nome: 'Paulo Editor',
            data_pagamento: 20,
            custo_mensal: 900,
          } as store.Membro,
        ],
      );

      expect(projected.some((item) => item.referencia_agendamento?.startsWith('membro_2_'))).toBe(true);
      expect(projected.some((item) => item.referencia_agendamento === 'cliente_1_2026_04')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: 'getClientes',
      operation: 'select' as const,
      table: 'clientes',
      run: () => store.getClientes(),
      response: [{ id: 1, nome: 'Clínica Aurora' }],
      expected: [{ id: 1, nome: 'Clínica Aurora' }],
      modifiers: [{ method: 'order', args: ['created_at', { ascending: false }] }],
    },
    {
      name: 'getClienteEnderecos',
      operation: 'select' as const,
      table: 'cliente_enderecos',
      run: () => store.getClienteEnderecos(12),
      response: [{ id: 1, cidade: 'Fortaleza' }],
      expected: [{ id: 1, cidade: 'Fortaleza' }],
      modifiers: [
        { method: 'eq', args: ['cliente_id', 12] },
        { method: 'order', args: ['created_at', { ascending: false }] },
      ],
    },
    {
      name: 'getClienteDatas',
      operation: 'select' as const,
      table: 'cliente_datas',
      run: () => store.getClienteDatas(12),
      response: [{ id: 1, titulo: 'Reunião estratégica' }],
      expected: [{ id: 1, titulo: 'Reunião estratégica' }],
      modifiers: [
        { method: 'eq', args: ['cliente_id', 12] },
        { method: 'order', args: ['data', { ascending: true }] },
      ],
    },
    {
      name: 'getAllClienteDatas',
      operation: 'select' as const,
      table: 'cliente_datas',
      run: () => store.getAllClienteDatas(),
      response: [{ id: 2, titulo: 'Entrega de campanha' }],
      expected: [{ id: 2, titulo: 'Entrega de campanha' }],
      modifiers: [{ method: 'order', args: ['data', { ascending: true }] }],
    },
    {
      name: 'getContratos',
      operation: 'select' as const,
      table: 'contratos',
      run: () => store.getContratos(),
      response: [{ id: 1, titulo: 'Plano Trimestral' }],
      expected: [{ id: 1, titulo: 'Plano Trimestral' }],
      modifiers: [{ method: 'order', args: ['created_at', { ascending: false }] }],
    },
    {
      name: 'getMembros',
      operation: 'select' as const,
      table: 'membros',
      run: () => store.getMembros(),
      response: [{ id: 1, nome: 'Paulo Editor' }],
      expected: [{ id: 1, nome: 'Paulo Editor' }],
      modifiers: [{ method: 'order', args: ['created_at', { ascending: false }] }],
    },
    {
      name: 'getLeads',
      operation: 'select' as const,
      table: 'leads',
      run: () => store.getLeads(),
      response: [{ id: 1, nome: 'Ana Fisioterapia' }],
      expected: [{ id: 1, nome: 'Ana Fisioterapia' }],
      modifiers: [{ method: 'order', args: ['created_at', { ascending: false }] }],
    },
  ])('$name issues the expected select query', async ({ table, operation, run, response, expected, modifiers }) => {
    mockedSupabase.__queueSupabaseResult(table, operation, { data: response, error: null });

    await expect(run()).resolves.toEqual(expected);

    const call = getLastCall(table);
    expect(call.operation).toBe(operation);
    for (const modifier of modifiers) {
      expect(call.modifiers).toContainEqual(modifier);
    }
  });

  it.each([
    {
      name: 'addCliente',
      table: 'clientes',
      run: () => store.addCliente({
        nome: 'Clínica Aurora',
        sigla: 'CA',
        cor: '#db2777',
        plano: 'Premium',
        email: 'contato@aurora.com.br',
        telefone: '(85) 99999-0000',
        status: 'ativo',
        valor_mensal: 3200,
      }),
      payload: {
        nome: 'Clínica Aurora',
        sigla: 'CA',
        cor: '#db2777',
        plano: 'Premium',
        email: 'contato@aurora.com.br',
        telefone: '(85) 99999-0000',
        status: 'ativo',
        valor_mensal: 3200,
        user_id: 'user-1',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'addClienteEndereco',
      table: 'cliente_enderecos',
      run: () => store.addClienteEndereco({
        cliente_id: 12,
        tipo: 'comercial',
        logradouro: 'Rua das Flores',
        numero: '123',
        bairro: 'Aldeota',
        cidade: 'Fortaleza',
        estado: 'CE',
        cep: '60150-160',
      }),
      payload: {
        cliente_id: 12,
        tipo: 'comercial',
        logradouro: 'Rua das Flores',
        numero: '123',
        bairro: 'Aldeota',
        cidade: 'Fortaleza',
        estado: 'CE',
        cep: '60150-160',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'addClienteData',
      table: 'cliente_datas',
      run: () => store.addClienteData({
        cliente_id: 12,
        titulo: 'Aniversário da marca',
        data: '2026-06-14',
      }),
      payload: {
        cliente_id: 12,
        titulo: 'Aniversário da marca',
        data: '2026-06-14',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'addTransacao',
      table: 'transacoes',
      run: () => store.addTransacao({
        data: '2026-04-18',
        descricao: 'Mensalidade Clínica Aurora',
        detalhe: 'Plano Premium',
        categoria: 'Receita',
        tipo: 'entrada',
        valor: 3200,
      }),
      payload: {
        data: '2026-04-18',
        descricao: 'Mensalidade Clínica Aurora',
        detalhe: 'Plano Premium',
        categoria: 'Receita',
        tipo: 'entrada',
        valor: 3200,
        user_id: 'user-1',
        conta_id: 'conta-1',
        status: 'pago',
        referencia_agendamento: null,
      },
    },
    {
      name: 'addContrato',
      table: 'contratos',
      run: () => store.addContrato({
        cliente_nome: 'Clínica Aurora',
        titulo: 'Plano Trimestral',
        data_inicio: '2026-04-01',
        data_fim: '2026-06-30',
        status: 'vigente',
        valor_total: 9600,
      }),
      payload: {
        cliente_nome: 'Clínica Aurora',
        titulo: 'Plano Trimestral',
        data_inicio: '2026-04-01',
        data_fim: '2026-06-30',
        status: 'vigente',
        valor_total: 9600,
        user_id: 'user-1',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'addMembro',
      table: 'membros',
      run: () => store.addMembro({
        nome: 'Paulo Editor',
        cargo: 'Editor',
        tipo: 'freelancer_mensal',
        custo_mensal: 900,
        avatar_url: 'https://cdn.mesaas.com/paulo.jpg',
      }),
      payload: {
        nome: 'Paulo Editor',
        cargo: 'Editor',
        tipo: 'freelancer_mensal',
        custo_mensal: 900,
        avatar_url: 'https://cdn.mesaas.com/paulo.jpg',
        user_id: 'user-1',
        conta_id: 'conta-1',
      },
    },
    {
      name: 'addLead',
      table: 'leads',
      run: () => store.addLead({
        nome: 'Ana Fisioterapia',
        email: 'ana@fisio.com.br',
        telefone: '(85) 98888-1111',
        instagram: '@anafisio',
        canal: 'instagram',
        origem: 'manual',
        status: 'novo',
        notas: 'Veio por indicação',
        especialidade: 'Fisioterapia',
        faturamento: '20k-50k',
        objetivo: 'Gerar leads',
        tags: 'saude,clinica',
      }),
      payload: {
        nome: 'Ana Fisioterapia',
        email: 'ana@fisio.com.br',
        telefone: '(85) 98888-1111',
        instagram: '@anafisio',
        canal: 'instagram',
        origem: 'manual',
        status: 'novo',
        notas: 'Veio por indicação',
        especialidade: 'Fisioterapia',
        faturamento: '20k-50k',
        objetivo: 'Gerar leads',
        tags: 'saude,clinica',
        user_id: 'user-1',
        conta_id: 'conta-1',
      },
    },
  ])('$name inserts with the authenticated workspace context', async ({ table, run, payload }) => {
    mockedSupabase.__queueSupabaseResult(table, 'insert', { data: { id: 1, ...payload }, error: null });

    await expect(run()).resolves.toMatchObject({ id: 1, ...payload });

    expect(getLastCall(table)).toMatchObject({
      operation: 'insert',
      payload,
    });
  });

  it.each([
    {
      name: 'updateCliente',
      table: 'clientes',
      run: () => store.updateCliente(7, { nome: 'Clínica Aurora Premium' }),
      payload: { nome: 'Clínica Aurora Premium' },
      eq: ['id', 7],
    },
    {
      name: 'updateClienteEndereco',
      table: 'cliente_enderecos',
      run: () => store.updateClienteEndereco(9, { bairro: 'Meireles' }),
      payloadMatcher: { bairro: 'Meireles', updated_at: expect.any(String) },
      eq: ['id', 9],
    },
    {
      name: 'updateClienteData',
      table: 'cliente_datas',
      run: () => store.updateClienteData(3, { titulo: 'Reunião de pauta' }),
      payload: { titulo: 'Reunião de pauta' },
      eq: ['id', 3],
    },
    {
      name: 'updateTransacao',
      table: 'transacoes',
      run: () => store.updateTransacao(4, { status: 'agendado' }),
      payload: { status: 'agendado' },
      eq: ['id', 4],
    },
    {
      name: 'updateContrato',
      table: 'contratos',
      run: () => store.updateContrato(5, { status: 'encerrado' }),
      payload: { status: 'encerrado' },
      eq: ['id', 5],
    },
    {
      name: 'updateMembro',
      table: 'membros',
      run: () => store.updateMembro(8, { cargo: 'Videomaker' }),
      payload: { cargo: 'Videomaker' },
      eq: ['id', 8],
    },
    {
      name: 'updateLead',
      table: 'leads',
      run: () => store.updateLead(11, { status: 'qualificado' }),
      payload: { status: 'qualificado' },
      eq: ['id', 11],
    },
  ])('$name updates the target row', async ({ table, run, payload, payloadMatcher, eq }) => {
    mockedSupabase.__queueSupabaseResult(table, 'update', {
      data: { id: eq[1], ...(payload ?? payloadMatcher) },
      error: null,
    });

    await run();

    const call = getLastCall(table);
    expect(call.operation).toBe('update');
    expect(call.payload).toEqual(payload ?? payloadMatcher);
    expect(call.modifiers).toContainEqual({ method: 'eq', args: eq });
  });

  it.each([
    { name: 'removeCliente', table: 'clientes', run: () => store.removeCliente(7), eq: ['id', 7] },
    { name: 'removeClienteEndereco', table: 'cliente_enderecos', run: () => store.removeClienteEndereco(9), eq: ['id', 9] },
    { name: 'removeClienteData', table: 'cliente_datas', run: () => store.removeClienteData(3), eq: ['id', 3] },
    { name: 'removeTransacao', table: 'transacoes', run: () => store.removeTransacao(4), eq: ['id', 4] },
    { name: 'removeContrato', table: 'contratos', run: () => store.removeContrato(5), eq: ['id', 5] },
    { name: 'removeMembro', table: 'membros', run: () => store.removeMembro(8), eq: ['id', 8] },
    { name: 'removeLead', table: 'leads', run: () => store.removeLead(11), eq: ['id', 11] },
  ])('$name deletes the requested row', async ({ table, run, eq }) => {
    mockedSupabase.__queueSupabaseResult(table, 'delete', { data: null, error: null });

    await expect(run()).resolves.toBeUndefined();

    const call = getLastCall(table);
    expect(call.operation).toBe('delete');
    expect(call.modifiers).toContainEqual({ method: 'eq', args: eq });
  });
});
