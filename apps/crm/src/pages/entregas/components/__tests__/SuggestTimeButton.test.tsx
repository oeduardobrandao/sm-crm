import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_best_times: true } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
const counts = Array.from({ length: 7 }, () => Array(24).fill(0));
heatmap[2][18] = 6; // Wednesday 18h (São Paulo)
counts[2][18] = 5;

vi.mock('../../../../services/analytics', () => ({
  getBestPostingTimes: vi.fn(async () => ({
    data: {
      heatmap,
      counts,
      topSlots: [{ day: 2, hour: 18, value: 6, postCount: 5 }],
      totalPosts: 5,
      labels_days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'],
      labels_hours: Array.from({ length: 24 }, (_, i) => `${i}h`),
      timezone: 'America/Sao_Paulo',
    },
    fromCache: false,
    fetchedAt: '2026-09-30T00:00:00Z',
  })),
}));

import { toast } from 'sonner';
import { SuggestTimeButton } from '../SuggestTimeButton';

function renderButton(onPick: (d: Date) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SuggestTimeButton clientId={1} value={undefined} onPick={onPick} />
    </QueryClientProvider>,
  );
}

describe('SuggestTimeButton', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Wednesday 17:40 in São Paulo.
    vi.setSystemTime(new Date('2026-09-30T20:40:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the São Paulo instant of the picked slot', async () => {
    const onPick = vi.fn();
    renderButton(onPick);
    fireEvent.click(await screen.findByRole('button', { name: /sugerir horário/i }));
    fireEvent.click(await screen.findByRole('button', { name: /quarta-feira/i }));
    expect(onPick).toHaveBeenCalledWith(new Date('2026-09-30T21:00:00Z'));
  });

  it('refuses a suggestion that went stale while the list was open', async () => {
    const onPick = vi.fn();
    renderButton(onPick);
    fireEvent.click(await screen.findByRole('button', { name: /sugerir horário/i }));
    const row = await screen.findByRole('button', { name: /quarta-feira, 30\/09/i });

    // 17:50 in São Paulo: the 18h slot is now inside the 15-minute lead window.
    vi.setSystemTime(new Date('2026-09-30T20:50:00Z'));
    fireEvent.click(row);

    expect(onPick).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /quarta-feira, 07\/10/i })).toBeTruthy(),
    );
  });
});
