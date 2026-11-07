import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface PushPrePromptSheetProps {
  open: boolean;
  onAllow: () => void;
  /** "Agora não", and any other dismissal (X, swipe down, Escape): all snooze. */
  onLater: () => void;
}

/**
 * Asks before iOS does: the system dialog can be shown only once, so the app explains
 * first and calls it only on "Ativar notificações". A bottom sheet on phones (the
 * Dialog primitive turns into one below 768px).
 */
export function PushPrePromptSheet({ open, onAllow, onLater }: PushPrePromptSheetProps) {
  const { t } = useTranslation('common');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onLater();
      }}
    >
      <DialogContent phoneDetent="fit" className="sm:max-w-md">
        <DialogHeader>
          <span
            aria-hidden="true"
            className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary-color)_18%,transparent)]"
          >
            <Bell className="h-5 w-5 text-[color:var(--primary-hover)]" />
          </span>
          <DialogTitle>{t('native.pushPromptTitle')}</DialogTitle>
          <DialogDescription>{t('native.pushPromptBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="mb-0" onClick={onLater}>
            {t('native.pushPromptLater')}
          </Button>
          <Button className="mb-0" onClick={onAllow}>
            {t('native.pushPromptAllow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
