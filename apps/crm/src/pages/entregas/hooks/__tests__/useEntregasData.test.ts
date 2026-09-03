import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { WorkflowEtapa } from '../../../../store';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../useEntregasData';

// useEntregasData reads `clienteAvatars`/`hubTokens` via two `supabase.from(...)`
// calls made DIRECTLY (bypassing the mocked store module below), and
// `getWorkspaceSlug`/`getWorkflowRevisaoInternaCounts`/
// `getWorkflowAwaitingClientePostsCounts` (never overridden in the store mock
// either) reach `supabase` internally too. Without this, all of those hit the
// REAL `@supabase/supabase-js` client against the fake `VITE_SUPABASE_URL`
// from vitest.config.ts — a genuine (if failing) network call whose settle
// time is environment-dependent (fails fast on a sandbox with no DNS, but
// takes real round-trip time wherever the runner has actual internet access).
// That was the CI-only flake in "keeps cards and the lookup maps stable...":
// those two queries are dependencies of the `cards` useMemo, and on a slower/
// real-network run they could settle for the FIRST time in the gap between
// this file's `waitFor` (which never checked them) and the assertion,
// producing a legitimately new-but-deep-equal `cards` array — not a memo bug.
// Auto-mocked via apps/crm/src/lib/__mocks__/supabase.ts (test/shared/
// supabaseMock.ts's default `{ data: [], error: null }` per table is exactly
// right here — nothing needs to be queued).
vi.mock('../../../../lib/supabase');

// ── Mock store ──────────────────────────────────────────────────────────────

vi.mock('../../../../store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getWorkflows: vi.fn().mockResolvedValue([
      { id: 1, cliente_id: 10, titulo: 'WF-1', status: 'ativo', etapa_atual: 0, recorrente: false },
      { id: 2, cliente_id: 11, titulo: 'WF-2', status: 'ativo', etapa_atual: 0, recorrente: false },
    ]),
    getClientes: vi.fn().mockResolvedValue([
      {
        id: 10,
        nome: 'Cliente A',
        sigla: 'CA',
        cor: '#f00',
        plano: 'basic',
        email: '',
        telefone: '',
        status: 'ativo',
        valor_mensal: 1000,
      },
      {
        id: 11,
        nome: 'Cliente B',
        sigla: 'CB',
        cor: '#0f0',
        plano: 'pro',
        email: '',
        telefone: '',
        status: 'ativo',
        valor_mensal: 2000,
      },
    ]),
    getMembros: vi.fn().mockResolvedValue([]),
    getWorkflowTemplates: vi.fn().mockResolvedValue([]),
    getAllActiveEtapas: vi.fn().mockResolvedValue([
      {
        id: 100,
        workflow_id: 1,
        ordem: 0,
        nome: 'Etapa 1',
        tipo: 'padrao',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        status: 'ativo',
        iniciado_em: '2026-04-01T00:00:00Z',
      },
      {
        id: 200,
        workflow_id: 2,
        ordem: 0,
        nome: 'Etapa 1',
        tipo: 'padrao',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        status: 'ativo',
        iniciado_em: '2026-04-01T00:00:00Z',
      },
    ]),
    getDeadlineInfo: vi
      .fn()
      .mockReturnValue({ estourado: false, urgente: false, diasRestantes: 3, resumo: 'em dia' }),
    getWorkflowPostsCounts: vi.fn().mockResolvedValue(
      new Map<number, number>([
        [1, 5],
        [2, 3],
      ]),
    ),
    getWorkflowApprovedPostsCounts: vi.fn().mockResolvedValue(new Map<number, number>()),
    getWorkflowClearedClientePostsCounts: vi.fn().mockResolvedValue(new Map<number, number>()),
    getWorkflowPostResponsaveis: vi.fn().mockResolvedValue(
      new Map<number, number[]>([
        [1, [10, 20]],
        [2, [10]],
      ]),
    ),
  };
});

