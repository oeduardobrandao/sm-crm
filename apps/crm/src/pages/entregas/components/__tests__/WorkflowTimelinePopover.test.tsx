import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WorkflowTimelinePopover } from '../WorkflowTimelinePopover';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getWorkflowEvents: vi.fn(),
  };
});

describe('WorkflowTimelinePopover', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockReset();
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('does not fetch workflow events until the popover is opened', async () => {
    const store = await import('@/store');
    render(<WorkflowTimelinePopover workflowId={42} />);

    expect(store.getWorkflowEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Histórico do fluxo'));

    await waitFor(() => {
      expect(store.getWorkflowEvents).toHaveBeenCalledWith(42);
    });
  });

  it('shows the "Histórico" title once opened', async () => {
    render(<WorkflowTimelinePopover workflowId={42} />);

    fireEvent.click(screen.getByTitle('Histórico do fluxo'));

    await waitFor(() => {
      expect(screen.getByText('Histórico')).toBeInTheDocument();
    });
  });

  it('shows the empty state instead of a blank box when the workflow has no history yet', async () => {
    // No backfill ships with this feature, so every pre-existing workflow
    // has zero events on day one — this must read as "no history yet", not
    // as a broken/empty popover.
    render(<WorkflowTimelinePopover workflowId={42} />);

    fireEvent.click(screen.getByTitle('Histórico do fluxo'));

    await waitFor(() => {
      expect(screen.getByText('Nenhum evento registrado ainda.')).toBeInTheDocument();
    });
  });
});
