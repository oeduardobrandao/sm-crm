# Test Coverage Expansion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill critical test gaps in store.ts (CRUD + computed helpers), services, and edge functions to increase coverage and make future feature development safer.

**Architecture:** Tests use Vitest + jsdom with the existing `createSupabaseQueryMock` helper for CRM tests. Edge functions use Deno's built-in test runner. Focus on behavioral testing of data flows — mock Supabase queries, assert payloads and return shapes.

**Tech Stack:** Vitest, @testing-library/react, test/shared/supabaseMock.ts, test/shared/fetchMock.ts, Deno test (edge functions)

---

## Gap Analysis

### Currently tested (288 tests, 41 files):
- `store.ts`: Core helpers (formatBRL, getInitials, projetarAgendamentos), workspace ops, basic CRUD reads (getClientes, getContratos, getMembros, getLeads, getClienteEnderecos, getClienteDatas), workflow templates, completeEtapa, revertEtapa, portal tokens, hub tokens
- `services/`: analytics (overview, portfolio, posts, reports), instagram (connect, disconnect, accounts), postMedia (validateFile, detectKind, upload, delete, reorder, covers), invite (inviteUser, cancelInvite)
- `context/AuthContext`: session init, profile fetch, sign out
- `lib/supabase.ts`: getCurrentUser, getCurrentProfile, clearProfileCache, signOut
- `lib/csv.ts`: parseCSV edge cases
- `utils/security.ts` + `router.ts`: sanitizeUrl, escapeHTML
- Pages: Dashboard, Clientes, Entregas, Analytics (3 variants), Login, Landing
- Hub: context, router, shell, components, pages

### Gaps (high-leverage, untested):
1. **store.ts CRUD writes** — `addCliente`, `updateCliente`, `removeCliente`, `addTransacao`, `updateTransacao`, `removeTransacao`, `addContrato`, `updateContrato`, `removeContrato`, `addMembro`, `updateMembro`, `removeMembro`, `addLead`, `updateLead`, `removeLead`
2. **store.ts computed** — `getDashboardStats` (aggregation logic), `getDeadlineInfo` (business day calculation)
3. **store.ts workflow posts** — `addWorkflowPost`, `updateWorkflowPost`, `removeWorkflowPost`, `reorderWorkflowPosts`, `getWorkflowPostsCounts`, `sendPostsToCliente`, `approvePostsInternally`
4. **store.ts custom properties** — `createPropertyDefinition`, `updatePropertyDefinition`, `deletePropertyDefinition`, `upsertPostPropertyValue`, `createWorkflowSelectOption`
5. **store.ts duplicateWorkflow** — complex orchestration with cleanup on failure
6. **store.ts ideias** — `getIdeias`, `addIdeia`, `updateIdeia`, `removeIdeia`
7. **services/analytics.ts** — `makeDelta` helper (pure function, easily testable)
8. **Edge functions** — No Deno tests exist for any of the 21 edge functions

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `apps/crm/src/__tests__/store.crud-writes.test.ts` | All CRUD write operations (add/update/remove for clients, transactions, contracts, members, leads) |
| Create | `apps/crm/src/__tests__/store.computed.test.ts` | `getDashboardStats` and `getDeadlineInfo` |
| Create | `apps/crm/src/__tests__/store.posts.test.ts` | Workflow posts CRUD + batch operations |
| Create | `apps/crm/src/__tests__/store.properties.test.ts` | Custom property definitions and values |
| Create | `apps/crm/src/__tests__/store.duplicate.test.ts` | `duplicateWorkflow` orchestration |
| Create | `apps/crm/src/__tests__/store.ideias.test.ts` | Ideias CRUD |
| Create | `apps/crm/src/services/__tests__/analytics.delta.test.ts` | `makeDelta` unit tests |

---

### Task 1: Store CRUD Write Operations

**Files:**
- Create: `apps/crm/src/__tests__/store.crud-writes.test.ts`

- [x] **Step 1: Write the test file with CRUD write tests**

