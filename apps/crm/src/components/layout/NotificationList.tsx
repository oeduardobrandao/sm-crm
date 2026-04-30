import type { Notification } from '../../store';
import NotificationItem from './NotificationItem';

export interface NotificationListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
}

export default function NotificationList({ notifications, onMarkAsRead, onDismiss, onNavigate }: NotificationListProps) {
  return (
    <div style={{ maxHeight: 'calc(480px - 56px)', overflowY: 'auto' }}>
      {notifications.map(n => (
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
