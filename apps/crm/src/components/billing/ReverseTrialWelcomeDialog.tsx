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
  const native = isNativeApp();
  const open = endsAt !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <Sparkles size={22} aria-hidden="true" className="text-primary" />
          <DialogTitle>Seu workspace está no Pro por 14 dias</DialogTitle>
          <DialogDescription>
            {endsAt
              ? `Até ${formatTrialDate(endsAt)}, use tudo do Pro: portal do cliente, relatórios, financeiro, contratos e a sua equipe.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Sem cartão. No fim, você escolhe se continua.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{native ? 'Entendi' : 'Começar a usar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