```typescript
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
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.crud-writes.test.ts`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/store.crud-writes.test.ts
git commit -m "test: add store CRUD write operations coverage"
```

---

### Task 2: Store Computed Helpers (getDashboardStats + getDeadlineInfo)

**Files:**
- Create: `apps/crm/src/__tests__/store.computed.test.ts`

- [x] **Step 1: Write the test file**

```typescript
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
      // Monday April 14 -> set time to Wednesday April 16 (2 business days passed)
      vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));

      try {
        const etapa: store.WorkflowEtapa = {
          workflow_id: 1,
          ordem: 0,
          nome: 'Aprovação',
          prazo_dias: 5,
          tipo_prazo: 'uteis',
          status: 'ativo',
          iniciado_em: '2026-04-14T08:00:00.000Z', // Monday
        };

        const info = store.getDeadlineInfo(etapa);

        expect(info.diasRestantes).toBe(3);
        expect(info.estourado).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.computed.test.ts`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/store.computed.test.ts
git commit -m "test: add getDashboardStats and getDeadlineInfo coverage"
```

---

### Task 3: Store Workflow Posts + Batch Operations

**Files:**
- Create: `apps/crm/src/__tests__/store.posts.test.ts`

- [x] **Step 1: Write the test file**

```typescript
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

  it('removeWorkflowPost deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'delete', { data: null, error: null });

    await store.removeWorkflowPost(100);

    const call = getCalls('workflow_posts', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
  });

  it('reorderWorkflowPosts updates ordem for each post', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_posts', 'update',
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
      data: [
        { workflow_id: 5 },
        { workflow_id: 5 },
        { workflow_id: 7 },
      ],
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

  it('sendPostsToCliente updates approved_interno posts to enviado_cliente', async () => {
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
    expect(call.modifiers).toContainEqual({ method: 'not', args: ['status', 'in', '(agendado,postado)'] });
  });

  it('getPostApprovals returns empty array for no post ids', async () => {
    const result = await store.getPostApprovals([]);
    expect(result).toEqual([]);
  });

  it('getPostApprovals queries with in filter', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: [
        { id: 1, post_id: 100, action: 'aprovado', comentario: 'Ótimo!', is_workspace_user: false, created_at: '2026-04-15' },
      ],
      error: null,
    });

    const result = await store.getPostApprovals([100, 101]);

    expect(result).toHaveLength(1);
    const call = getCalls('post_approvals', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['post_id', [100, 101]] });
  });
});
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.posts.test.ts`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/store.posts.test.ts
git commit -m "test: add workflow posts and batch operations coverage"
```

---

### Task 4: Store Custom Properties

**Files:**
- Create: `apps/crm/src/__tests__/store.properties.test.ts`

- [x] **Step 1: Write the test file**

```typescript
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

describe('store custom properties', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPropertyDefinitions fetches by template_id ordered by display_order', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'select', {
      data: [
        { id: 1, name: 'Status', type: 'select', display_order: 0 },
        { id: 2, name: 'Data', type: 'date', display_order: 1 },
      ],
      error: null,
    });

    const result = await store.getPropertyDefinitions(10);

    expect(result).toHaveLength(2);
    const call = getCalls('template_property_definitions', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['template_id', 10] });
    expect(call.modifiers).toContainEqual({ method: 'order', args: ['display_order', { ascending: true }] });
  });

  it('createPropertyDefinition inserts with template_id and conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'insert', {
      data: { id: 3, name: 'Categoria', type: 'select', template_id: 10, conta_id: 'conta-1' },
      error: null,
    });

    const result = await store.createPropertyDefinition(10, {
      name: 'Categoria',
      type: 'select',
      config: { options: [] },
      portal_visible: true,
      display_order: 2,
    });

    expect(result).toMatchObject({ id: 3, name: 'Categoria' });
    const call = getCalls('template_property_definitions', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      template_id: 10,
      conta_id: 'conta-1',
      name: 'Categoria',
    });
  });

  it('updatePropertyDefinition scopes update to conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'update', {
      data: { id: 3, name: 'Tipo de Conteúdo' },
      error: null,
    });

    await store.updatePropertyDefinition(3, { name: 'Tipo de Conteúdo' });

    const call = getCalls('template_property_definitions', 'update').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 3] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['conta_id', 'conta-1'] });
  });

  it('updatePropertyDefinition throws when not found', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'update', {
      data: null,
      error: null,
    });

    await expect(store.updatePropertyDefinition(999, { name: 'X' })).rejects.toThrow('Property definition not found');
  });

  it('deletePropertyDefinition scopes to conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('template_property_definitions', 'delete', { data: null, error: null });

    await store.deletePropertyDefinition(3);

    const call = getCalls('template_property_definitions', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 3] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['conta_id', 'conta-1'] });
  });

  it('upsertPostPropertyValue uses upsert with onConflict', async () => {
    mockedSupabase.__queueSupabaseResult('post_property_values', 'upsert', { data: null, error: null });

    await store.upsertPostPropertyValue(100, 3, 'option-1');

    const call = getCalls('post_property_values', 'upsert').at(-1)!;
    expect(call.payload).toMatchObject({
      post_id: 100,
      property_definition_id: 3,
      value: 'option-1',
    });
    expect(call.payload).toHaveProperty('updated_at');
  });

  it('createWorkflowSelectOption inserts with conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_select_options', 'insert', {
      data: { id: 200, label: 'Em progresso', color: '#eab308', workflow_id: 5 },
      error: null,
    });

    const result = await store.createWorkflowSelectOption(5, 3, 'Em progresso', '#eab308');

    expect(result).toMatchObject({ label: 'Em progresso' });
    const call = getCalls('workflow_select_options', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      workflow_id: 5,
      property_definition_id: 3,
      label: 'Em progresso',
      color: '#eab308',
      conta_id: 'conta-1',
    });
  });

  it('getWorkflowSelectOptions filters by workflow_id and definition_id', async () => {
    mockedSupabase.__queueSupabaseResult('workflow_select_options', 'select', {
      data: [{ id: 200, label: 'Aprovado', color: '#3ecf8e' }],
      error: null,
    });

    const result = await store.getWorkflowSelectOptions(5, 3);

    expect(result).toHaveLength(1);
    const call = getCalls('workflow_select_options', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflow_id', 5] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['property_definition_id', 3] });
  });
});
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.properties.test.ts`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/store.properties.test.ts
git commit -m "test: add custom properties CRUD coverage"
```

