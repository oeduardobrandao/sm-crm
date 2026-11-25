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
import { Button } from '@/components/ui/button';
import { listActivePlans } from '@/services/billing';
import type { WorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { captureEvent } from '@/lib/analytics';
import { ADD_CARD_PATH, formatTrialDate } from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';

export interface ReverseTrialEndedDialogProps {
  open: boolean;
  onClose: () => void;
  endedAt: string;
  pauseAt: Date;
  paused: boolean;
  usage: Partial<WorkspaceUsage> | null;
  /** Owner on the web: the recover/plans buttons. Otherwise text only with a close button. */
  showActions: boolean;
}

/**
 * One-time notice on the first visit after the reverse trial ended on Free (spec Part 5). What
 * changed comes from current usage and the Free plan row, never hard-coded.
 */
export function ReverseTrialEndedDialog({
  open,
  onClose,
  endedAt,
  pauseAt,
  paused,
  usage,
  showActions,
}: ReverseTrialEndedDialogProps) {
  const { t } = useTranslation('billing');
  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: open,
  });
  const free = plans?.find((p) => p.id === 'free');
  const clients = usage?.clients;
  const hubLinks = usage?.hub_tokens;
  const members = usage?.team_members;
  const reports = free?.rate_report_generations_per_month;

  const items: { lead?: string; text: string }[] = [];
  if (clients != null && clients > 0) {
    items.push({
      lead: t('reverseTrial.ended.clientsLead', { count: clients }),
      text: t('reverseTrial.ended.clientsText', {
        count: clients,
        limit: free?.max_clients ?? 2,
      }),
    });
  }
  if (hubLinks != null && hubLinks > 0) {
    items.push({
      lead: t('reverseTrial.ended.hubLead', { count: hubLinks }),
      text: paused
        ? t('reverseTrial.ended.hubPaused')
        : t('reverseTrial.ended.hubPausing', { date: formatTrialDate(pauseAt) }),
    });
  }
  if (members != null && members > 1) {
    items.push({
      lead: t('reverseTrial.ended.membersLead', { count: members }),
      text: t('reverseTrial.ended.membersText'),
    });
  }
  items.push({ text: t('reverseTrial.ended.modulesText') });
  if (reports != null) {
    items.push({
      text:
        reports > 0
          ? t('reverseTrial.ended.reportsText', { count: reports })
          : t('reverseTrial.ended.reportsNone'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="reverse-trial-dialog sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{t('reverseTrial.ended.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('reverseTrial.ended.dialogIntro', { date: formatTrialDate(endedAt) })}
          </DialogDescription>
        </DialogHeader>
        <ul className="reverse-trial-dialog__changes">
          {items.map((item) => (
            <li key={item.text}>
              {item.lead && <strong>{item.lead}</strong>} {item.text}
            </li>
          ))}
        </ul>
        {showActions && !isNativeApp() ? (
          <>
            <DialogFooter className="reverse-trial-dialog__actions sm:space-x-0">
              <Button asChild>
                <Link
                  to={ADD_CARD_PATH}
                  onClick={() => {
                    captureEvent('reverse_trial_add_card_clicked', { surface: 'ended_modal' });
                    onClose();
                  }}
                >
                  {t('reverseTrial.ended.recover')}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/comecar" onClick={onClose}>
                  {t('reverseTrial.ended.secondary')}
                </Link>
              </Button>
              <button type="button" className="reverse-trial-dialog__later" onClick={onClose}>
                {t('reverseTrial.ended.later')}
              </button>
            </DialogFooter>
            <p className="text-xs text-muted-foreground">{t('reverseTrial.ended.footnote')}</p>
          </>
        ) : (
          <DialogFooter>
            <Button onClick={onClose}>{t('reverseTrial.ended.ok')}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
