import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

import { useNotifications } from '../../../hooks/useNotifications';
import NotificationBell from '../NotificationBell';

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationBell', () => {
  it('shows a numeric badge when unreadCount > 0', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 3, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the badge at 99+', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 250, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show a badge when unreadCount is 0', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 0, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('opens the popover on click', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [], unreadCount: 0, isLoading: false,
      markAsRead: vi.fn(), markAllAsRead: vi.fn(), dismiss: vi.fn(),
    });
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
  });
});
