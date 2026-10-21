import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { isToday, isYesterday } from 'date-fns';
import { Bell, X } from 'lucide-react';
import type { Notification } from '../../store';
import { useNotifications } from '../../hooks/useNotifications';
import { ListSkeleton } from '@/components/ui/skeletons';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useSheetHistory } from '@/components/mobile/useSheetHistory';
import { useReturnFocus } from '@/components/mobile/useReturnFocus';
import NotificationList from './NotificationList';

type Filter = 'all' | 'unread';

/** Hoje / Ontem / Anteriores, newest first (the list arrives newest first). */
export function groupNotificationsByDay(
  notifications: Notification[],
): { label: string; items: Notification[] }[] {
  const groups: { label: string; items: Notification[] }[] = [];
  for (const n of notifications) {
    const date = new Date(n.created_at);
    const label = isToday(date) ? 'Hoje' : isYesterday(date) ? 'Ontem' : 'Anteriores';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

/**
 * Bell for the phone shell header (AUDIT #1: phones had no notification list). Opens a
 * full-screen list on the same data and actions as the desktop popover.
 */
export function PhoneNotificationsButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead, dismiss } =
    useNotifications({ popoverOpen: open });
  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <>
      <PhoneIconButton
        ref={buttonRef}
        label={unreadCount > 0 ? `Notificações, ${countLabel} não lidas` : 'Notificações'}
        badge={unreadCount}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="phone-notifications-button"
        onClick={() => setOpen(true)}
      >
        <Bell aria-hidden="true" />
      </PhoneIconButton>
      <PhoneNotificationsScreen
        open={open}
        onOpenChange={setOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        isLoading={isLoading}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={() => markAllAsRead()}
        onDismiss={dismiss}
        returnFocusRef={buttonRef}
      />
    </>
  );
}

export interface PhoneNotificationsScreenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDismiss: (id: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Full-screen notification list (NativeNotificacoes mockup). Back closes it. */
export function PhoneNotificationsScreen({
  open,
  onOpenChange,
  notifications,
  unreadCount,
  isLoading,
  onMarkAsRead,
  onMarkAllAsRead,
  onDismiss,
  returnFocusRef,
}: PhoneNotificationsScreenProps) {
  const navigate = useNavigate();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const { closeThen } = useSheetHistory(open, close);
  const onCloseAutoFocus = useReturnFocus(open, returnFocusRef);
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(
    () => (filter === 'unread' ? notifications.filter((n) => !n.read_at) : notifications),
    [filter, notifications],
  );
  const groups = useMemo(() => groupNotificationsByDay(visible), [visible]);
  // Close first so the link replaces this screen in history instead of stacking on it.
  const handleNavigate = (link: string) => closeThen(() => navigate(link));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="phone-kit phone-notifications"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="phone-notifications__scroll">
            <header className="phone-large-title">
              <div className="phone-large-title__bar">
                <div className="phone-large-title__leading">
                  <DialogPrimitive.Close asChild>
                    <PhoneIconButton label="Fechar">
                      <X aria-hidden="true" />
                    </PhoneIconButton>
                  </DialogPrimitive.Close>
                </div>
                <div className="phone-large-title__trailing">
                  <button
                    type="button"
                    className="phone-notifications__text-button"
                    disabled={unreadCount === 0}
                    onClick={onMarkAllAsRead}
                  >
                    Ler tudo
                  </button>
                </div>
              </div>
              <DialogPrimitive.Title className="phone-large-title__title">
                Notificações
              </DialogPrimitive.Title>
              <SegmentedControl
                aria-label="Mostrar"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Todas' },
                  { value: 'unread', label: 'Não lidas' },
                ]}
              />
            </header>

            {isLoading ? (
              <div className="phone-notifications__card">
                <ListSkeleton rows={4} avatar style={{ padding: '0.75rem 1rem' }} />
              </div>
            ) : groups.length === 0 ? (
              <p className="phone-notifications__empty">
                {filter === 'unread' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.label}>
                  <h3 className="phone-notifications__day">{group.label}</h3>
                  <div className="phone-notifications__card">
                    <NotificationList
                      notifications={group.items}
                      onMarkAsRead={onMarkAsRead}
                      onDismiss={onDismiss}
                      onNavigate={handleNavigate}
                      scroll={false}
                    />
                  </div>
                </section>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