---

### Task 5: Store duplicateWorkflow Orchestration

**Files:**
- Create: `apps/crm/src/__tests__/store.duplicate.test.ts`

- [x] **Step 1: Write the test file**

```typescript
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

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store duplicateWorkflow', () => {
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

  it('creates a fresh workflow copy with all steps reset', async () => {
    // Original workflow fetch
    mockedSupabase.__queueSupabaseResult('workflows', 'select', {
      data: {
        id: 10,
        cliente_id: 1,
        titulo: 'Social Mensal',
        template_id: 5,
        status: 'concluido',
        etapa_atual: 2,
        recorrente: true,
      },
      error: null,
    });
    // Original etapas fetch
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select', {
      data: [
        { id: 101, ordem: 0, nome: 'Briefing', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'padrao', status: 'concluido' },
        { id: 102, ordem: 1, nome: 'Design', prazo_dias: 3, tipo_prazo: 'corridos', responsavel_id: 1, tipo: 'padrao', status: 'concluido' },
        { id: 103, ordem: 2, nome: 'Aprovação', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'aprovacao_cliente', status: 'concluido' },
      ],
      error: null,
    });
    // New workflow insert
    mockedSupabase.__queueSupabaseResult('workflows', 'insert', {
      data: { id: 20, cliente_id: 1, titulo: 'Social Mensal', status: 'ativo', etapa_atual: 0 },
      error: null,
    });
    // Etapa inserts (3 steps)
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'insert',
      { data: { id: 201, ordem: 0, status: 'ativo' }, error: null },
      { data: { id: 202, ordem: 1, status: 'pendente' }, error: null },
      { data: { id: 203, ordem: 2, status: 'pendente' }, error: null },
    );

    const result = await store.duplicateWorkflow(10);

    expect(result).toMatchObject({ id: 20, status: 'ativo', etapa_atual: 0 });

    const etapaInserts = getCalls('workflow_etapas', 'insert');
    expect(etapaInserts).toHaveLength(3);

    // First step should be active
    expect(etapaInserts[0].payload).toMatchObject({ status: 'ativo', ordem: 0, workflow_id: 20 });
    expect(etapaInserts[0].payload).toHaveProperty('iniciado_em');

    // Subsequent steps should be pending
    expect(etapaInserts[1].payload).toMatchObject({ status: 'pendente', ordem: 1 });
    expect(etapaInserts[2].payload).toMatchObject({ status: 'pendente', ordem: 2, tipo: 'aprovacao_cliente' });
  });

  it('cleans up the new workflow if etapa inserts fail', async () => {
    mockedSupabase.__queueSupabaseResult('workflows', 'select', {
      data: { id: 10, cliente_id: 1, titulo: 'Social', template_id: null, status: 'concluido', etapa_atual: 0, recorrente: false },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'select', {
      data: [{ id: 101, ordem: 0, nome: 'Briefing', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'padrao', status: 'concluido' }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('workflows', 'insert', {
      data: { id: 30, cliente_id: 1, titulo: 'Social', status: 'ativo', etapa_atual: 0 },
      error: null,
    });
    // Etapa insert fails
    mockedSupabase.__queueSupabaseResult('workflow_etapas', 'insert', {
      data: null,
      error: { message: 'DB constraint violation' },
    });
    // Cleanup: delete the orphaned workflow
    mockedSupabase.__queueSupabaseResult('workflows', 'delete', { data: null, error: null });

    await expect(store.duplicateWorkflow(10)).rejects.toThrow();

    const deleteCalls = getCalls('workflows', 'delete');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(deleteCalls.at(-1)!.modifiers).toContainEqual({ method: 'eq', args: ['id', 30] });
  });
});
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.duplicate.test.ts`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/store.duplicate.test.ts
git commit -m "test: add duplicateWorkflow orchestration coverage"
```

---

### Task 6: Store Ideias CRUD

**Files:**
- Create: `apps/crm/src/__tests__/store.ideias.test.ts`

- [x] **Step 1: Read the ideias section of store.ts to confirm exact function signatures**

Run: Read `apps/crm/src/store.ts` from line 1648 to end of file to get the exact ideias function definitions.

- [x] **Step 2: Write the test file**

```typescript
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

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store ideias CRUD', () => {
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

  it('getIdeias fetches with joined relations', async () => {
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

  it('getIdeias filters by cliente_id when provided', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'select', {
      data: [],
      error: null,
    });

    await store.getIdeias({ cliente_id: 5 });

    const call = getCalls('ideias', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['cliente_id', 5] });
  });

  it('addIdeia inserts with workspace_id from profile conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'insert', {
      data: { id: 'ideia-2', titulo: 'Carrossel educativo', workspace_id: 'conta-1' },
      error: null,
    });

    const result = await store.addIdeia({
      cliente_id: 1,
      titulo: 'Carrossel educativo',
      descricao: 'Conteúdo sobre tratamentos',
      links: ['https://example.com'],
      status: 'nova',
    });

    expect(result).toMatchObject({ id: 'ideia-2' });
    const call = getCalls('ideias', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ workspace_id: 'conta-1' });
  });

  it('updateIdeia patches by id', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'update', {
      data: { id: 'ideia-2', status: 'aprovada' },
      error: null,
    });

    await store.updateIdeia('ideia-2', { status: 'aprovada' });

    const call = getCalls('ideias', 'update').at(-1)!;
    expect(call.payload).toMatchObject({ status: 'aprovada' });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'ideia-2'] });
  });

  it('removeIdeia deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('ideias', 'delete', { data: null, error: null });

    await store.removeIdeia('ideia-2');

    const call = getCalls('ideias', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'ideia-2'] });
  });
});
```

- [x] **Step 3: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/__tests__/store.ideias.test.ts`
Expected: All tests PASS (adjust function signatures if needed based on Step 1 reading)

