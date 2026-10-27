import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { getIntlLocale, i18n } from '@mesaas/i18n';
import { Check, Copy, KeyRound, Link2, MoreHorizontal, Plus, Unplug } from 'lucide-react';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import { CheckList } from '@/components/mobile/CheckList';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { SCOPE_OPTIONS, AGENT_PRESET, ownerOnlyHelp, scopeLabel } from '@/lib/mcp-scopes';
import type { McpKey } from '@/services/mcp-keys';
import type { OAuthGrant } from '@/services/mcp-oauth';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfigPhoneScreen } from '../phone/ConfigPhoneScreen';
import {
  ChatgptSteps,
  ClaudeKeyNote,
  ClaudeSteps,
  ClientIntro,
  CodexHeadersNote,
  CodexSteps,
  KeyUsageNote,
  ManagerIntro,
  MemberIntro,
  MCP_URL,
  TryItNote,
  buildConnectSnippets,
  codexConfigToml,
  type McpClient,
} from './mcpGuide';
import './mcpPhone.css';

type Expiry = 'never' | '30' | '90';
type CopyFn = (text: string, key: string) => void;

const fmtDate = (s: string) => new Date(s).toLocaleDateString(getIntlLocale());

/** Resolved at render time so the labels follow the current language. */
const expiryOptions = (): { value: Expiry; label: string }[] => [
  { value: 'never', label: i18n.t('mcp:page.expiryNever') },
  { value: '30', label: i18n.t('mcp:page.expiry30') },
  { value: '90', label: i18n.t('mcp:page.expiry90') },
];

/** Owner-only scopes (financeiro:*) are disabled, with the reason, unless the user owns the workspace. */
const scopeCheckOptions = (isWorkspaceOwner: boolean) =>
  SCOPE_OPTIONS.map((s) => {
    const locked = s.ownerOnly && !isWorkspaceOwner;
    return {
      value: s.value as string,
      label: scopeLabel(s.value),
      disabled: locked,
      subtitle: locked ? ownerOnlyHelp() : undefined,
    };
  });

export interface IntegracoesClaudePhoneProps {
  /** `configuracoes:ver`: API keys and every member's connections. Without it, only the
   *  connector guide and the member's own connections render. */
  canManage: boolean;
  canEdit: boolean;
  /** Owner of the active workspace (workspaceRole === 'owner'); gates the financeiro:* scopes. */
  isWorkspaceOwner: boolean;
  /** Assistants offered in the guide (Codex needs an API key, so managers only). */
  clientTabs: { id: McpClient; label: string }[];
  client: McpClient;
  onClientChange: (client: McpClient) => void;
  copy: CopyFn;
  copiedKey: string | null;
  grants: OAuthGrant[];
  keys: McpKey[];
  keysLoading: boolean;
  createOpen: boolean;
  onOpenCreate: () => void;
  name: string;
  onNameChange: (name: string) => void;
  scopes: string[];
  onScopesChange: (scopes: string[]) => void;
  expiry: Expiry;
  onExpiryChange: (expiry: Expiry) => void;
  creating: boolean;
  onCreate: () => void;
  revealToken: string | null;
  /** Closes the create/reveal sheet (one sheet, so the swap after creating is seamless). */
  onCloseKeySheet: () => void;
  connectKey: McpKey | null;
  connectToken: string;
  onConnectTokenChange: (token: string) => void;
  onOpenConnect: (key: McpKey) => void;
  onCloseConnect: () => void;
  revokeTarget: McpKey | null;
  onRevoke: (key: McpKey) => void;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
  revokeGrantTarget: OAuthGrant | null;
  onRevokeGrant: (grant: OAuthGrant) => void;
  onConfirmRevokeGrant: () => void;
  onCancelRevokeGrant: () => void;
}

/** A copy action row: tap copies (inside the gesture, as iOS Safari requires). */
function CopyCell({
  what,
  value,
  copyKey,
  copy,
  copiedKey,
}: {
  what: string;
  value: string;
  copyKey: string;
  copy: CopyFn;
  copiedKey: string | null;
}) {
  const { t } = useTranslation('mcp');
  const copied = copiedKey === copyKey;
  return (
    <Cell
      label={copied ? t('phone.copied') : t('phone.copy')}
      icon={copied ? <Check /> : <Copy />}
      aria-label={t('phone.copyWhat', { what })}
      className="phone-mcp-copy"
      onClick={() => copy(value, copyKey)}
    />
  );
}

