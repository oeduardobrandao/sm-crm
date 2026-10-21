import { useState } from 'react';
import { Search } from 'lucide-react';
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
  MARKETING_LABEL,
  TRANSACTIONAL_ROWS,
  useEmailsAutomaticos,
} from '../notificacoes/useEmailsAutomaticos';
import { STATUS_TAG, useSeusClientes } from '../notificacoes/useSeusClientes';
import './notificacoesPhone.css';

type Channel = 'inapp' | 'email';
type SubScreen = 'emails' | 'clientes';
type ClientSwitch = 'report' | 'event';

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: 'inapp', label: 'No app' },
  { value: 'email', label: 'E-mail' },
];

const CLIENT_SWITCH_OPTIONS: { value: ClientSwitch; label: string }[] = [
  { value: 'report', label: 'Relatório mensal' },
  { value: 'event', label: 'Pendências do Hub' },
];

const whenWho = (when: string, recipients: string) =>
  `Quando: ${when} · Quem recebe: ${recipients}`;

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
  const channelName = isEmail ? 'E-mail' : 'No app';

  return (
    <ConfigPhoneScreen
      title="Notificações"
      subtitle="O que aparece no sino e o que chega no seu e-mail. Vale só para você."
    >
      {suas.loading ? (
        <ConfigPhoneSkeleton groups={3} rows={4} />
      ) : (
        <>
          <SegmentedControl
            className="phone-config-segmented"
            aria-label="Canal editado pelos botões"
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={setChannel}
          />
          <p className="phone-notif-note">
            Os botões abaixo ligam e desligam o canal {channelName}.
          </p>

          <GroupedList
            aria-label={`Pausar tudo (${channelName})`}
            footer={
              paused
                ? `Canal ${channelName} pausado: os tipos abaixo ficam travados até você despausar.`
                : undefined
            }
          >
            <Cell
              label="Pausar tudo"
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

          <GroupedList aria-label="Outros e-mails">
            <Cell
              label="E-mails automáticos"
              subtitle="Convite, cobrança, Instagram e novidades"
              chevron
              onClick={() => sub.open('emails')}
            />
            {canViewConfig && (
              <Cell
                label="Seus clientes"
                subtitle="Relatório mensal e pendências do Hub"
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
                        <span aria-label={`${row.label}: este tipo não vira e-mail`}>
                          Não vira e-mail
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
  const { marketingOptIn, saveMarketing } = useEmailsAutomaticos();
  return (
    <ConfigPhoneScreen
      title="E-mails automáticos"
      subtitle="E-mails que a sua conta envia sozinha, para transparência. Os 3 primeiros são sempre enviados; só o último depende de você."
      onBack={onBack}
    >
      <GroupedList header="Sempre enviados">
        {TRANSACTIONAL_ROWS.map((row) => (
          <Cell
            key={row.label}
            className="phone-notif-row"
            label={row.label}
            subtitle={whenWho(row.when, row.recipients)}
            value="sempre"
          />
        ))}
      </GroupedList>
      <GroupedList header="Depende de você" footer="Mesmo controle que está no seu Perfil.">
        <Cell
          className="phone-notif-row"
          label={MARKETING_LABEL}
          subtitle={whenWho('marketing ocasional', 'você (opt-in)')}
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
  const s = useSeusClientes();
  const [kind, setKind] = useState<ClientSwitch>('report');

  const renderCliente = (cliente: Cliente) => {
    const hasEmail = !!cliente.email;
    const unsubbed = !!cliente.event_email_unsub_at;
    const statusTag =
      cliente.status && cliente.status !== 'ativo' ? STATUS_TAG[cliente.status] : null;
    const label = (
      <>
        {cliente.nome}
        {statusTag && <span className="phone-notif-status">{statusTag}</span>}
      </>
    );
    if (!hasEmail) {
      return <Cell key={cliente.id} label={label} subtitle="sem e-mail cadastrado" />;
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
        subtitle={unsubbed ? `${cliente.email} · desativado pelo cliente` : cliente.email}
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
      title="Seus clientes"
      subtitle="O relatório mensal e as pendências do Hub de cada cliente, um por um. Os gerais ligam ou desligam todo mundo de uma vez."
      onBack={onBack}
    >
      {s.loading ? (
        <ConfigPhoneSkeleton groups={2} rows={3} />
      ) : (
        <>
          {!s.canEditClients && <p className="phone-notif-note">Somente leitura</p>}
          <GroupedList header="Todos os clientes">
            <Cell
              className="phone-notif-row"
              label="Relatório mensal"
              subtitle="todo dia 1º, com PDF e resumo do mês"
              disabled={!s.canEditClients}
              switch={{ checked: s.masterEnabled, onCheckedChange: (v) => s.saveMaster(v) }}
            />
            <Cell
              className="phone-notif-row"
              label="Pendências do Hub"
              subtitle="posts a aprovar e mensagens não lidas · máx. 1 e-mail a cada 4h"
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
              placeholder="Buscar cliente…"
              aria-label="Buscar cliente"
              value={s.search}
              onChange={(e) => s.setSearch(e.target.value)}
            />
          </label>

          <SegmentedControl
            className="phone-config-segmented"
            aria-label="E-mail editado pelos botões dos clientes"
            options={CLIENT_SWITCH_OPTIONS}
            value={kind}
            onChange={setKind}
          />

          <GroupedList
            header="Clientes"
            footer="Clientes sem e-mail cadastrado não recebem nada. Cadastre o e-mail na ficha do cliente."
          >
            {s.filtered.length === 0 ? (
              <li className="phone-config-block phone-notif-empty">Nenhum cliente encontrado.</li>
            ) : (
              s.filtered.map(renderCliente)
            )}
          </GroupedList>

          <PhoneConfirmSheet
            open={s.confirmReactivateId != null}
            title={`Reativar pendências do Hub${s.confirmCliente ? ` para ${s.confirmCliente.nome}` : ''}?`}
            message="O cliente pediu para não receber estes e-mails. Reativar mesmo assim?"
            actions={[{ label: 'Reativar', onSelect: s.handleConfirmReactivate }]}
            onCancel={() => s.setConfirmReactivateId(null)}
          />
        </>
      )}
    </ConfigPhoneScreen>
  );
}
