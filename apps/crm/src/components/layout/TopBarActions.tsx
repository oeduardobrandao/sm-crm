import { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  hideSupportChatBubble,
  isUnreadMessage,
  onSupportChatEvent,
  openSupportChat,
} from '@/lib/supportChat';

export default function TopBarActions() {
  const [unread, setUnread] = useState(false);

  const handleOpen = useCallback(() => {
    openSupportChat();
    setUnread(false);
  }, []);

  useEffect(() => {
    // Returned unsubscribes are not optional here: these are real window listeners, so without
    // cleanup a remount stacks duplicates and the unread dot updates once per mount.
    const unsubscribers = [
      onSupportChatEvent('chatwoot:on-message', (detail) => {
        if (isUnreadMessage(detail)) setUnread(true);
      }),
      onSupportChatEvent('chatwoot:opened', () => setUnread(false)),
      // Re-hide on close so the bubble stays out of the way inside the app shell; the topbar
      // button is the only entry point here.
      onSupportChatEvent('chatwoot:closed', () => hideSupportChatBubble()),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <NotificationBell />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="topbar-action-btn"
            aria-label="Chat"
            onClick={handleOpen}
          >
            <MessageCircle size={18} />
            {unread && <span className="unread-dot unread-dot--primary" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Chat de suporte</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
