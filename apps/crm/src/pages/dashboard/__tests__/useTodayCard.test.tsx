import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem, AgendaScope } from '../todayAgenda';

const { agenda } = vi.hoisted(() => ({ agenda: { current: null as unknown } }));
vi.mock('../useTodayAgenda', () => ({ useTodayAgenda: () => agenda.current }));

import { useTodayCard } from '../useTodayCard';

const item = (key: string, responsavelId: number | null): AgendaItem =>
  ({
    key,
    responsavel: responsavelId == null ? null : { id: responsavelId, nome: 'X' },
  }) as AgendaItem;

function setAgenda(scope: AgendaScope = 'workspace', membroId: number | null = 10) {
  agenda.current = {
    status: 'ready',
    scope,
    membroId,
    now: new Date(2026, 10, 18, 10, 0, 0),
    buckets: {
      atrasado: [item('a', 10), item('b', 20), item('c', null)],
      hoje: [item('d', 20)],
      proximos: [item('e', 10)],
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => setAgenda());

describe('useTodayCard onlyMine ("Só meus" on the phone Início)', () => {
  it('keeps the whole agency agenda by default', () => {
    const { result } = renderHook(() => useTodayCard(), { wrapper });
    expect(result.current.counts).toEqual({ atrasado: 3, hoje: 1, proximos: 1 });
    expect(result.current.total).toBe(5);
    expect(result.current.summary).not.toContain('atribuídos a você');
  });

  it("narrows buckets, counts and summary to the user's items", () => {
    const { result } = renderHook(() => useTodayCard({ onlyMine: true }), { wrapper });
    expect(result.current.buckets.atrasado.map((i) => i.key)).toEqual(['a']);
    expect(result.current.buckets.hoje).toEqual([]);
    expect(result.current.counts).toEqual({ atrasado: 1, hoje: 0, proximos: 1 });
    expect(result.current.total).toBe(2);
    expect(result.current.summary).toContain('1 atrasados, 0 para hoje');
    expect(result.current.summary).toContain('atribuídos a você');
  });

  it('shows nothing when the user has no linked membro', () => {
    setAgenda('workspace', null);
    const { result } = renderHook(() => useTodayCard({ onlyMine: true }), { wrapper });
    expect(result.current.total).toBe(0);
  });

  it("is a no-op when the scope is already 'mine' (agents)", () => {
    setAgenda('mine');
    const { result } = renderHook(() => useTodayCard({ onlyMine: true }), { wrapper });
    expect(result.current.total).toBe(5);
  });
});
