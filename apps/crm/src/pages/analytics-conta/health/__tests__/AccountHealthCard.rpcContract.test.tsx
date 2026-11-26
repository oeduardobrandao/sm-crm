// Contract test: raw `ig_account_health` output captured from a local Supabase (clean reset,
// migrations 20261201000001..03, 19 market seed rows) goes through the real data-layer mapper
// and the card. Guards against the mocked shapes drifting from what Postgres actually returns
// (untrimmed numerics, `0.5000`, integer cuts, null metrics for an account with no posts).
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase');

import * as supabaseModule from '@/lib/supabase';
import { getAccountHealth } from '@/services/analytics';
import { AccountHealthCard } from '../AccountHealthCard';
import rpc12 from './fixtures/rpc-12posts.json';
import rpc0 from './fixtures/rpc-0posts.json';

type MockedSupabaseModule = typeof supabaseModule & {
  __queueSupabaseRpc: (name: string, ...responses: { data?: unknown; error?: unknown }[]) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};
const mocked = supabaseModule as MockedSupabaseModule;

describe('AccountHealthCard with the real RPC payload', () => {
  beforeEach(() => {
    mocked.__resetSupabaseMock();
    mocked.__setCurrentProfile({ conta_id: 'conta-1' });
  });

  it('renders all four metrics against the market seed', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', { data: rpc12, error: null });
    const health = await getAccountHealth(1);
    expect(health?.band).toBe('5k_20k');
    expect(Object.keys(health?.benchmarks ?? {})).toHaveLength(4);
    for (const b of Object.values(health?.benchmarks ?? {})) expect(b?.cuts).toHaveLength(99);

    render(<AccountHealthCard health={health} isLoading={false} onOpenPost={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais' }));
    expect(
      screen.getByText(/Somando as 4 métricas, você está à frente de cerca de \d+%/),
    ).toBeInTheDocument();
    expect(screen.getByText('1,13%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(
      screen.getByText(
        '†Estimativa de mercado para contas de 5 mil a 20 mil seguidores, a partir de estudos públicos com métricas parecidas.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/teve 2,2x o resultado normal/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Sem dados suficientes|Ainda sem referência/),
    ).not.toBeInTheDocument();
  });

  it('shows the empty state for a visible account with no posts', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', { data: rpc0, error: null });
    const health = await getAccountHealth(1);
    render(<AccountHealthCard health={health} isLoading={false} onOpenPost={vi.fn()} />);
    expect(screen.getByText('Ainda não dá para comparar')).toBeInTheDocument();
  });
});
