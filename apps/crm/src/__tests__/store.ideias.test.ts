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

describe('store ideias', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  describe('getIdeias', () => {
    it('fetches ideias with joined relations', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'select', {
        data: [
          { id: 'ideia-1', titulo: 'Reels trend', status: 'nova', clientes: { nome: 'Clínica' }, ideia_reactions: [] },
        ],
        error: null,
      });

      const result = await store.getIdeias();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ titulo: 'Reels trend' });
    });

    it('filters by cliente_id when provided', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'select', {
        data: [],
        error: null,
      });

      await store.getIdeias({ cliente_id: 5 });

      const call = getCalls('ideias', 'select').at(-1)!;
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['cliente_id', 5] });
    });

    it('returns all ideias without filter when no client_id given', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'select', {
        data: [
          { id: 'ideia-1', titulo: 'Reels', status: 'nova', clientes: { nome: 'A' }, ideia_reactions: [] },
          { id: 'ideia-2', titulo: 'Stories', status: 'aprovada', clientes: { nome: 'B' }, ideia_reactions: [] },
        ],
        error: null,
      });

      const result = await store.getIdeias();

      expect(result).toHaveLength(2);
      const call = getCalls('ideias', 'select').at(-1)!;
      expect(call.modifiers.some(m => m.method === 'eq' && m.args[0] === 'cliente_id')).toBe(false);
    });
  });

  describe('updateIdeiaStatus', () => {
    it('updates status field by ideia id', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'update', { data: null, error: null });

      await store.updateIdeiaStatus('ideia-1', 'aprovada');

      const call = getCalls('ideias', 'update').at(-1)!;
      expect(call.payload).toEqual({ status: 'aprovada' });
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'ideia-1'] });
    });

    it('can transition to all valid statuses', async () => {
      const statuses: store.Ideia['status'][] = ['nova', 'em_analise', 'aprovada', 'descartada'];

      for (const status of statuses) {
        mockedSupabase.__queueSupabaseResult('ideias', 'update', { data: null, error: null });
        await store.updateIdeiaStatus('ideia-1', status);
        const call = getCalls('ideias', 'update').at(-1)!;
        expect(call.payload).toEqual({ status });
      }
    });
  });

  describe('upsertIdeiaComentario', () => {
    it('sets comentario_agencia, autor_id, and timestamp', async () => {
      mockedSupabase.__queueSupabaseResult('ideias', 'update', { data: null, error: null });

      await store.upsertIdeiaComentario('ideia-1', 'Ótima ideia, vamos avançar!', 3);

      const call = getCalls('ideias', 'update').at(-1)!;
      expect(call.payload).toMatchObject({
        comentario_agencia: 'Ótima ideia, vamos avançar!',
        comentario_autor_id: 3,
      });
      expect(call.payload).toHaveProperty('comentario_at');
      expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'ideia-1'] });
    });
  });

  describe('toggleIdeiaReaction', () => {
    it('inserts a reaction when the membro has not reacted yet', async () => {
      mockedSupabase.__queueSupabaseResult('ideia_reactions', 'select', { data: null, error: null });
      mockedSupabase.__queueSupabaseResult('ideia_reactions', 'insert', { data: null, error: null });

      await store.toggleIdeiaReaction('ideia-1', 2, '❤️');

      const insertCalls = getCalls('ideia_reactions', 'insert');
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].payload).toMatchObject({ ideia_id: 'ideia-1', membro_id: 2, emoji: '❤️' });
    });

    it('removes the reaction when the membro has already reacted', async () => {
      mockedSupabase.__queueSupabaseResult('ideia_reactions', 'select', {
        data: { id: 'reaction-99' },
        error: null,
      });
      mockedSupabase.__queueSupabaseResult('ideia_reactions', 'delete', { data: null, error: null });

      await store.toggleIdeiaReaction('ideia-1', 2, '❤️');

      const deleteCalls = getCalls('ideia_reactions', 'delete');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].modifiers).toContainEqual({ method: 'eq', args: ['id', 'reaction-99'] });
    });
  });
});
