import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __setCurrentUser: (user: { id: string } | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

describe('store computed helpers', () => {
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

  describe('getDashboardStats', () => {
    it('aggregates active client revenue and monthly expenses', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));

      try {
        mockedSupabase.__queueSupabaseResult('clientes', 'select', {
          data: [
            { id: 1, nome: 'Cliente A', status: 'ativo', valor_mensal: 3000, data_pagamento: 10 },
            { id: 2, nome: 'Cliente B', status: 'ativo', valor_mensal: 2000, data_pagamento: 15 },
            { id: 3, nome: 'Cliente C', status: 'pausado', valor_mensal: 1000 },
          ],
          error: null,
        });
        mockedSupabase.__queueSupabaseResult('transacoes', 'select', {
          data: [
            { id: 1, tipo: 'saida', valor: 500, data: '2026-04-05', status: 'pago' },
            { id: 2, tipo: 'saida', valor: 300, data: '2026-04-10', status: 'pago' },
            { id: 3, tipo: 'entrada', valor: 3000, data: '2026-03-15', status: 'pago' },
          ],
          error: null,
        });
        mockedSupabase.__queueSupabaseResult('membros', 'select', {
          data: [
            { id: 1, nome: 'Editor', data_pagamento: 20, custo_mensal: 1000 },
          ],
          error: null,
        });

        const stats = await store.getDashboardStats();

        expect(stats.clientesAtivos).toHaveLength(2);
        expect(stats.receitaMensal).toBe(5000);
        expect(stats.despesaTotal).toBeGreaterThanOrEqual(800);
        expect(stats.saldo).toBe(stats.receitaMensal - stats.despesaTotal);
      } finally {
        vi.useRealTimers();
      }
    });

    it('includes projected member expenses in the month total', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'));

      try {
        mockedSupabase.__queueSupabaseResult('clientes', 'select', { data: [], error: null });
        mockedSupabase.__queueSupabaseResult('transacoes', 'select', { data: [], error: null });
        mockedSupabase.__queueSupabaseResult('membros', 'select', {
          data: [
            { id: 1, nome: 'Paulo', data_pagamento: 10, custo_mensal: 900 },
          ],
          error: null,
        });

        const stats = await store.getDashboardStats();

        expect(stats.transacoes.some(t => t.referencia_agendamento?.startsWith('membro_1_'))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns zero despesaTotal when no transactions or members', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));

      try {
        mockedSupabase.__queueSupabaseResult('clientes', 'select', { data: [], error: null });
        mockedSupabase.__queueSupabaseResult('transacoes', 'select', { data: [], error: null });
        mockedSupabase.__queueSupabaseResult('membros', 'select', { data: [], error: null });

        const stats = await store.getDashboardStats();

        expect(stats.receitaMensal).toBe(0);
        expect(stats.despesaTotal).toBe(0);
        expect(stats.saldo).toBe(0);
        expect(stats.clientesAtivos).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getDeadlineInfo', () => {
    it('returns full days remaining for inactive steps', () => {
      const etapa: store.WorkflowEtapa = {
        workflow_id: 1,
        ordem: 0,
        nome: 'Briefing',
        prazo_dias: 5,
        tipo_prazo: 'corridos',
        status: 'pendente',
        iniciado_em: null,
      };

      const info = store.getDeadlineInfo(etapa);

      expect(info.diasRestantes).toBe(5);
      expect(info.estourado).toBe(false);
      expect(info.urgente).toBe(false);
    });

    it('calculates remaining time for active steps with corridos prazo', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));

      try {
        const etapa: store.WorkflowEtapa = {
          workflow_id: 1,
          ordem: 0,
          nome: 'Design',
          prazo_dias: 3,
          tipo_prazo: 'corridos',
          status: 'ativo',
          iniciado_em: '2026-04-14T12:00:00.000Z',
        };

        const info = store.getDeadlineInfo(etapa);

        expect(info.diasRestantes).toBe(2);
        expect(info.estourado).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks overdue steps as estourado', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));

      try {
        const etapa: store.WorkflowEtapa = {
          workflow_id: 1,
          ordem: 0,
          nome: 'Revisão',
          prazo_dias: 2,
          tipo_prazo: 'corridos',
          status: 'ativo',
          iniciado_em: '2026-04-15T12:00:00.000Z',
        };

        const info = store.getDeadlineInfo(etapa);

        expect(info.estourado).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks steps within 24h as urgente', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-16T20:00:00.000Z'));

      try {
        const etapa: store.WorkflowEtapa = {
          workflow_id: 1,
          ordem: 0,
          nome: 'Postagem',
          prazo_dias: 2,
          tipo_prazo: 'corridos',
          status: 'ativo',
          iniciado_em: '2026-04-15T00:00:00.000Z',
        };

        const info = store.getDeadlineInfo(etapa);

        expect(info.urgente).toBe(true);
        expect(info.estourado).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('excludes weekends when tipo_prazo is uteis', () => {
      vi.useFakeTimers();
      // Thu Apr 9 noon → Tue Apr 14 noon: 5 calendar days, but only 3 business days (Fri, Mon, Tue).
      // With prazo_dias=5 uteis: 5-3=2 remaining (vs 0 if corridos — overdue)
      vi.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));

      try {
        const etapa: store.WorkflowEtapa = {
          workflow_id: 1,
          ordem: 0,
          nome: 'Aprovação',
          prazo_dias: 5,
          tipo_prazo: 'uteis',
          status: 'ativo',
          iniciado_em: '2026-04-09T12:00:00.000Z', // Thursday noon
        };

        const info = store.getDeadlineInfo(etapa);

        expect(info.diasRestantes).toBe(2);
        expect(info.estourado).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
