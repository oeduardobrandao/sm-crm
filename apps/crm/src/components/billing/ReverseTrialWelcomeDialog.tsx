import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatTrialDate } from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';

/**
 * One-time welcome after the reverse trial starts (spec Part 2). Inside the iOS app it is text
 * only (apps/mobile/DECISIONS.md D5): no plan link, just a close button.
 */
export function ReverseTrialWelcomeDialog({
  endsAt,
  onClose,
}: {
  endsAt: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const native = isNativeApp();
  const open = endsAt !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <Sparkles size={22} aria-hidden="true" className="text-primary" />
          <DialogTitle>{t('reverseTrial.welcome.title')}</DialogTitle>
          <DialogDescription>
            {endsAt ? t('reverseTrial.welcome.body', { date: formatTrialDate(endsAt) }) : null}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('reverseTrial.welcome.noCard')}</p>
        <DialogFooter>
          <Button onClick={onClose}>
            {native ? t('reverseTrial.welcome.ok') : t('reverseTrial.welcome.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
