import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationPopover from '../NotificationPopover';
import { VidroToolbarHarness } from '@/test/vidroToolbar';
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
    render(
      <NotificationPopover
        notifications={[]}
        isLoading={false}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
  });

  it('shows a skeleton instead of the empty state while loading', () => {
    render(
      <NotificationPopover
        notifications={[]}
        isLoading={true}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('crm-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma notificação')).not.toBeInTheDocument();
  });

  it('renders notification rows when present', () => {
    render(
      <NotificationPopover
        notifications={[sampleNotif]}
        isLoading={false}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Post aprovado')).toBeInTheDocument();
  });

  it('toggles between "all" and "unread" filter', () => {
    const read: Notification = { ...sampleNotif, id: '2', read_at: new Date().toISOString() };
    render(
      <NotificationPopover
        notifications={[sampleNotif, read]}
        isLoading={false}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={vi.fn()}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Apenas não lidas/ }));
    expect(screen.getAllByRole('button', { name: /Post aprovado/ })).toHaveLength(1);
  });

  it('calls onMarkAllAsRead when the mark-all button is clicked', () => {
    const onMarkAllAsRead = vi.fn();
    render(
      <NotificationPopover
        notifications={[sampleNotif]}
        isLoading={false}
        onMarkAsRead={vi.fn()}
        onMarkAllAsRead={onMarkAllAsRead}
        onDismiss={vi.fn()}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Marcar todas como lidas/ }));
    expect(onMarkAllAsRead).toHaveBeenCalled();
  });
});

describe('NotificationPopover under the Vidro look', () => {
  const popover = (
    <NotificationPopover
      notifications={[]}
      isLoading={false}
      onMarkAsRead={vi.fn()}
      onMarkAllAsRead={vi.fn()}
      onDismiss={vi.fn()}
      onNavigate={vi.fn()}
      onClose={vi.fn()}
    />
  );

  it('keeps its own card inline styles without the Vidro shell', () => {
    render(popover);
    const card = screen.getByRole('dialog', { name: 'Notificações' });
    expect(card.getAttribute('style')).toMatchInlineSnapshot(
      `"width: min(380px * , * calc(100vw - 2rem)); max-height: 480px; background: var(--surface-main); border: 1px solid var(--border-color); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column;"`,
    );
  });

  it('drops the card background, border, radius and shadow under the Vidro shell', () => {
    // The bell's PopoverContent carries the menu glass (overlays.css); a second frame would nest.
    render(<VidroToolbarHarness>{popover}</VidroToolbarHarness>);
    const card = screen.getByRole('dialog', { name: 'Notificações' });
    expect(card.style.background).toBe('');
    expect(card.style.border).toBe('');
    expect(card.style.borderRadius).toBe('');
    expect(card.style.boxShadow).toBe('');
    expect(card.style.overflow).toBe('hidden');
    expect(card.style.maxHeight).toBe('480px');
    expect(card.style.display).toBe('flex');
  });
});
