import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationPopover from '../NotificationPopover';
import type { Notification } from '../../../store';

const sampleNotif: Notification = {
  id: '1',
  workspace_id: 'ws',
  user_id: 'u',
  type: 'post_approved',
  metadata: { client_name: 'Foo', post_title: 'Bar' },
  link: '/x',
  read_at: null,
  dismissed_at: null,
  created_at: new Date().toISOString(),
};

describe('NotificationPopover', () => {
  it('shows the empty state when no notifications', () => {
    render(<NotificationPopover
      notifications={[]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
  });

  it('renders notification rows when present', () => {
    render(<NotificationPopover
      notifications={[sampleNotif]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Post aprovado')).toBeInTheDocument();
  });

  it('toggles between "all" and "unread" filter', () => {
    const read: Notification = { ...sampleNotif, id: '2', read_at: new Date().toISOString() };
    render(<NotificationPopover
      notifications={[sampleNotif, read]} onMarkAsRead={vi.fn()} onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Apenas não lidas/ }));
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(1);
  });

  it('calls onMarkAllAsRead when the mark-all button is clicked', () => {
    const onMarkAllAsRead = vi.fn();
    render(<NotificationPopover
      notifications={[sampleNotif]} onMarkAsRead={vi.fn()} onMarkAllAsRead={onMarkAllAsRead}
      onDismiss={vi.fn()} onNavigate={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Marcar todas como lidas/ }));
    expect(onMarkAllAsRead).toHaveBeenCalled();
  });
});