vi.mock('../../../../services/postMedia', () => ({
  getWorkflowCovers: vi.fn().mockResolvedValue(new Map()),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEtapa(overrides: Partial<WorkflowEtapa>): WorkflowEtapa {
  return {
    id: 1,
    workflow_id: 1,
    ordem: 0,
    nome: 'Etapa',
    tipo: 'interna',
    prazo_dias: 1,
    tipo_prazo: 'corridos',
    status: 'pendente',
    ...overrides,
  } as WorkflowEtapa;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

// ── Pure-function tests (unchanged) ─────────────────────────────────────────

describe('computeDeadlineDate', () => {
  it('adds calendar days for tipo_prazo=corridos', () => {
    const start = '2026-04-10T00:00:00Z';
    const result = computeDeadlineDate(start, 3, 'corridos');
    expect(result.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('skips weekends when tipo_prazo=uteis', () => {
    // 2026-04-10 is a Friday. Adding 1 business day should land on Monday 2026-04-13.
    const start = '2026-04-10T12:00:00Z';
    const result = computeDeadlineDate(start, 1, 'uteis');
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-13');
  });

  it('returns the start date unchanged when prazo_dias is zero', () => {
    const start = '2026-04-10T00:00:00Z';
    expect(computeDeadlineDate(start, 0, 'corridos').toISOString()).toBe(
      start.replace('Z', '.000Z'),
    );
    expect(computeDeadlineDate(start, 0, 'uteis').toISOString()).toBe(start.replace('Z', '.000Z'));
  });
});

describe('computeWorkflowDeadlineDate', () => {
  it('returns null when the active etapa has no iniciado_em', () => {
    const active = makeEtapa({ id: 1, ordem: 0 });
    const etapas = [active];
    expect(computeWorkflowDeadlineDate(etapas, active)).toBeNull();
  });

  it('returns null when the active etapa is not in the list', () => {
    const active = makeEtapa({ id: 99, ordem: 0, iniciado_em: '2026-04-10T00:00:00Z' });
    const other = makeEtapa({ id: 1, ordem: 0 });
    expect(computeWorkflowDeadlineDate([other], active)).toBeNull();
  });

  it('chains remaining etapas starting from the active one', () => {
    const etapas = [
      makeEtapa({ id: 1, ordem: 0, prazo_dias: 1, tipo_prazo: 'corridos' }),
      makeEtapa({
        id: 2,
        ordem: 1,
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        iniciado_em: '2026-04-10T00:00:00Z',
        status: 'ativo',
      }),
      makeEtapa({ id: 3, ordem: 2, prazo_dias: 3, tipo_prazo: 'corridos' }),
    ];
    const active = etapas[1];
    const deadline = computeWorkflowDeadlineDate(etapas, active);
    // start (Apr 10) + 2 (active) + 3 (next) = Apr 15
    expect(deadline?.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('sorts etapas by ordem before chaining so order in the input array does not matter', () => {
    const active = makeEtapa({
      id: 2,
      ordem: 1,
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      iniciado_em: '2026-04-10T00:00:00Z',
      status: 'ativo',
    });
    const tail = makeEtapa({ id: 3, ordem: 2, prazo_dias: 1, tipo_prazo: 'corridos' });
    const head = makeEtapa({ id: 1, ordem: 0, prazo_dias: 5, tipo_prazo: 'corridos' });

    const shuffled = [tail, active, head];
    const deadline = computeWorkflowDeadlineDate(shuffled, active);
    expect(deadline?.toISOString().slice(0, 10)).toBe('2026-04-13');
  });
});

// ── Hook integration test ───────────────────────────────────────────────────

describe('useEntregasData', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const store = await import('../../../../store');
    (store.getWorkflows as any).mockResolvedValue([
      { id: 1, cliente_id: 10, titulo: 'WF-1', status: 'ativo', etapa_atual: 0, recorrente: false },
      { id: 2, cliente_id: 11, titulo: 'WF-2', status: 'ativo', etapa_atual: 0, recorrente: false },
    ]);
    (store.getClientes as any).mockResolvedValue([
      {
        id: 10,
        nome: 'Cliente A',
        sigla: 'CA',
        cor: '#f00',
        plano: 'basic',
        email: '',
        telefone: '',
        status: 'ativo',
        valor_mensal: 1000,
      },
      {
        id: 11,
        nome: 'Cliente B',
        sigla: 'CB',
        cor: '#0f0',
        plano: 'pro',
        email: '',
        telefone: '',
        status: 'ativo',
        valor_mensal: 2000,
      },
    ]);
    (store.getMembros as any).mockResolvedValue([]);
    (store.getWorkflowTemplates as any).mockResolvedValue([]);
    (store.getAllActiveEtapas as any).mockResolvedValue([
      {
        id: 100,
        workflow_id: 1,
        ordem: 0,
        nome: 'Etapa 1',
        tipo: 'padrao',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        status: 'ativo',
        iniciado_em: '2026-04-01T00:00:00Z',
      },
      {
        id: 200,
        workflow_id: 2,
        ordem: 0,
        nome: 'Etapa 1',
        tipo: 'padrao',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        status: 'ativo',
        iniciado_em: '2026-04-01T00:00:00Z',
      },
    ]);
    (store.getDeadlineInfo as any).mockReturnValue({
      estourado: false,
      urgente: false,
      diasRestantes: 3,
      resumo: 'em dia',
    });
    (store.getWorkflowPostsCounts as any).mockResolvedValue(
      new Map<number, number>([
        [1, 5],
        [2, 3],
      ]),
    );
    (store.getWorkflowApprovedPostsCounts as any).mockResolvedValue(new Map<number, number>());
    (store.getWorkflowClearedClientePostsCounts as any).mockResolvedValue(
      new Map<number, number>(),
    );
    (store.getWorkflowPostResponsaveis as any).mockResolvedValue(
      new Map<number, number[]>([
        [1, [10, 20]],
        [2, [10]],
      ]),
    );

    const postMedia = await import('../../../../services/postMedia');
    (postMedia.getWorkflowCovers as any).mockResolvedValue(new Map());
  });

  it('returns postsCounts as a Map with correct workflow counts', async () => {
    // Dynamic import so vi.mock has taken effect before the module is loaded
    const { useEntregasData } = await import('../useEntregasData');

    const { result } = renderHook(() => useEntregasData(), {
      wrapper: createWrapper().Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.postsCounts.size).toBe(2);
    });

    const { postsCounts } = result.current;
    expect(postsCounts).toBeInstanceOf(Map);
    expect(postsCounts.get(1)).toBe(5);
    expect(postsCounts.get(2)).toBe(3);
  });

  it('returns postResponsaveis as a Map with per-workflow responsavel arrays', async () => {
    const { useEntregasData } = await import('../useEntregasData');

    const { result } = renderHook(() => useEntregasData(), {
      wrapper: createWrapper().Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.postResponsaveis.size).toBe(2);
    });

    const { postResponsaveis } = result.current;
    expect(postResponsaveis).toBeInstanceOf(Map);
    expect(postResponsaveis.get(1)).toEqual([10, 20]);
    expect(postResponsaveis.get(2)).toEqual([10]);
  });

  // EntregasPage keys its filteredCards useMemo (and, through it, every chart
  // dataset in the Visão geral) on these. A fresh array or Map per render makes
  // that memo unreachable and re-animates the whole cockpit on any state change.
  it('keeps cards and the lookup maps stable across a re-render with no new data', async () => {
    const { useEntregasData } = await import('../useEntregasData');

    const { Wrapper, queryClient } = createWrapper();
    const { result, rerender } = renderHook(() => useEntregasData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.cards.length).toBe(2);
      expect(result.current.postResponsaveis.size).toBe(2);
      // `cards` also depends on covers/clienteAvatars/hubTokens/workspaceSlug
      // (see useEntregasData.ts), none of which the hook exposes on its return
      // value — isLoading/cards.length/postResponsaveis above don't cover them.
      // Waiting for the whole QueryClient to go idle closes that gap: capturing
      // `before` while a query this memo depends on is still in flight is what
      // let a later, legitimate first-settlement race as a "new but deep-equal
      // cards array" flake (CI-only, see the `lib/supabase` mock above).
      expect(queryClient.isFetching()).toBe(0);
    });

    const before = result.current;
    rerender();

    expect(result.current.cards).toBe(before.cards);
    expect(result.current.activeWorkflows).toBe(before.activeWorkflows);
    expect(result.current.postResponsaveis).toBe(before.postResponsaveis);
    expect(result.current.postsCounts).toBe(before.postsCounts);
    expect(result.current.etapasMap).toBe(before.etapasMap);
  });

  it('serves stable empty fallbacks while the queries have not resolved', async () => {
    const { useEntregasData } = await import('../useEntregasData');

    const { result, rerender } = renderHook(() => useEntregasData(), {
      wrapper: createWrapper().Wrapper,
    });

    // First commit: nothing has resolved yet, so every value is a fallback.
    const before = result.current;
    expect(before.cards).toEqual([]);
    rerender();

    expect(result.current.cards).toBe(before.cards);
    expect(result.current.clientes).toBe(before.clientes);
    expect(result.current.postResponsaveis).toBe(before.postResponsaveis);
  });

  it('returns an empty Map when no workflow IDs are available', async () => {
    // Override getWorkflows to return no active workflows
    const store = await import('../../../../store');
    (store.getWorkflows as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { useEntregasData } = await import('../useEntregasData');

    const { result } = renderHook(() => useEntregasData(), {
      wrapper: createWrapper().Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const { postsCounts } = result.current;
    expect(postsCounts).toBeInstanceOf(Map);
    expect(postsCounts.size).toBe(0);
  });
});
