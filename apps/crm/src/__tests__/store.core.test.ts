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
  __setCurrentUser: (user: { id: string } | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getLastCall(table: string) {
  const call = mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table)
    .at(-1);
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

  it('builds initials from a name', () => {
    expect(store.getInitials('Joana Lima')).toBe('JL');
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
        // No role_id/workspace_roles in the mocked row (legacy member,
        // matches the pre-Task-13 shape) -- both flatten to null.
        role_id: null,
        papel_nome: null,
        avatar_url: 'https://cdn.mesaas.com/mariana.jpg',
        created_at: '2026-03-01T10:00:00.000Z',
      },
    ]);
    expect(getLastCall('workspace_members').modifiers).toContainEqual({
      method: 'eq',
      args: ['workspace_id', 'conta-1'],
    });
  });

  it('flattens role_id and the embedded workspace_roles.nome as papel_nome for a member with a custom papel', async () => {
    mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
      data: [
        {
          user_id: 'user-3',
          role: 'agent',
          role_id: 'role-1',
          joined_at: '2026-04-02T10:00:00.000Z',
          can_see_financials: false,
          workspace_roles: { nome: 'Editor de Conteúdo' },
          profiles: {
            id: 'user-3',
            nome: 'Carla Editora',
            avatar_url: null,
            created_at: '2026-03-02T10:00:00.000Z',
          },
        },
      ],
      error: null,
    });

    const users = await store.getWorkspaceUsers();

    expect(users).toEqual([
      {
        id: 'user-3',
        nome: 'Carla Editora',
        role: 'agent',
        role_id: 'role-1',
        papel_nome: 'Editor de Conteúdo',
        can_see_financials: false,
        avatar_url: null,
        created_at: '2026-03-02T10:00:00.000Z',
      },
    ]);
  });

  // Pre-migration fallback (same isMissingRolesSchemaError reused by
  // getMyMembership, hotfix #439): a database that predates the roles
  // migration 400s on the enriched select (role_id / workspace_roles unknown
  // to PostgREST's schema cache). Without a fallback here, MembrosTab's
  // roster query rejected and useQuery silently rendered an empty roster
  // (`wsUsers ?? []`) instead of a loud failure -- this pins the re-run
  // against the legacy columns instead.
  it('falls back to the legacy select and reports role_id/papel_nome as null when the roles schema is missing (42703)', async () => {
    mockedSupabase.__queueSupabaseResult(
      'workspace_members',
      'select',
      {
        data: null,
        error: { code: '42703', message: 'column workspace_members.role_id does not exist' },
      },
      {
        data: [
          {
            user_id: 'user-4',
            role: 'owner',
            joined_at: '2026-04-03T10:00:00.000Z',
            can_see_financials: true,
            profiles: {
              id: 'user-4',
              nome: 'Dona da Conta',
              avatar_url: null,
              created_at: '2026-03-03T10:00:00.000Z',
            },
          },
        ],
        error: null,
      },
    );

    const users = await store.getWorkspaceUsers();

    expect(users).toEqual([
      {
        id: 'user-4',
        nome: 'Dona da Conta',
        role: 'owner',
        role_id: null,
        papel_nome: null,
        can_see_financials: true,
        avatar_url: null,
        created_at: '2026-03-03T10:00:00.000Z',
      },
    ]);
  });

  it('rethrows a non-schema error instead of falling back (a network blip must not be swallowed)', async () => {
    const queryError = { message: 'permission denied' };
    mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
      data: null,
      error: queryError,
    });

    await expect(store.getWorkspaceUsers()).rejects.toBe(queryError);
  });

  it('returns an empty workspace list when there is no authenticated user', async () => {
    mockedSupabase.__setCurrentUser(null);

    await expect(store.getMyWorkspaces()).resolves.toEqual([]);
  });

  it('updates the active workspace and clears the cached profile', async () => {
    mockedSupabase.__queueSupabaseRpc('switch_workspace', {
      data: null,
      error: null,
    });

    await store.switchWorkspace('conta-9');

    expect(getLastCall('rpc:switch_workspace')).toMatchObject({
      operation: 'rpc',
      payload: { p_workspace: 'conta-9' },
    });
    await expect(supabaseModule.getCurrentProfile()).resolves.toBeNull();
  });

  it('calls the workspace management edge function with the current access token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await store.updateWorkspaceUserRole('user-44', { role: 'admin' });

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

  it('spreads roleId (custom papel) into the update-role request body instead of role', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await store.updateWorkspaceUserRole('user-44', { roleId: 'role-1' });

    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      action: 'update-role',
      targetUserId: 'user-44',
      roleId: 'role-1',
    });
  });

  it('maps legacy transaction rows without status to pago', async () => {
    mockedSupabase.__queueSupabaseResult('transacoes', 'select', {
      data: [{ id: 1, descricao: 'Mensalidade Clínica Aurora', status: null }],
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
        true,
      );

      expect(projected.some((item) => item.referencia_agendamento?.startsWith('membro_2_'))).toBe(
        true,
      );
      expect(projected.some((item) => item.referencia_agendamento === 'cliente_1_2026_04')).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: 'getClientes',
      operation: 'select' as const,
      table: 'clientes_v',
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
      table: 'membros_v',
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
  ])(
    '$name issues the expected select query',
    async ({ table, operation, run, response, expected, modifiers }) => {
      mockedSupabase.__queueSupabaseResult(table, operation, { data: response, error: null });

      await expect(run()).resolves.toEqual(expected);

      const call = getLastCall(table);
      expect(call.operation).toBe(operation);
      for (const modifier of modifiers) {
        expect(call.modifiers).toContainEqual(modifier);
      }
    },
  );

  it('getClientes pages through multiple full pages instead of trusting a single response', async () => {
    // PAGE_SIZE in store/clients.ts is 500 — queue two FULL pages (proving the
    // loop does not stop just because a page came back "big enough to look
    // complete") followed by nothing, so the mock's default empty-select
    // response ends the loop. If getClientes stopped after the first page
    // (the pre-fix behaviour), this would resolve to only 500 rows instead of
    // 1000, and would never even attempt a second `clientes` select call.
    const PAGE_SIZE = 500;
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: i + 1,
      nome: `Cliente ${i + 1}`,
    }));
    const page2 = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: PAGE_SIZE + i + 1,
      nome: `Cliente ${PAGE_SIZE + i + 1}`,
    }));
    // Reads go through the masking view 'clientes_v' (per-admin financial
    // visibility, migration 20260728000001), not the base table — writes still
    // target 'clientes'.
    mockedSupabase.__queueSupabaseResult('clientes_v', 'select', { data: page1, error: null });
    mockedSupabase.__queueSupabaseResult('clientes_v', 'select', { data: page2, error: null });

    const result = await store.getClientes();

    expect(result).toHaveLength(PAGE_SIZE * 2);
    expect(result).toEqual([...page1, ...page2]);

    const calls = mockedSupabase.__getSupabaseCalls().filter((c) => c.table === 'clientes_v');
    // Three calls: the two queued pages plus one more that drained the queue
    // and got the mock's default empty result, which is what actually stops
    // the loop.
    expect(calls).toHaveLength(3);
    expect(calls[0].modifiers).toContainEqual({ method: 'range', args: [0, PAGE_SIZE - 1] });
    expect(calls[1].modifiers).toContainEqual({
      method: 'range',
      args: [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    });
    expect(calls[2].modifiers).toContainEqual({
      method: 'range',
      args: [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    });
  });

  it('getCliente reads from clientes_v and filters by id', async () => {
    const clienteData = {
      id: 42,
      nome: 'Clínica Aurora',
      sigla: 'CA',
      cor: '#db2777',
      plano: 'Premium',
      email: 'contato@aurora.com.br',
      telefone: '(85) 99999-0000',
      status: 'ativo' as const,
      valor_mensal: 3200,
    };
    mockedSupabase.__queueSupabaseResult('clientes_v', 'select', {
      data: clienteData,
      error: null,
    });

    const result = await store.getCliente(42);

    expect(result).toEqual(clienteData);
    const call = getLastCall('clientes_v');
    expect(call.operation).toBe('select');
    // Assert on select('*') to catch accidental column narrowing in the future.
    // The view handles financial visibility masking via CASE WHEN
    // public.can_see_financials(), so '*' is the correct query, not a safe-columns list.
    expect(call.selectArgs).toContainEqual(['*']);
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 42] });
    expect(call.modifiers).toContainEqual({ method: 'maybeSingle', args: [] });
  });

  it('getCliente returns null when cliente is not found', async () => {
    mockedSupabase.__queueSupabaseResult('clientes_v', 'select', {
      data: null,
      error: null,
    });

    const result = await store.getCliente(999);

    expect(result).toBeNull();
  });

  it('getCliente throws on error', async () => {
    const testError = new Error('Supabase connection failed');
    mockedSupabase.__queueSupabaseResult('clientes_v', 'select', {
      data: null,
      error: testError,
    });

    await expect(store.getCliente(42)).rejects.toThrow('Supabase connection failed');
  });

  it.each([
    {
      name: 'addCliente',
      table: 'clientes',
      run: () =>
        store.addCliente({
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
      run: () =>
        store.addClienteEndereco({
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
      run: () =>
        store.addClienteData({
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
      run: () =>
        store.addTransacao({
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
      run: () =>
        store.addContrato({
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
      run: () =>
        store.addMembro({
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
      run: () =>
        store.addLead({
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
  ])(
    '$name inserts with the authenticated workspace context',
    async ({ table, run, payload, returnsVoid }) => {
      mockedSupabase.__queueSupabaseResult(table, 'insert', {
        data: { id: 1, ...payload },
        error: null,
      });

      const result = await run();
      if (returnsVoid) {
        expect(result).toBeUndefined();
      } else {
        expect(result).toMatchObject({ id: 1, ...payload });
      }

      expect(getLastCall(table)).toMatchObject({
        operation: 'insert',
        payload,
      });
    },
  );

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
    {
      name: 'removeClienteEndereco',
      table: 'cliente_enderecos',
      run: () => store.removeClienteEndereco(9),
      eq: ['id', 9],
    },
    {
      name: 'removeClienteData',
      table: 'cliente_datas',
      run: () => store.removeClienteData(3),
      eq: ['id', 3],
    },
    {
      name: 'removeTransacao',
      table: 'transacoes',
      run: () => store.removeTransacao(4),
      eq: ['id', 4],
    },
    {
      name: 'removeContrato',
      table: 'contratos',
      run: () => store.removeContrato(5),
      eq: ['id', 5],
    },
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
