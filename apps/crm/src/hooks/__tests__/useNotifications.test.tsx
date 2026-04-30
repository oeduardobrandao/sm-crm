import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../store', () => ({
  getNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  dismissNotification: vi.fn(),
}));

import { getNotifications, getUnreadNotificationCount } from '../../store';
import { useNotifications } from '../useNotifications';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useNotifications', () => {
  it('fetches the unread count immediately and the list only when popoverOpen is true', async () => {
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
    vi.mocked(getNotifications).mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ open }) => useNotifications({ popoverOpen: open }),
      { wrapper: wrapper(), initialProps: { open: false } },
    );

    await waitFor(() => expect(result.current.unreadCount).toBe(3));
    expect(getNotifications).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  });
});
