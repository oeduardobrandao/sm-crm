import { useState, useEffect, useCallback } from 'react';
import { Bell, MessageCircle } from 'lucide-react';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}

export default function TopBarActions() {
  const [crispUnread, setCrispUnread] = useState(false);

  const openCrisp = useCallback(() => {
    window.$crisp?.push(['do', 'chat:open']);
    setCrispUnread(false);
  }, []);

  useEffect(() => {
    window.$crisp?.push(['on', 'message:received', () => setCrispUnread(true)]);
    window.$crisp?.push(['on', 'chat:opened', () => setCrispUnread(false)]);
  }, []);

  return (
    <>
      <button type="button" className="topbar-action-btn" aria-label="Notificações">
        <Bell size={18} />
      </button>

      <button
        type="button"
        className="topbar-action-btn"
        aria-label="Chat"
        onClick={openCrisp}
      >
        <MessageCircle size={18} />
        {crispUnread && <span className="unread-dot unread-dot--primary" />}
      </button>
    </>
  );
}
