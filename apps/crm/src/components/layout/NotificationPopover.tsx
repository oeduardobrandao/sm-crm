import { useState } from 'react';
import { Bell, CheckCheck, Filter } from 'lucide-react';
import type { Notification } from '../../store';
import NotificationList from './NotificationList';

export interface NotificationPopoverProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDismiss: (id: string) => void;
  onNavigate: (link: string) => void;
  onClose: () => void;
}

type FilterMode = 'all' | 'unread';

export default function NotificationPopover({
  notifications, onMarkAsRead, onMarkAllAsRead, onDismiss, onNavigate, onClose,
}: NotificationPopoverProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const visible = filter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications;

  const handleNavigate = (link: string) => { onClose(); onNavigate(link); };

  return (
    <div
      role="dialog"
      aria-label="Notificações"
      style={{
        width: 'min(380px, calc(100vw - 2rem))',
        maxHeight: 480,
        background: 'var(--surface-main)',
        border: '1px solid var(--border-color)',
        borderRadius: 16,
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Notificações</span>
        <span style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            type="button"
            onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
            aria-label={filter === 'all' ? 'Apenas não lidas' : 'Mostrar todas'}
            style={iconButtonStyle(filter === 'unread')}
          >
            <Filter size={16} />
          </button>
          <button
            type="button"
            onClick={onMarkAllAsRead}
            aria-label="Marcar todas como lidas"
            style={iconButtonStyle(false)}
          >
            <CheckCheck size={16} />
          </button>
        </span>
      </header>

      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        <NotificationList
          notifications={visible}
          onMarkAsRead={onMarkAsRead}
          onDismiss={onDismiss}
          onNavigate={handleNavigate}
        />
      )}

      <footer style={{
        padding: '0.5rem 1rem',
        borderTop: '1px solid var(--border-color)',
        textAlign: 'center',
      }}>
        <button
          type="button"
          disabled
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        >
          Ver todas
        </button>
      </footer>
    </div>
  );
}

function iconButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    background: active ? 'var(--surface-hover)' : 'transparent',
    border: 'none',
    color: active ? 'var(--primary-color)' : 'var(--text-muted)',
    cursor: 'pointer',
  };
}

function EmptyState() {
  return (
    <div style={{
      padding: '2rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem',
      textAlign: 'center',
    }}>
      <span style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: 'var(--surface-hover)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        <Bell size={20} />
      </span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Nenhuma notificação</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 240 }}>
        Notificações sobre sua conta e atividades aparecerão aqui
      </span>
    </div>
  );
}
