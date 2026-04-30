import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { X } from 'lucide-react';
import type { Notification } from '../../store';
import {
  NOTIFICATION_TONE_COLOR,
  getNotificationDisplay,
} from '../../lib/notification-config';

export interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
}

export default function NotificationItem({ notification, onMarkAsRead, onDismiss, onNavigate }: NotificationItemProps) {
  const display = getNotificationDisplay(notification.type, notification.metadata);
  const Icon = display.icon;
  const color = NOTIFICATION_TONE_COLOR[display.tone];
  const isRead = !!notification.read_at;

  const handleClick = () => {
    if (!isRead) onMarkAsRead(notification.id);
    if (notification.link) onNavigate(notification.link);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(notification.id);
  };

  return (
    <div
      style={{ position: 'relative', borderBottom: '1px solid var(--border-color)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={display.title}
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-start',
          width: '100%',
          padding: '0.75rem 2.5rem 0.75rem 1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          opacity: isRead ? 0.6 : 1,
          transition: 'background 0.15s',
        }}
      >
        <span
          aria-hidden
          style={{
            flex: '0 0 32px',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${color}1f`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
          }}
        >
          <Icon size={16} />
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block',
            fontSize: '0.82rem',
            fontWeight: isRead ? 400 : 500,
            color: 'var(--text-main)',
            marginBottom: '0.15rem',
          }}>
            {display.title}
          </span>
          <span style={{
            display: 'block',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {display.body}
          </span>
          <span style={{
            display: 'block',
            fontSize: '0.7rem',
            color: 'var(--text-light)',
            marginTop: '0.2rem',
          }}>
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
          </span>
        </span>

        {!isRead && (
          <span
            data-testid="notification-unread-dot"
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--primary-color)',
              flex: '0 0 auto',
              alignSelf: 'center',
            }}
          />
        )}
      </button>

      <button
        type="button"
        aria-label="Dispensar"
        onClick={handleDismiss}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
