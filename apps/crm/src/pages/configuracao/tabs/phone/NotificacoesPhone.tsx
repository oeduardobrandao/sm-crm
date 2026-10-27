import { useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { CATEGORY_LABELS, isEmailEligibleType } from '@/lib/notification-catalog';
import { MASTER_PAUSE_TYPE } from '@/store/notificationPrefs';
import type { Cliente } from '@/store';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../../phone/ConfigPhoneScreen';
import { useConfigSubScreen } from '../../phone/useConfigSubScreen';
import { enabledOf, useSuasNotificacoes } from '../notificacoes/useSuasNotificacoes';
import {
  marketingLabel,
  transactionalRows,
  useEmailsAutomaticos,
} from '../notificacoes/useEmailsAutomaticos';
import { statusTag as statusTagOf, useSeusClientes } from '../notificacoes/useSeusClientes';
import './notificacoesPhone.css';

type Channel = 'inapp' | 'email';
type SubScreen = 'emails' | 'clientes';
type ClientSwitch = 'report' | 'event';

const channelOptions = (): { value: Channel; label: string }[] => [
  { value: 'inapp', label: i18n.t('settings:notifications.inApp') },
  { value: 'email', label: i18n.t('settings:shared.email') },
];

const clientSwitchOptions = (): { value: ClientSwitch; label: string }[] => [
  { value: 'report', label: i18n.t('settings:notifications.clientes.monthlyReport') },
  { value: 'event', label: i18n.t('settings:notifications.clientes.hubPending') },
];

const whenWho = (when: string, recipients: string) =>
  i18n.t('settings:notifications.whenWho', { when, recipients });

export interface NotificacoesPhoneProps {
  /** `configuracoes:ver`: same gate as the desktop "Seus clientes" section. */
  canViewConfig: boolean;
}

/**
 * Notificações on phones (FConfigNotificacoes). A Cell holds one switch, so a
 * segmented control picks which channel (No app / E-mail) the per-type switches edit.
 * "E-mails automáticos" and "Seus clientes" are pushed sub-screens. Every save goes
 * through the same hooks as the desktop sections.
 */
export function NotificacoesPhone({ canViewConfig }: NotificacoesPhoneProps) {
  const { t } = useTranslation('settings');
  const sub = useConfigSubScreen<SubScreen>();
  // Kept here, above the sub-screens, so coming back keeps the picked channel.
  const [channel, setChannel] = useState<Channel>('inapp');
  const suas = useSuasNotificacoes();

  if (sub.screen === 'emails') return <EmailsAutomaticosScreen onBack={sub.close} />;
  if (sub.screen === 'clientes' && canViewConfig) {
    return <SeusClientesScreen onBack={sub.close} />;
  }

  const isEmail = channel === 'email';
  const paused = isEmail ? suas.emailPaused : suas.inappPaused;
  const prefs = isEmail ? suas.emailPrefs : suas.inappPrefs;
  const channelName = isEmail ? t('shared.email') : t('notifications.inApp');

  return (
    <ConfigPhoneScreen title={t('tabs.notificacoes')} subtitle={t('notifications.phone.subtitle')}>
      {suas.loading ? (
        <ConfigPhoneSkeleton groups={3} rows={4} />
      ) : (
        <>
          <SegmentedControl
            className="phone-config-segmented"
            aria-label={t('notifications.phone.channelAria')}
            options={channelOptions()}
            value={channel}
            onChange={setChannel}
          />
          <p className="phone-notif-note">
            {t('notifications.phone.channelNote', { channel: channelName })}
          </p>

          <GroupedList
            aria-label={t('notifications.phone.pauseAllAria', { channel: channelName })}
            footer={
              paused ? t('notifications.phone.pausedFooter', { channel: channelName }) : undefined
            }
          >
            <Cell
              label={t('notifications.pauseAll')}
              subtitle={channelName}
              switch={{
                checked: paused,
                onCheckedChange: (v) =>
                  isEmail
                    ? suas.saveEmail({ type: MASTER_PAUSE_TYPE, enabled: !v })
                    : suas.saveInapp({ type: MASTER_PAUSE_TYPE, enabled: !v }),
              }}
            />
          </GroupedList>

          <GroupedList aria-label={t('notifications.phone.otherEmails')}>
            <Cell
              label={t('notifications.emails.title')}
              subtitle={t('notifications.phone.emailsSubtitle')}
              chevron
              onClick={() => sub.open('emails')}
            />
            {canViewConfig && (
              <Cell
                label={t('notifications.clientes.title')}
                subtitle={t('notifications.phone.clientesSubtitle')}
                chevron
                onClick={() => sub.open('clientes')}
              />
            )}
          </GroupedList>

          {suas.categories.map(({ category, rows }) => (
            <GroupedList key={category} header={CATEGORY_LABELS[category]}>
              {rows.map((row) => {
                const subtitle = whenWho(row.when, row.recipients);
                if (!isEmail) {
                  return (
                    <Cell
                      key={row.type}
                      className="phone-notif-row"
                      label={row.label}
                      subtitle={subtitle}
                      disabled={paused}
                      switch={{
                        checked: enabledOf(prefs, row.type),
                        onCheckedChange: (v) => suas.saveInapp({ type: row.type, enabled: v }),
                      }}
                    />
                  );
                }
                // Narrowed via the catalog-derived type guard, as on desktop.
                const emailType = isEmailEligibleType(row.type) ? row.type : null;
                if (!emailType) {
                  return (
                    <Cell
                      key={row.type}
                      className="phone-notif-row"
                      label={row.label}
                      subtitle={subtitle}
                      value={
                        <span aria-label={t('notifications.noEmailTypeAria', { label: row.label })}>
                          {t('notifications.noEmailShort')}
                        </span>
                      }
                    />
                  );
                }
                return (
                  <Cell
                    key={row.type}
                    className="phone-notif-row"
                    label={row.label}
                    subtitle={subtitle}
                    disabled={paused}
                    switch={{
                      checked: enabledOf(prefs, row.type),
                      onCheckedChange: (v) => suas.saveEmail({ type: emailType, enabled: v }),
                    }}
                  />
                );
              })}
            </GroupedList>
          ))}
        </>
      )}
    </ConfigPhoneScreen>
  );
}

/** "E-mails automáticos": the 3 always-on e-mails plus the marketing opt-in. */
function EmailsAutomaticosScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settings');
  const { marketingOptIn, saveMarketing } = useEmailsAutomaticos();
  return (
    <ConfigPhoneScreen
      title={t('notifications.emails.title')}
      subtitle={t('notifications.emails.description')}
      onBack={onBack}
    >
      <GroupedList header={t('notifications.emails.alwaysSent')}>
        {transactionalRows().map((row) => (
          <Cell
            key={row.label}
            className="phone-notif-row"
            label={row.label}
            subtitle={whenWho(row.when, row.recipients)}
            value={t('notifications.always')}
          />
        ))}
      </GroupedList>
      <GroupedList
        header={t('notifications.emails.dependsOnYou')}
        footer={t('notifications.emails.sameControl')}
      >
        <Cell
          className="phone-notif-row"
          label={marketingLabel()}
          subtitle={whenWho(
            t('notifications.marketingWhen'),
            t('notifications.marketingRecipients'),
          )}
          switch={{ checked: marketingOptIn, onCheckedChange: (v) => saveMarketing(v) }}
        />
      </GroupedList>
    </ConfigPhoneScreen>
  );
}

