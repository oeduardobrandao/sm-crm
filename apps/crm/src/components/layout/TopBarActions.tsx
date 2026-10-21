import { useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import NotificationBell from './NotificationBell';
import { openSupportChat } from '@/lib/supportChat';
import {
  ensureCrispListeners,
  markSupportChatRead,
  useSupportChatUnread,
} from '@/lib/supportChatUnread';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function TopBarActions({ variant = 'topbar' }: { variant?: 'topbar' | 'capsule' }) {
  const { t } = useTranslation();
  const crispUnread = useSupportChatUnread();
  const buttonClassName = variant === 'capsule' ? 'vidro-capsule-btn' : 'topbar-action-btn';

  const openCrisp = useCallback(() => {
    // Gated: without support consent this opens the consent dialog instead of a dead click.
    // The unread dot only clears when the chat really opened, not when only the dialog did.
    if (openSupportChat()) markSupportChatRead();
  }, []);

  useEffect(() => {
    ensureCrispListeners();
  }, []);

  const buttons = (
    <TooltipProvider delayDuration={200}>
      <NotificationBell buttonClassName={buttonClassName} />

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={buttonClassName} aria-label="Chat" onClick={openCrisp}>
            <MessageCircle size={18} />
            {crispUnread && <span className="unread-dot unread-dot--primary" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('topbar.supportChat')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (variant === 'capsule') {
    return (
      <div className="vidro-capsule" role="group" aria-label="Notificações e suporte">
        {buttons}
      </div>
    );
  }
  return buttons;
}