/** A code block that scrolls sideways inside its card, plus its copy row. */
function CodeCells({
  what,
  value,
  copyKey,
  copy,
  copiedKey,
}: {
  what: string;
  value: string;
  copyKey: string;
  copy: CopyFn;
  copiedKey: string | null;
}) {
  return (
    <>
      <li className="phone-cell phone-mcp-code">
        <pre className="phone-mcp-code__pre" tabIndex={0} aria-label={what}>
          {value}
        </pre>
      </li>
      <CopyCell what={what} value={value} copyKey={copyKey} copy={copy} copiedKey={copiedKey} />
    </>
  );
}

/** Claude Desktop / Claude Code / Codex CLI snippets for a token, as grouped lists. */
function PhoneConnectSnippets({
  token,
  copy,
  copiedKey,
  idPrefix,
}: {
  token: string;
  copy: CopyFn;
  copiedKey: string | null;
  idPrefix: string;
}) {
  const { t } = useTranslation('mcp');
  const { desktopConfig, claudeCodeCmd, codexToml } = buildConnectSnippets(token);
  return (
    <>
      <GroupedList
        header="Claude Desktop"
        footer={<Trans t={t} i18nKey="snippets.desktopHelp" components={{ c: <code /> }} />}
      >
        <CodeCells
          what={t('phone.desktopConfigWhat')}
          value={desktopConfig}
          copyKey={`${idPrefix}-desktop`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </GroupedList>
      <GroupedList header="Claude Code" footer={t('snippets.codeHelp')}>
        <CodeCells
          what={t('phone.codeCmdWhat')}
          value={claudeCodeCmd}
          copyKey={`${idPrefix}-code`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </GroupedList>
      <GroupedList
        header="Codex CLI"
        footer={<Trans t={t} i18nKey="snippets.codexHelp" components={{ c: <code /> }} />}
      >
        <CodeCells
          what={t('phone.codexCliWhat')}
          value={codexToml}
          copyKey={`${idPrefix}-codex`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </GroupedList>
    </>
  );
}

/**
 * A grant or key row: swipe left for its actions, hold (or the "…" button) for the
 * same actions in a menu. One owner per gesture: the hold only opens the menu.
 */
function MenuRow({
  label,
  subtitle,
  value,
  menuLabel,
  sections,
  swipeActions,
  onTap,
}: {
  label: ReactNode;
  subtitle: ReactNode;
  value?: ReactNode;
  menuLabel: string;
  sections: ContextMenuAction[][];
  swipeActions: SwipeAction[];
  onTap?: () => void;
}) {
  const hasMenu = sections.some((s) => s.length > 0);
  const body = (
    <span className="phone-cell__body">
      <span className="phone-cell__text">
        <span className="phone-cell__label">{label}</span>
        <span className="phone-cell__subtitle phone-mcp-row__subtitle">{subtitle}</span>
      </span>
      {value != null && <span className="phone-cell__value">{value}</span>}
    </span>
  );
  return (
    <SwipeRow as="li" className="phone-cell phone-mcp-row" trailingActions={swipeActions}>
      <ContextMenu label={menuLabel} sections={sections} disabled={!hasMenu}>
        {({ triggerProps }) => (
          <div className="phone-mcp-row__inner">
            {onTap ? (
              <button
                type="button"
                className="phone-cell__main phone-mcp-row__main"
                onClick={onTap}
              >
                {body}
              </button>
            ) : (
              <div className="phone-cell__main phone-mcp-row__main">{body}</div>
            )}
            {hasMenu && (
              <button {...triggerProps} className="phone-mcp-row__more" aria-label={menuLabel}>
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </ContextMenu>
    </SwipeRow>
  );
}

const STEPS: Record<McpClient, () => ReactNode> = {
  claude: ClaudeSteps,
  chatgpt: ChatgptSteps,
  codex: CodexSteps,
};

/** Configurações > Agentes (MCP) on phones. Presentational: state and mutations live in
 *  IntegracoesClaudePage. */
export function IntegracoesClaudePhone(props: IntegracoesClaudePhoneProps) {
  const { t } = useTranslation('mcp');
  const {
    canManage,
    canEdit,
    clientTabs,
    client,
    onClientChange,
    copy,
    copiedKey,
    grants,
    keys,
    keysLoading,
  } = props;

  const Steps = STEPS[client];
  const panelId = `mcp-phone-panel-${client}`;
  const tabId = (c: McpClient) => `mcp-phone-tab-${c}`;

  return (
    <ConfigPhoneScreen
      title={t('phone.title')}
      subtitle={
        <>
          {canManage ? <ManagerIntro /> : <MemberIntro />}
          {canManage && !canEdit && (
            <span className="phone-mcp-readonly">{` ${t('phone.readOnly')}`}</span>
          )}
        </>
      }
    >
      <FeatureGate flag="feature_mcp" label={t('page.featureLabel')}>
        <h2 className="phone-group__header phone-mcp-heading">{t('page.howToConnect')}</h2>
        <SegmentedControl<McpClient>
          semantics="tablist"
          aria-label={t('page.chooseAssistant')}
          className="phone-config-segmented"
          value={client}
          onChange={onClientChange}
          options={clientTabs.map((t) => ({
            value: t.id,
            label: t.label,
            id: tabId(t.id),
            controls: `mcp-phone-panel-${t.id}`,
          }))}
        />
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(client)}>
          <GroupedList
            aria-label={t('phone.howToConnectFor', {
              client: clientTabs.find((tab) => tab.id === client)?.label,
            })}
            footer={
              client === 'claude' ? (
                canManage ? (
                  <ClaudeKeyNote />
                ) : undefined
              ) : client === 'codex' ? (
                <CodexHeadersNote />
              ) : undefined
            }
          >
            <li className="phone-cell phone-config-block phone-mcp-guide">
              <p className="phone-mcp-guide__intro">
                <ClientIntro client={client} />
              </p>
              <ol className="phone-mcp-steps">
                <Steps />
              </ol>
            </li>
            {client === 'codex' ? (
              <CodeCells
                what={t('phone.codexWhat')}
                value={codexConfigToml(t('guide.keyPlaceholder'))}
                copyKey="codex-toml"
                copy={copy}
                copiedKey={copiedKey}
              />
            ) : (
              <>
                <Cell
                  label={t('phone.serverUrl')}
                  subtitle={<span className="phone-mcp-mono">{MCP_URL}</span>}
                  className="phone-mcp-url"
                />
                <CopyCell
                  what={t('phone.mcpUrlWhat')}
                  value={MCP_URL}
                  copyKey="mcp-url"
                  copy={copy}
                  copiedKey={copiedKey}
                />
              </>
            )}
          </GroupedList>
        </div>
        <p className="phone-mcp-note">
          <TryItNote />
        </p>

        <GroupedList
          header={canManage ? t('page.grantsTitleManager') : t('page.grantsTitleMember')}
          footer={t('page.grantsHelp')}
        >
          {grants.length === 0 ? (
            <Cell label={t('page.noGrants')} className="phone-mcp-empty" />
          ) : (
            grants.map((g) => {
              const who = g.connected_by ?? t('page.grantFallback');
              const disconnect = () => props.onRevokeGrant(g);
              const canDisconnect = canEdit || g.mine;
              return (
                <MenuRow
                  key={g.id}
                  label={who}
                  subtitle={t('page.grantMeta', {
                    scopes: g.scopes.join(', '),
                    date: fmtDate(g.created_at),
                  })}
                  menuLabel={t('phone.grantActions', { who })}
                  sections={[
                    [
                      {
                        label: t('page.disconnect'),
                        icon: <Unplug />,
                        destructive: true,
                        disabled: !canDisconnect,
                        onSelect: disconnect,
                      },
                    ],
                  ]}
                  swipeActions={
                    canDisconnect
                      ? [
                          {
                            label: t('page.disconnect'),
                            icon: <Unplug />,
                            tone: 'destructive',
                            onAction: disconnect,
                          },
                        ]
                      : []
                  }
                />
              );
            })
          )}
        </GroupedList>

        {canManage && (
          <GroupedList
            header={t('page.apiKeys')}
            footer={!keysLoading && keys.length === 0 ? t('page.noKeys') : undefined}
          >
            <Cell
              label={t('page.createKey')}
              icon={<Plus />}
              className="phone-mcp-action"
              disabled={!canEdit}
              onClick={props.onOpenCreate}
            />
            {keysLoading && (
              <li className="phone-cell" aria-hidden="true">
                <div className="phone-config-skeleton__row">
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </li>
            )}
            {keys.map((k) => {
              const meta = [
                `…${k.token_suffix}`,
                k.scopes.join(', '),
                k.last_used_at
                  ? t('page.keyUsed', { date: fmtDate(k.last_used_at) })
                  : t('page.keyNeverUsed'),
                k.expires_at ? t('page.keyExpires', { date: fmtDate(k.expires_at) }) : null,
              ]
                .filter(Boolean)
                .join(' · ');
              if (k.revoked_at) {
                return (
                  <MenuRow
                    key={k.id}
                    label={k.name}
                    subtitle={meta}
                    value={t('page.revoked')}
                    menuLabel={t('phone.keyActions', { name: k.name })}
                    sections={[]}
                    swipeActions={[]}
                  />
                );
              }
              const connect = () => props.onOpenConnect(k);
              const revoke = () => props.onRevoke(k);
              return (
                <MenuRow
                  key={k.id}
                  label={k.name}
                  subtitle={meta}
                  menuLabel={t('phone.keyActions', { name: k.name })}
                  onTap={connect}
                  sections={[
                    [{ label: t('page.connect'), icon: <Link2 />, onSelect: connect }],
                    [
                      {
                        label: t('page.revoke'),
                        icon: <KeyRound />,
                        destructive: true,
                        disabled: !canEdit,
                        onSelect: revoke,
                      },
                    ],
                  ]}
                  swipeActions={[
                    {
                      label: t('page.connect'),
                      icon: <Link2 />,
                      tone: 'neutral',
                      onAction: connect,
                    },
                    ...(canEdit
                      ? [
                          {
                            label: t('page.revoke'),
                            icon: <KeyRound />,
                            tone: 'destructive' as const,
                            onAction: revoke,
                          },
                        ]
                      : []),
                  ]}
                />
              );
            })}
          </GroupedList>
        )}
      </FeatureGate>

      <KeySheet {...props} />
      <ConnectSheet {...props} />

      <PhoneConfirmSheet
        open={!!props.revokeTarget}
        title={t('page.revokeKeyTitle')}
        message={
          <Trans
            t={t}
            i18nKey="page.revokeKeyMessage"
            values={{ name: props.revokeTarget?.name ?? '' }}
            components={{ b: <strong /> }}
          />
        }
        actions={[{ label: t('page.revoke'), destructive: true, onSelect: props.onConfirmRevoke }]}
        onCancel={props.onCancelRevoke}
      />
      <PhoneConfirmSheet
        open={!!props.revokeGrantTarget}
        title={t('page.revokeGrantTitle')}
        message={
          props.revokeGrantTarget?.connected_by ? (
            <Trans
              t={t}
              i18nKey="page.revokeGrantMessageNamed"
              values={{ name: props.revokeGrantTarget.connected_by }}
              components={{ b: <strong /> }}
            />
          ) : (
            t('page.revokeGrantMessageConnector')
          )
        }
        actions={[
          { label: t('page.disconnect'), destructive: true, onSelect: props.onConfirmRevokeGrant },
        ]}
        onCancel={props.onCancelRevokeGrant}
      />
    </ConfigPhoneScreen>
  );
}

/**
 * Create a key, then show its token once. ONE sheet for both steps: closing one sheet
 * and opening another in the same render would pop the new sheet's history entry.
 */
function KeySheet({
  createOpen,
  revealToken,
  onCloseKeySheet,
  name,
  onNameChange,
  scopes,
  onScopesChange,
  isWorkspaceOwner,
  expiry,
  onExpiryChange,
  creating,
  onCreate,
  copy,
  copiedKey,
}: IntegracoesClaudePhoneProps) {
  const { t } = useTranslation('mcp');
  const revealing = !!revealToken;
  const canSubmit = !creating && !!name.trim() && scopes.length > 0;
  return (
    <BottomSheet
      open={createOpen || revealing}
      onOpenChange={(open) => {
        if (!open) onCloseKeySheet();
      }}
      title={revealing ? t('page.revealTitle') : t('page.createKeyTitle')}
      description={revealing ? t('page.revealDescription') : t('page.createKeyDescription')}
      detents={['large']}
      showClose
      className="phone-mcp-sheet"
    >
      {revealing ? (
        <>
          <GroupedList header={t('page.yourKey')}>
            <li className="phone-cell phone-mcp-code">
              <pre className="phone-mcp-code__pre" tabIndex={0} aria-label={t('page.yourKey')}>
                {revealToken}
              </pre>
            </li>
            <CopyCell
              what={t('phone.keyWhat')}
              value={revealToken ?? ''}
              copyKey="token"
              copy={copy}
              copiedKey={copiedKey}
            />
          </GroupedList>
          <PhoneConnectSnippets
            token={revealToken ?? ''}
            copy={copy}
            copiedKey={copiedKey}
            idPrefix="reveal"
          />
          <p className="phone-mcp-note">
            <KeyUsageNote />
          </p>
          <button
            type="button"
            className="phone-config-primary phone-config-primary--block"
            onClick={onCloseKeySheet}
          >
            {t('page.done')}
          </button>
        </>
      ) : (
        <>
          <GroupedList aria-label={t('phone.keyGroup')}>
            <FormRow
              label={t('page.name')}
              input={{
                value: name,
                onChange: (e) => onNameChange(e.target.value),
                placeholder: t('page.namePlaceholder'),
              }}
            />
          </GroupedList>
          <CheckList<string>
            multiple
            header={t('page.permissions')}
            options={scopeCheckOptions(isWorkspaceOwner)}
            value={scopes}
            onChange={onScopesChange}
          />
          <GroupedList aria-label={t('phone.presetGroup')}>
            <Cell
              label={t('page.presetAgent')}
              subtitle={t('phone.presetSubtitle')}
              className="phone-mcp-action"
              onClick={() => onScopesChange(AGENT_PRESET)}
            />
          </GroupedList>
          <GroupedList aria-label={t('page.expiry')}>
            <PickerCell<Expiry>
              label={t('page.expiry')}
              options={expiryOptions()}
              value={expiry}
              onChange={(v) => onExpiryChange(v ?? 'never')}
            />
          </GroupedList>
          <button
            type="button"
            className="phone-config-primary phone-config-primary--block"
            disabled={!canSubmit}
            onClick={onCreate}
          >
            {creating ? t('page.creating') : t('page.createKey')}
          </button>
        </>
      )}
    </BottomSheet>
  );
}

/** Connection snippets for an existing key (the token is pasted, never stored). */
function ConnectSheet({
  connectKey,
  connectToken,
  onConnectTokenChange,
  onCloseConnect,
  copy,
  copiedKey,
}: IntegracoesClaudePhoneProps) {
  const { t } = useTranslation('mcp');
  return (
    <BottomSheet
      open={!!connectKey}
      onOpenChange={(open) => {
        if (!open) onCloseConnect();
      }}
      title={t('page.connectTitle', { name: connectKey?.name ?? '' })}
      description={<Trans t={t} i18nKey="phone.connectDescription" components={{ c: <code /> }} />}
      detents={['large']}
      showClose
      className="phone-mcp-sheet"
    >
      <GroupedList aria-label={t('phone.keyGroup')}>
        <FormRow
          label={t('page.yourKeyOptional')}
          layout="stacked"
          input={{
            value: connectToken,
            onChange: (e) => onConnectTokenChange(e.target.value),
            placeholder: 'mesaas_sk_…',
            autoComplete: 'off',
            spellCheck: false,
            className: 'phone-mcp-mono',
          }}
        />
      </GroupedList>
      <PhoneConnectSnippets
        token={connectToken.trim() || t('guide.keyHerePlaceholder')}
        copy={copy}
        copiedKey={copiedKey}
        idPrefix="connect"
      />
      <p className="phone-mcp-note">
        <KeyUsageNote />
      </p>
      <button
        type="button"
        className="phone-config-primary phone-config-primary--block"
        onClick={onCloseConnect}
      >
        {t('common:actions.close')}
      </button>
    </BottomSheet>
  );
}
