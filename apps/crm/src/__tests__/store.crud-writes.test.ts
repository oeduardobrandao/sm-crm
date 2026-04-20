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

describe('store CRUD write operations', () => {
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

  describe('clientes', () => {
    it('addCliente inserts with user_id and conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('clientes', 'insert', {
        data: { id: 10, nome: 'Nova Clínica', user_id: 'user-1', conta_id: 'conta-1' },
        error: null,
      });

      const result = await store.addCliente({
        nome: 'Nova Clínica',
        sigla: 'NC',
        cor: '#ff0000',
        plano: 'premium',
        email: 'nova@clinica.com',
        telefone: '11999999999',
        status: 'ativo',
        valor_mensal: 2500,
      });

      expect(result).toMatchObject({ id: 10, nome: 'Nova Clínica' });
      const call = getLastCall('clientes');
      expect(call.operation).toBe('insert');
      expect(call.payload).toMatchObject({
        nome: 'Nova Clínica',
        user_id: 'user-1',
        conta_id: 'conta-1',
      });
    });

    it('updateCliente patches only provided fields', async () => {
      mockedSupabase.__queueSupabaseResult('clientes', 'update', {
        data: { id: 5, nome: 'Clínica Atualizada', status: 'pausado' },
        error: null,
      });

      const result = await store.updateCliente(5, { status: 'pausado' });

      expect(result).toMatchObject({ id: 5, status: 'pausado' });
      const call = getLastCall('clientes');
      expect(call.operation).toBe('update');
      expect(call.payload).toEqual({ status: 'pausado' });
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 5] });
    });

    it('removeCliente deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('clientes', 'delete', { data: null, error: null });

      await store.removeCliente(5);

      const call = getLastCall('clientes');
      expect(call.operation).toBe('delete');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 5] });
    });

    it('addCliente throws when user is not authenticated', async () => {
      mockedSupabase.__setCurrentUser(null);

      await expect(
        store.addCliente({
          nome: 'Test', sigla: 'T', cor: '#000', plano: 'basico',
          email: 'x@x.com', telefone: '0', status: 'ativo', valor_mensal: 0,
        })
      ).rejects.toThrow('Não autenticado');
    });
  });

  describe('transacoes', () => {
    it('addTransacao sets status to pago by default', async () => {
      mockedSupabase.__queueSupabaseResult('transacoes', 'insert', {
        data: { id: 20, descricao: 'Mensalidade', status: 'pago' },
        error: null,
      });

      await store.addTransacao({
        data: '2026-04-01',
        descricao: 'Mensalidade',
        detalhe: 'Cliente X',
        categoria: 'Receita',
        tipo: 'entrada',
        valor: 3000,
      });

      const call = getLastCall('transacoes');
      expect(call.payload).toMatchObject({
        status: 'pago',
        referencia_agendamento: null,
        user_id: 'user-1',
        conta_id: 'conta-1',
      });
    });

    it('addTransacao preserves explicit status and referencia_agendamento', async () => {
      mockedSupabase.__queueSupabaseResult('transacoes', 'insert', {
        data: { id: 21, status: 'agendado', referencia_agendamento: 'cliente_1_2026_04' },
        error: null,
      });

      await store.addTransacao({
        data: '2026-04-10',
        descricao: 'Auto',
        detalhe: '',
        categoria: 'Agendamento',
        tipo: 'entrada',
        valor: 2000,
        status: 'agendado',
        referencia_agendamento: 'cliente_1_2026_04',
      });

      const call = getLastCall('transacoes');
      expect(call.payload).toMatchObject({
        status: 'agendado',
        referencia_agendamento: 'cliente_1_2026_04',
      });
    });

    it('updateTransacao patches by id', async () => {
      mockedSupabase.__queueSupabaseResult('transacoes', 'update', {
        data: { id: 20, valor: 3500 },
        error: null,
      });

      await store.updateTransacao(20, { valor: 3500 });

      const call = getLastCall('transacoes');
      expect(call.operation).toBe('update');
      expect(call.payload).toEqual({ valor: 3500 });
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 20] });
    });

    it('removeTransacao deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('transacoes', 'delete', { data: null, error: null });

      await store.removeTransacao(20);

      const call = getLastCall('transacoes');
      expect(call.operation).toBe('delete');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 20] });
    });
  });

  describe('contratos', () => {
    it('addContrato inserts with user_id and conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('contratos', 'insert', {
        data: { id: 30, titulo: 'Plano Anual', user_id: 'user-1', conta_id: 'conta-1' },
        error: null,
      });

      const result = await store.addContrato({
        cliente_id: 1,
        cliente_nome: 'Clínica Aurora',
        titulo: 'Plano Anual',
        data_inicio: '2026-01-01',
        data_fim: '2026-12-31',
        status: 'vigente',
        valor_total: 36000,
      });

      expect(result).toMatchObject({ id: 30, titulo: 'Plano Anual' });
      const call = getLastCall('contratos');
      expect(call.payload).toMatchObject({ user_id: 'user-1', conta_id: 'conta-1' });
    });

    it('updateContrato patches by id', async () => {
      mockedSupabase.__queueSupabaseResult('contratos', 'update', {
        data: { id: 30, status: 'encerrado' },
        error: null,
      });

      await store.updateContrato(30, { status: 'encerrado' });

      const call = getLastCall('contratos');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 30] });
    });

    it('removeContrato deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('contratos', 'delete', { data: null, error: null });

      await store.removeContrato(30);

      const call = getLastCall('contratos');
      expect(call.operation).toBe('delete');
    });
  });

  describe('membros', () => {
    it('addMembro inserts with user_id and conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('membros', 'insert', {
        data: { id: 40, nome: 'Paulo Editor' },
        error: null,
      });

      const result = await store.addMembro({
        nome: 'Paulo Editor',
        cargo: 'Editor',
        tipo: 'freelancer_mensal',
        custo_mensal: 1500,
        avatar_url: '',
      });

      expect(result).toMatchObject({ id: 40, nome: 'Paulo Editor' });
      const call = getLastCall('membros');
      expect(call.payload).toMatchObject({ user_id: 'user-1', conta_id: 'conta-1' });
    });

    it('updateMembro patches by id', async () => {
      mockedSupabase.__queueSupabaseResult('membros', 'update', {
        data: { id: 40, custo_mensal: 2000 },
        error: null,
      });

      await store.updateMembro(40, { custo_mensal: 2000 });

      const call = getLastCall('membros');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 40] });
    });

    it('removeMembro deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('membros', 'delete', { data: null, error: null });

      await store.removeMembro(40);

      const call = getLastCall('membros');
      expect(call.operation).toBe('delete');
    });
  });

  describe('leads', () => {
    it('addLead inserts with user_id and conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('leads', 'insert', {
        data: { id: 50, nome: 'Ana Fisio', email: 'ana@fisio.com' },
        error: null,
      });

      const result = await store.addLead({
        nome: 'Ana Fisio',
        email: 'ana@fisio.com',
        telefone: '11988887777',
        instagram: '@anafisio',
        canal: 'Instagram',
        origem: 'manual',
        status: 'novo',
        notas: '',
        especialidade: 'Fisioterapia',
        faturamento: '10k-50k',
        objetivo: 'Crescer no Instagram',
        tags: 'saude',
      });

      expect(result).toMatchObject({ id: 50, nome: 'Ana Fisio' });
      const call = getLastCall('leads');
      expect(call.payload).toMatchObject({ user_id: 'user-1', conta_id: 'conta-1' });
    });

    it('updateLead patches by id', async () => {
      mockedSupabase.__queueSupabaseResult('leads', 'update', {
        data: { id: 50, status: 'qualificado' },
        error: null,
      });

      await store.updateLead(50, { status: 'qualificado' });

      const call = getLastCall('leads');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 50] });
    });

    it('removeLead deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('leads', 'delete', { data: null, error: null });

      await store.removeLead(50);

      const call = getLastCall('leads');
      expect(call.operation).toBe('delete');
    });
  });

  describe('cliente enderecos', () => {
    it('addClienteEndereco inserts with conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_enderecos', 'insert', {
        data: { id: 60, logradouro: 'Rua X', cidade: 'São Paulo' },
        error: null,
      });

      const result = await store.addClienteEndereco({
        cliente_id: 1,
        tipo: 'comercial',
        logradouro: 'Rua X',
        numero: '100',
        bairro: 'Centro',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01000-000',
      });

      expect(result).toMatchObject({ id: 60 });
      const call = getLastCall('cliente_enderecos');
      expect(call.payload).toMatchObject({ conta_id: 'conta-1' });
    });

    it('updateClienteEndereco sets updated_at', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_enderecos', 'update', {
        data: { id: 60, logradouro: 'Rua Y' },
        error: null,
      });

      await store.updateClienteEndereco(60, { logradouro: 'Rua Y' });

      const call = getLastCall('cliente_enderecos');
      expect(call.payload).toHaveProperty('updated_at');
      expect(call.payload).toMatchObject({ logradouro: 'Rua Y' });
    });

    it('removeClienteEndereco deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_enderecos', 'delete', { data: null, error: null });

      await store.removeClienteEndereco(60);

      const call = getLastCall('cliente_enderecos');
      expect(call.operation).toBe('delete');
    });
  });

  describe('cliente datas', () => {
    it('addClienteData inserts with conta_id', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_datas', 'insert', {
        data: { id: 70, titulo: 'Aniversário' },
        error: null,
      });

      const result = await store.addClienteData({
        cliente_id: 1,
        titulo: 'Aniversário',
        data: '2026-05-15',
      });

      expect(result).toMatchObject({ id: 70, titulo: 'Aniversário' });
      const call = getLastCall('cliente_datas');
      expect(call.payload).toMatchObject({ conta_id: 'conta-1' });
    });

    it('updateClienteData patches by id', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_datas', 'update', {
        data: { id: 70, titulo: 'Reunião' },
        error: null,
      });

      await store.updateClienteData(70, { titulo: 'Reunião' });

      const call = getLastCall('cliente_datas');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 70] });
    });

    it('removeClienteData deletes by id', async () => {
      mockedSupabase.__queueSupabaseResult('cliente_datas', 'delete', { data: null, error: null });

      await store.removeClienteData(70);

      const call = getLastCall('cliente_datas');
      expect(call.operation).toBe('delete');
    });
  });
});
