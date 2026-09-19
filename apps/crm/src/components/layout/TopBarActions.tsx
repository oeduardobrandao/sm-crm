import { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { openSupportChat } from '@/lib/supportChat';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
    /**
     * Crisp Session Continuity token, read by the widget on `session:reset`.
     * Only ever written by AuthContext.tsx: set on an authenticated rebind,
     * nulled on sign-out and user change. Declared here once; a TS global
     * augmentation merges across the compilation, so MobileNav.tsx's own
     * `$crisp` block deliberately does not repeat it.
     */
    CRISP_TOKEN_ID?: string | null;
  }
}

export default function TopBarActions() {
  const [crispUnread, setCrispUnread] = useState(false);

  const openCrisp = useCallback(() => {
    // Gated: without support consent this opens the consent dialog instead of a dead click.
    openSupportChat();
    setCrispUnread(false);
  }, []);

  useEffect(() => {
    window.$crisp?.push(['on', 'message:received', () => setCrispUnread(true)]);
    window.$crisp?.push(['on', 'chat:opened', () => setCrispUnread(false)]);
    window.$crisp?.push(['on', 'chat:closed', () => window.$crisp?.push(['do', 'chat:hide'])]);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <NotificationBell />

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="topbar-action-btn" aria-label="Chat" onClick={openCrisp}>
            <MessageCircle size={18} />
            {crispUnread && <span className="unread-dot unread-dot--primary" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Chat de suporte</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
