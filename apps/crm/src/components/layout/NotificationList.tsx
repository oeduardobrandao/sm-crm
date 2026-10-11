import type { Notification } from '../../store';
import NotificationItem from './NotificationItem';

export interface NotificationListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
  /** The list scrolls inside a fixed height (the desktop popover). Off when the
   *  container scrolls instead, as on the phone's full-screen list. */
  scroll?: boolean;
}

export default function NotificationList({
  notifications,
  onMarkAsRead,
  onDismiss,
  onNavigate,
  scroll = true,
}: NotificationListProps) {
  return (
    <div style={scroll ? { maxHeight: 'calc(480px - 56px)', overflowY: 'auto' } : undefined}>
      {notifications.map((n) => (
        <NotificationItem
          key={n.id}
          notification={n}
          onMarkAsRead={onMarkAsRead}
          onDismiss={onDismiss}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
