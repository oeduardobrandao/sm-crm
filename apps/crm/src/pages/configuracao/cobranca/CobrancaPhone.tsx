import type { ReactNode } from 'react';
import { CreditCard, Settings, Tag, Undo2, XCircle } from 'lucide-react';
import { ConfigPhoneScreen } from '../phone/ConfigPhoneScreen';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import type { BillingInterval } from '@/services/billing';
import './cobrancaPhone.css';

const TITLE = 'Plano & Cobrança';

/** Non-owners: the same notice the desktop shows, on the phone screen. */
export function CobrancaPhoneLocked() {
  return (
    <ConfigPhoneScreen title={TITLE}>
      <GroupedList aria-label="Assinatura">
        <li className="phone-cell">
          <p className="phone-config-block phone-cobranca-muted">
            Apenas o proprietário da conta pode gerenciar a assinatura.
          </p>
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
  return (
    <ConfigPhoneScreen title={TITLE} className="phone-cobranca">
      {showCurrent && (
        <>
          <GroupedList
            header="Seu plano"
            footer={warning ? <span className="phone-cobranca-warning">{warning}</span> : undefined}
          >
            <Cell label="Plano" value={planName} />
            <Cell
              label="Status"
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

          <GroupedList aria-label="Ações da assinatura">
            {showPagarmeManage ? (
              <>
                <Cell
                  label="Atualizar cartão"
                  icon={<CreditCard />}
                  iconColor="var(--phone-neutral-action)"
                  chevron
                  onClick={onUpdateCard}
                />
                <Cell
                  label={switchWindow ? 'Desfazer a troca' : 'Cancelar assinatura'}
                  icon={switchWindow ? <Undo2 /> : <XCircle />}
                  iconColor="var(--phone-destructive)"
                  destructive
                  disabled={cancelling}
                  onClick={onOpenCancel}
                />
              </>
            ) : (
              <Cell
                label={portalBusy ? 'Aguarde…' : 'Gerenciar assinatura'}
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
          aria-label="Período de cobrança"
          className="phone-cobranca-segmented"
          options={[
            { value: 'month', label: 'Mensal' },
            { value: 'year', label: 'Anual' },
          ]}
          value={interval}
          onChange={onIntervalChange}
        />
        {(annualSavingsPct > 0 || firstTime) && (
          <ul className="phone-cobranca-hints">
            {annualSavingsPct > 0 && (
              <li>
                <Tag aria-hidden="true" />
                Economize até {annualSavingsPct}% no anual
              </li>
            )}
            {firstTime && (
              <li>
                <Tag aria-hidden="true" />
                Seus primeiros 30 dias são grátis
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
        title="Cancelar assinatura"
        message={cancelDescription}
        cancelLabel="Manter assinatura"
        onCancel={onCancelDismiss}
        actions={[
          {
            label: cancelling ? 'Cancelando…' : 'Sim, cancelar assinatura',
            destructive: true,
            disabled: cancelling,
            onSelect: onCancelConfirm,
          },
        ]}
      />
    </ConfigPhoneScreen>
  );
}