/**
 * "Seus clientes": the two master switches, a search, then one row per client. A
 * segmented control picks which per-client switch (relatório or pendências) the rows
 * edit. A client who unsubscribed goes through the desktop's reactivation confirm.
 */
function SeusClientesScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settings');
  const s = useSeusClientes();
  const [kind, setKind] = useState<ClientSwitch>('report');

  const renderCliente = (cliente: Cliente) => {
    const hasEmail = !!cliente.email;
    const unsubbed = !!cliente.event_email_unsub_at;
    const statusTag = statusTagOf(cliente.status);
    const label = (
      <>
        {cliente.nome}
        {statusTag && <span className="phone-notif-status">{statusTag}</span>}
      </>
    );
    if (!hasEmail) {
      return <Cell key={cliente.id} label={label} subtitle={t('notifications.clientes.noEmail')} />;
    }
    if (kind === 'report') {
      return (
        <Cell
          key={cliente.id}
          label={label}
          subtitle={cliente.email}
          disabled={!s.canEditClients}
          switch={{
            checked: cliente.send_report_email ?? false,
            onCheckedChange: (v) => s.changeClienteReport(cliente, v),
          }}
        />
      );
    }
    return (
      <Cell
        key={cliente.id}
        className={unsubbed ? 'phone-notif-unsub' : undefined}
        label={label}
        subtitle={
          unsubbed
            ? t('notifications.clientes.emailUnsubbed', { email: cliente.email })
            : cliente.email
        }
        disabled={!s.canEditClients}
        switch={{
          checked: cliente.send_event_email ?? false,
          onCheckedChange: (v) => s.changeClienteEvent(cliente, v),
        }}
      />
    );
  };

  return (
    <ConfigPhoneScreen
      title={t('notifications.clientes.title')}
      subtitle={t('notifications.clientes.description')}
      onBack={onBack}
    >
      {s.loading ? (
        <ConfigPhoneSkeleton groups={2} rows={3} />
      ) : (
        <>
          {!s.canEditClients && <p className="phone-notif-note">{t('shared.readOnly')}</p>}
          <GroupedList header={t('notifications.clientes.allClients')}>
            <Cell
              className="phone-notif-row"
              label={t('notifications.clientes.monthlyReport')}
              subtitle={t('notifications.clientes.monthlyReportHint')}
              disabled={!s.canEditClients}
              switch={{ checked: s.masterEnabled, onCheckedChange: (v) => s.saveMaster(v) }}
            />
            <Cell
              className="phone-notif-row"
              label={t('notifications.clientes.hubPending')}
              subtitle={t('notifications.clientes.hubPendingHint')}
              disabled={!s.canEditClients}
              switch={{
                checked: s.masterEventEnabled,
                onCheckedChange: (v) => s.saveMasterEvent(v),
              }}
            />
          </GroupedList>

          <label className="phone-config-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              placeholder={t('notifications.clientes.searchPlaceholder')}
              aria-label={t('notifications.clientes.searchAria')}
              value={s.search}
              onChange={(e) => s.setSearch(e.target.value)}
            />
          </label>

          <SegmentedControl
            className="phone-config-segmented"
            aria-label={t('notifications.clientes.clientSwitchAria')}
            options={clientSwitchOptions()}
            value={kind}
            onChange={setKind}
          />

          <GroupedList
            header={t('notifications.clientes.header')}
            footer={t('notifications.clientes.footer')}
          >
            {s.filtered.length === 0 ? (
              <li className="phone-config-block phone-notif-empty">
                {t('notifications.clientes.empty')}
              </li>
            ) : (
              s.filtered.map(renderCliente)
            )}
          </GroupedList>

          <PhoneConfirmSheet
            open={s.confirmReactivateId != null}
            title={
              s.confirmCliente
                ? t('notifications.clientes.reactivateTitleFor', { name: s.confirmCliente.nome })
                : t('notifications.clientes.reactivateTitle')
            }
            message={t('notifications.clientes.reactivateBody')}
            actions={[
              {
                label: t('notifications.clientes.reactivate'),
                onSelect: s.handleConfirmReactivate,
              },
            ]}
            onCancel={() => s.setConfirmReactivateId(null)}
          />
        </>
      )}
    </ConfigPhoneScreen>
  );
}
