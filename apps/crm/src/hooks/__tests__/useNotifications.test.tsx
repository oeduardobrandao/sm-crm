import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../store/notifications', () => ({
  getNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  dismissNotification: vi.fn(),
}));

vi.mock('../../store/notificationPrefs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/notificationPrefs')>();
  return {
    ...actual,
    getNotificationInappPrefs: vi.fn(),
  };
});

import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
} from '../../store/notifications';
import { getNotificationInappPrefs } from '../../store/notificationPrefs';
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
  it('fetches the unread count and the list (only when popoverOpen is true) once prefs are ready', async () => {
    vi.mocked(getNotificationInappPrefs).mockResolvedValue({});
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
    vi.mocked(getNotifications).mockResolvedValue([]);

    const { result, rerender } = renderHook(({ open }) => useNotifications({ popoverOpen: open }), {
      wrapper: wrapper(),
      initialProps: { open: false },
    });

    await waitFor(() => expect(result.current.unreadCount).toBe(3));
    expect(getNotifications).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  });

  it('with a muted type, filters both the list query and the unread count', async () => {
    vi.mocked(getNotificationInappPrefs).mockResolvedValue({ mention: false });
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(2);
    vi.mocked(getNotifications).mockResolvedValue([]);

    renderHook(() => useNotifications({ popoverOpen: true }), { wrapper: wrapper() });

    await waitFor(() => expect(getUnreadNotificationCount).toHaveBeenCalledWith(['mention']));
    await waitFor(() => expect(getNotifications).toHaveBeenCalledWith(50, 0, ['mention']));
  });

  it('master pause (__all__: false): empty list, count 0, no builder calls, markAllAsRead is a no-op', async () => {
    vi.mocked(getNotificationInappPrefs).mockResolvedValue({ __all__: false });

    const { result } = renderHook(() => useNotifications({ popoverOpen: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(getNotificationInappPrefs).toHaveBeenCalledTimes(1));
    // give react-query time to settle prefs into state and re-render; both queries
    // are disabled the entire time under master pause, so this window is safe.
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(getNotifications).not.toHaveBeenCalled();
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();

    act(() => {
      result.current.markAllAsRead();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(markAllNotificationsAsRead).not.toHaveBeenCalled();
  });

  it('prefs fetch error fails open: behaves exactly as today (no filter)', async () => {
    vi.mocked(getNotificationInappPrefs).mockRejectedValue(new Error('boom'));
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(5);
    vi.mocked(getNotifications).mockResolvedValue([]);

    renderHook(() => useNotifications({ popoverOpen: true }), { wrapper: wrapper() });

    await waitFor(() => expect(getUnreadNotificationCount).toHaveBeenCalledWith([]), {
      timeout: 3000,
    });
    await waitFor(() => expect(getNotifications).toHaveBeenCalledWith(50, 0, []), {
      timeout: 3000,
    });
  });

  it('markAllAsRead with a muted type passes excludeTypes through to the store', async () => {
    vi.mocked(getNotificationInappPrefs).mockResolvedValue({ mention: false });
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(1);
    vi.mocked(getNotifications).mockResolvedValue([]);
    vi.mocked(markAllNotificationsAsRead).mockResolvedValue(undefined);

    const { result } = renderHook(() => useNotifications({ popoverOpen: true }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(getUnreadNotificationCount).toHaveBeenCalledWith(['mention']));

    act(() => {
      result.current.markAllAsRead();
    });
    await waitFor(() => expect(markAllNotificationsAsRead).toHaveBeenCalledWith(['mention']));
  });
});
