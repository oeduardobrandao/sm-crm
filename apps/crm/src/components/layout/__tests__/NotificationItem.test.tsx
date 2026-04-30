import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationItem from '../NotificationItem';
import type { Notification } from '../../../store';

const baseNotif: Notification = {
  id: '1',
  workspace_id: 'ws',
  user_id: 'u',
  type: 'post_approved',
  metadata: { client_name: 'Foo', post_title: 'Bar' },
  link: '/workflows/1/posts/2',
  read_at: null,
  dismissed_at: null,
  created_at: new Date().toISOString(),
};

describe('NotificationItem', () => {
  it('renders title and body from metadata', () => {
    render(<NotificationItem notification={baseNotif} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText('Post aprovado')).toBeInTheDocument();
    expect(screen.getByText(/Foo — Bar/)).toBeInTheDocument();
  });

  it('shows the unread dot when read_at is null', () => {
    render(<NotificationItem notification={baseNotif} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByTestId('notification-unread-dot')).toBeInTheDocument();
  });

  it('hides the unread dot when read_at is set', () => {
    render(<NotificationItem notification={{ ...baseNotif, read_at: new Date().toISOString() }} onMarkAsRead={vi.fn()} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('notification-unread-dot')).toBeNull();
  });

  it('calls onMarkAsRead and onNavigate when clicked with a link', () => {
    const onMarkAsRead = vi.fn();
    const onNavigate  = vi.fn();
    render(<NotificationItem notification={baseNotif} onMarkAsRead={onMarkAsRead} onDismiss={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Post aprovado/ }));
    expect(onMarkAsRead).toHaveBeenCalledWith('1');
    expect(onNavigate).toHaveBeenCalledWith('/workflows/1/posts/2');
  });

  it('only marks as read (no navigate) when link is null', () => {
    const onMarkAsRead = vi.fn();
    const onNavigate  = vi.fn();
    render(<NotificationItem notification={{ ...baseNotif, link: null, type: 'member_removed', metadata: { user_name: 'X' } }} onMarkAsRead={onMarkAsRead} onDismiss={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Membro removido/ }));
    expect(onMarkAsRead).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('calls onDismiss when the X is clicked, without firing onMarkAsRead', () => {
    const onMarkAsRead = vi.fn();
    const onDismiss    = vi.fn();
    render(<NotificationItem notification={baseNotif} onMarkAsRead={onMarkAsRead} onDismiss={onDismiss} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Dispensar/ }));
    expect(onDismiss).toHaveBeenCalledWith('1');
    expect(onMarkAsRead).not.toHaveBeenCalled();
  });
});