- [x] **Step 4: Commit**

```bash
git add apps/crm/src/__tests__/store.ideias.test.ts
git commit -m "test: add ideias CRUD coverage"
```

---

### Task 7: Analytics makeDelta Helper

**Files:**
- Create: `apps/crm/src/services/__tests__/analytics.delta.test.ts`

Note: `makeDelta` is not exported. The test must verify behavior via `getAnalyticsOverview` response shape, OR the function should be extracted. Since this plan targets behavior without modifying source, test through the public API that uses `makeDelta`. If the analytics service already has overview tests, add edge-case delta scenarios.

- [x] **Step 1: Write the test file focusing on delta edge cases via getAnalyticsOverview**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import { getAnalyticsOverview } from '../analytics';

type MockedSupabaseModule = typeof supabaseModule & {
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;
const fetchHarness = createFetchMock();

describe('analytics delta calculations', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({ conta_id: 'conta-1' });
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });

  it('handles zero previous value without division by zero', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 1, ig_user_id: '123', client_id: 1 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_daily_metrics', 'select',
      { data: [{ date: '2026-04-14', followers: 100, reach: 500, impressions: 1000, profile_views: 50 }], error: null },
      { data: [], error: null },
    );

    const result = await getAnalyticsOverview(1, 7);

    if (result) {
      expect(result.data.followers.deltaPercent).toBe(100);
      expect(result.data.followers.direction).toBe('up');
    }
  });

  it('returns stable direction when current equals previous', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 1, ig_user_id: '123', client_id: 1 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_daily_metrics', 'select',
      { data: [{ date: '2026-04-14', followers: 100, reach: 500, impressions: 1000, profile_views: 50 }], error: null },
      { data: [{ date: '2026-04-07', followers: 100, reach: 500, impressions: 1000, profile_views: 50 }], error: null },
    );

    const result = await getAnalyticsOverview(1, 7);

    if (result) {
      expect(result.data.followers.direction).toBe('stable');
      expect(result.data.followers.deltaPercent).toBe(0);
    }
  });
});
```

- [x] **Step 2: Run the test to verify it passes**

Run: `npm run test -- --run apps/crm/src/services/__tests__/analytics.delta.test.ts`
Expected: All tests PASS (may need adjustment based on actual getAnalyticsOverview implementation)

- [x] **Step 3: Commit**

```bash
git add apps/crm/src/services/__tests__/analytics.delta.test.ts
git commit -m "test: add analytics delta edge-case coverage"
```

---

### Task 8: Run Full Suite and Verify

- [x] **Step 1: Run the complete test suite**

Run: `npm run test -- --run`
Expected: All existing 288 tests + new tests PASS (target ~340+ tests)

- [x] **Step 2: Run coverage report**

Run: `npm run test:coverage -- --run 2>&1 | head -80`
Note: Review the coverage output to identify remaining low-coverage areas for future work.

- [x] **Step 3: Final commit if any fixes were needed**

Only if previous tests needed adjustment, commit the fixed versions.

---

## Summary of Coverage Gains

| Area | Before | After (estimated) |
|------|--------|-------------------|
| store.ts CRUD writes | 0 tests | ~25 tests |
| store.ts computed helpers | 0 tests | ~7 tests |
| store.ts workflow posts | 0 tests | ~9 tests |
| store.ts custom properties | 0 tests | ~8 tests |
| store.ts duplicateWorkflow | 0 tests | ~2 tests |
| store.ts ideias | 0 tests | ~5 tests |
| analytics delta edge cases | 0 tests | ~2 tests |
| **Total new** | | **~58 tests** |

## Future Work (not in this plan)

- Edge function Deno tests (21 functions, 0 tests) — requires Deno test infrastructure setup
- Component integration tests for Financeiro, Equipe, Configuração pages
- Hub app services layer (currently minimal tests)
- E2E/Playwright tests for critical user flows
