import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listActivePlans } from '@/services/billing';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { captureEvent } from '@/lib/analytics';
import { ADD_CARD_PATH, formatTrialDate } from '@/lib/reverseTrial';
import { isPagarme12xEnabled } from '@/lib/pagarme-gate';

/** plans.price_brl is stored in centavos. */
export function formatCentavosBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export interface ReverseTrialEndDialogProps {
  open: boolean;
  onClose: () => void;
  endsAt: string;
  planId: string;
  daysLeft: number;
}

/**
 * End-of-trial prompt (spec Part 3): owner only, once per session in the last 3 days, never in
 * the iOS app (the parent decides all of that). "What you used" comes from workspace_usage();
 * "On Free" from the Free plan row, never hard-coded.
 */
export function ReverseTrialEndDialog({
  open,
  onClose,
  endsAt,
  planId,
  daysLeft,
}: ReverseTrialEndDialogProps) {
  const { t } = useTranslation('billing');
  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: open,
  });
  const { usage } = useWorkspaceUsage();
  const trialPlan = plans?.find((p) => p.id === planId);
  const free = plans?.find((p) => p.id === 'free');
  const date = formatTrialDate(endsAt);
  const days = t('reverseTrial.days', { count: daysLeft });

  const used: string[] = [];
  if (usage?.clients != null) {
    used.push(t('reverseTrial.endDialog.usedClients', { count: usage.clients }));
  }
  if (usage?.hub_tokens) {
    used.push(t('reverseTrial.endDialog.usedHub', { count: usage.hub_tokens }));
  }
  if (usage?.team_members != null) {
    used.push(t('reverseTrial.endDialog.usedMembers', { count: usage.team_members }));
  }

  const onFree: string[] = [];
  if (free) {
    if (free.max_clients != null) {
      onFree.push(t('reverseTrial.endDialog.freeClients', { count: free.max_clients }));
    }
    onFree.push(t('reverseTrial.endDialog.freeHub'));
    if (free.max_team_members != null) {
      onFree.push(t('reverseTrial.endDialog.freeMembers', { count: free.max_team_members }));
    }
    const reports = free.rate_report_generations_per_month;
    if (reports != null) {
      onFree.push(
        reports > 0
          ? t('reverseTrial.endDialog.freeReports', { count: reports })
          : t('reverseTrial.endDialog.freeNoReports'),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="reverse-trial-dialog sm:max-w-[560px]">
        <DialogHeader>
          <Badge variant="warning" size="sm" className="self-start">
            {daysLeft === 0
              ? t('reverseTrial.endDialog.badgeToday')
              : t('reverseTrial.endDialog.badge', { days })}
          </Badge>
          <DialogTitle>{t('reverseTrial.endDialog.title', { date })}</DialogTitle>
          <DialogDescription>{t('reverseTrial.endDialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {(used.length > 0 || onFree.length > 0) && (
          <div className="reverse-trial-dialog__compare">
            {used.length > 0 && (
              <div className="reverse-trial-dialog__col">
                <p className="reverse-trial-dialog__col-title">
                  {t('reverseTrial.endDialog.usedTitle')}
                </p>
                <ul>
                  {used.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {onFree.length > 0 && (
              <div className="reverse-trial-dialog__col reverse-trial-dialog__col--free">
                <p className="reverse-trial-dialog__col-title">
                  {t('reverseTrial.endDialog.freeTitle')}
                </p>
                <ul>
                  {onFree.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {trialPlan?.price_brl ? (
          <p className="text-sm text-muted-foreground">
            {t('reverseTrial.endDialog.price', {
              plan: trialPlan.name,
              amount: formatCentavosBRL(trialPlan.price_brl),
              date,
            })}
          </p>
        ) : null}

        <DialogFooter className="reverse-trial-dialog__actions">
          <Button asChild>
            <Link
              to={ADD_CARD_PATH}
              onClick={() => {
                captureEvent('reverse_trial_add_card_clicked', { surface: 'modal' });
                onClose();
              }}
            >
              {t('reverseTrial.endDialog.primary')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/comecar" onClick={onClose}>
              {t('reverseTrial.endDialog.secondary')}
            </Link>
          </Button>
          <button type="button" className="reverse-trial-dialog__later" onClick={onClose}>
            {t('reverseTrial.endDialog.later')}
          </button>
        </DialogFooter>
        {trialPlan && isPagarme12xEnabled(trialPlan) ? (
          <p className="text-xs text-muted-foreground">
            {t('reverseTrial.endDialog.installments')}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
