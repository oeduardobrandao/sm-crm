import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Settings, Tag, Undo2, XCircle } from 'lucide-react';
import { ConfigPhoneScreen } from '../phone/ConfigPhoneScreen';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import type { BillingInterval } from '@/services/billing';
import './cobrancaPhone.css';

/** Non-owners: the same notice the desktop shows, on the phone screen. */
export function CobrancaPhoneLocked() {
  const { t } = useTranslation('billing');
  return (
    <ConfigPhoneScreen title={t('cobrancaPhone.title')}>
      <GroupedList aria-label={t('cobrancaPhone.subscriptionAria')}>
        <li className="phone-cell">
          <p className="phone-config-block phone-cobranca-muted">{t('shared.ownerOnly')}</p>
        </li>
      </GroupedList>
    </ConfigPhoneScreen>
  );
}

export interface CobrancaPhoneProps {
  /** "Seu plano" group: shown under the same condition as the desktop card. */
  showCurrent: boolean;
  planName: string;
  statusLabel: string;
  statusWarning: boolean;
  /** "Renova em" / "Cancela em" / "Primeira cobrança em", or null without a period end. */
  periodLabel: string | null;
  periodDate: string;
  /** The dunning line ("Não conseguimos cobrar seu cartão..."), or null. */
  warning: string | null;
  showPagarmeManage: boolean;
  switchWindow: boolean;
  portalBusy: boolean;
  onUpdateCard: () => void;
  onOpenCancel: () => void;
  onManage: () => void;
  cancelOpen: boolean;
  cancelDescription: string;
  cancelling: boolean;
  onCancelDismiss: () => void;
  onCancelConfirm: () => void;
  usage: ReactNode;
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
  annualSavingsPct: number;
  firstTime: boolean;
  /** Discreet demo-account line (null unless plan_source='demo'). */
  demoNote?: ReactNode;
  /** The plan cards, rendered by the page (same CTAs and conditions as desktop). */
  plans: ReactNode;
  /** The Pagar.me checkout dialog (it picks its own phone layout). */
  checkout: ReactNode;
}

/**
 * Plano & Cobrança on phones: the current plan as a grouped list with its actions, the
 * usage meters, the Mensal/Anual segmented control and the plan cards in one column.
 * Presentational: every handler and condition comes from CobrancaPage.
 */
export function CobrancaPhone({
  showCurrent,
  planName,
  statusLabel,
  statusWarning,
  periodLabel,
  periodDate,
  warning,
  showPagarmeManage,
  switchWindow,
  portalBusy,
  onUpdateCard,
  onOpenCancel,
  onManage,
  cancelOpen,
  cancelDescription,
  cancelling,
  onCancelDismiss,
  onCancelConfirm,
  usage,
  interval,
  onIntervalChange,
  annualSavingsPct,
  firstTime,
  demoNote,
  plans,
  checkout,
}: CobrancaPhoneProps) {
  const { t } = useTranslation('billing');
  return (
    <ConfigPhoneScreen title={t('cobrancaPhone.title')} className="phone-cobranca">
      {showCurrent && (
        <>
          <GroupedList
            header={t('shared.yourPlan')}
            footer={warning ? <span className="phone-cobranca-warning">{warning}</span> : undefined}
          >
            <Cell label={t('cobrancaPhone.plan')} value={planName} />
            <Cell
              label={t('cobrancaPhone.status')}
              value={
                <span
                  className={`phone-cobranca-badge${statusWarning ? ' phone-cobranca-badge--warning' : ''}`}
                >
                  {statusLabel}
                </span>
              }
            />
            {periodLabel && <Cell label={periodLabel} value={periodDate} />}
          </GroupedList>

          <GroupedList aria-label={t('cobrancaPhone.actionsAria')}>
            {showPagarmeManage ? (
              <>
                <Cell
                  label={t('shared.updateCard')}
                  icon={<CreditCard />}
                  iconColor="var(--phone-neutral-action)"
                  chevron
                  onClick={onUpdateCard}
                />
                <Cell
                  label={switchWindow ? t('shared.undoSwitch') : t('shared.cancelSubscription')}
                  icon={switchWindow ? <Undo2 /> : <XCircle />}
                  iconColor="var(--phone-destructive)"
                  destructive
                  disabled={cancelling}
                  onClick={onOpenCancel}
                />
              </>
            ) : (
              <Cell
                label={portalBusy ? t('shared.wait') : t('shared.manageSubscription')}
                icon={<Settings />}
                iconColor="var(--phone-neutral-action)"
                chevron
                disabled={portalBusy}
                onClick={onManage}
              />
            )}
          </GroupedList>
        </>
      )}

      <div className="phone-cobranca-usage">{usage}</div>

      <div className="phone-cobranca-interval">
        <SegmentedControl<BillingInterval>
          aria-label={t('shared.billingPeriod')}
          className="phone-cobranca-segmented"
          options={[
            { value: 'month', label: t('shared.monthly') },
            { value: 'year', label: t('shared.annual') },
          ]}
          value={interval}
          onChange={onIntervalChange}
        />
        {(annualSavingsPct > 0 || firstTime) && (
          <ul className="phone-cobranca-hints">
            {annualSavingsPct > 0 && (
              <li>
                <Tag aria-hidden="true" />
                {t('shared.annualSavings', { pct: annualSavingsPct })}
              </li>
            )}
            {firstTime && (
              <li>
                <Tag aria-hidden="true" />
                {t('shared.firstDaysFree')}
              </li>
            )}
          </ul>
        )}
      </div>

      {demoNote}

      <div className="phone-cobranca-plans">{plans}</div>

      {checkout}

      <PhoneConfirmSheet
        open={cancelOpen}
        title={t('shared.cancelSubscription')}
        message={cancelDescription}
        cancelLabel={t('shared.keepSubscription')}
        onCancel={onCancelDismiss}
        actions={[
          {
            label: cancelling ? t('shared.cancelling') : t('shared.confirmCancel'),
            destructive: true,
            disabled: cancelling,
            onSelect: onCancelConfirm,
          },
        ]}
      />
    </ConfigPhoneScreen>
  );
}
