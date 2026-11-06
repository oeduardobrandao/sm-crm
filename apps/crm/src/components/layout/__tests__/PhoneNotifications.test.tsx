import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '../../../store';
import { getNotificationDisplay } from '../../../lib/notification-config';

vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

import { useNotifications } from '../../../hooks/useNotifications';
import { PhoneNotificationsButton, groupNotificationsByDay } from '../PhoneNotifications';

const mockedUseNotifications = vi.mocked(useNotifications);

const DAY = 24 * 60 * 60 * 1000;

function notif(
  id: string,
  ageMs: number,
  read = false,
  link: string | null = '/entregas',
): Notification {
  return {
    id,
    workspace_id: 'ws',
    user_id: 'u',
    type: 'post_approved',
    metadata: { client_name: 'Café Aurora', post_title: `Post ${id}` },
    link,
    read_at: read ? new Date().toISOString() : null,
    dismissed_at: null,
    created_at: new Date(Date.now() - ageMs).toISOString(),
  };
}

const title = getNotificationDisplay('post_approved', {}).title;

function setNotifications(
  notifications: Notification[],
  overrides: Partial<ReturnType<typeof useNotifications>> = {},
) {
  const value = {
    notifications,
    unreadCount: notifications.filter((n) => !n.read_at).length,
    isLoading: false,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
  mockedUseNotifications.mockReturnValue(value as never);
  return value;
}

function Path() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PhoneNotificationsButton />
              <Path />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('groupNotificationsByDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups newest-first rows into Hoje, Ontem and Anteriores', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 10, 12, 0) });
    const groups = groupNotificationsByDay([
      notif('a', 0),
      notif('b', 60_000),
      notif('c', DAY),
      notif('d', 5 * DAY),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Hoje', 'Ontem', 'Anteriores']);
    expect(groups.map((g) => g.items.map((n) => n.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

describe('PhoneNotificationsButton', () => {
  beforeEach(() => {
    mockedUseNotifications.mockReset();
  });

  it('shows the unread count on the bell and in its name', () => {
    setNotifications([notif('a', 0), notif('b', 0), notif('c', 0, true)]);
    renderBell();
    const bell = screen.getByRole('button', { name: 'Notificações, 2 não lidas' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell.querySelector('.phone-icon-button__badge')).toHaveTextContent('2');
  });

  it('opens a full-screen list that loads only while open', () => {
    setNotifications([notif('a', 0)]);
    renderBell();
    expect(mockedUseNotifications).toHaveBeenLastCalledWith({ popoverOpen: false });
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(mockedUseNotifications).toHaveBeenLastCalledWith({ popoverOpen: true });
    const screenDialog = screen.getByRole('dialog', { name: 'Notificações' });
    expect(within(screenDialog).getByRole('heading', { name: 'Hoje' })).toBeInTheDocument();
    expect(within(screenDialog).getByRole('button', { name: title })).toBeInTheDocument();
  });

  it('marks everything read with "Ler tudo", disabled when nothing is unread', () => {
    const value = setNotifications([notif('a', 0)]);
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ler tudo' }));
    expect(value.markAllAsRead).toHaveBeenCalled();
  });

  it('disables "Ler tudo" with no unread notifications', () => {
    setNotifications([notif('a', 0, true)]);
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByRole('button', { name: 'Ler tudo' })).toBeDisabled();
  });

  it('filters to unread with the segmented control and shows an empty state', () => {
    setNotifications([notif('a', 0, true)]);
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Não lidas' }));
    expect(screen.queryByRole('button', { name: title })).toBeNull();
    expect(screen.getByText('Nenhuma notificação não lida')).toBeInTheDocument();
  });

  it('opening a notification marks it read, closes the list and navigates', async () => {
    const value = setNotifications([notif('a', 0, false, '/entregas?post=9')]);
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(value.markAsRead).toHaveBeenCalledWith('a');
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/entregas'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with Fechar and returns focus to the bell', async () => {
    setNotifications([]);
    renderBell();
    const bell = screen.getByRole('button', { name: 'Notificações' });
    bell.focus();
    fireEvent.click(bell);
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(bell).toHaveFocus());
  });

  it('shows a skeleton while loading', () => {
    setNotifications([], { isLoading: true });
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.queryByText('Nenhuma notificação')).toBeNull();
  });
});
