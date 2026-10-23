import type { ReactNode } from 'react';
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
import { SCOPE_OPTIONS, AGENT_PRESET } from '@/lib/mcp-scopes';
import type { McpKey } from '@/services/mcp-keys';
import type { OAuthGrant } from '@/services/mcp-oauth';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfigPhoneScreen } from '../phone/ConfigPhoneScreen';
import {
  CLIENT_INTRO,
  MANAGER_INTRO,
  MEMBER_INTRO,
  ChatgptSteps,
  ClaudeKeyNote,
  ClaudeSteps,
  CodexHeadersNote,
  CodexSteps,
  KEY_USAGE_NOTE,
  MCP_URL,
  TryItNote,
  buildConnectSnippets,
  codexConfigToml,
  type McpClient,
} from './mcpGuide';
import './mcpPhone.css';

type Expiry = 'never' | '30' | '90';
type CopyFn = (text: string, key: string) => void;

const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: 'never', label: 'Nunca' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
];

const SCOPE_CHECK_OPTIONS = SCOPE_OPTIONS.map((s) => ({
  value: s.value as string,
  label: s.label,
}));

export interface IntegracoesClaudePhoneProps {
  /** `configuracoes:ver`: API keys and every member's connections. Without it, only the
   *  connector guide and the member's own connections render. */
  canManage: boolean;
  canEdit: boolean;
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
  const copied = copiedKey === copyKey;
  return (
    <Cell
      label={copied ? 'Copiado' : 'Copiar'}
      icon={copied ? <Check /> : <Copy />}
      aria-label={`Copiar ${what}`}
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
  const { desktopConfig, claudeCodeCmd, codexToml } = buildConnectSnippets(token);
  return (
    <>
      <GroupedList
        header="Claude Desktop"
        footer={
          <>
            Configurações → Desenvolvedor → Editar configuração (
            <code>claude_desktop_config.json</code>
            ), cole o bloco, salve e reinicie o app.
          </>
        }
      >
        <CodeCells
          what="configuração do Claude Desktop"
          value={desktopConfig}
          copyKey={`${idPrefix}-desktop`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </GroupedList>
      <GroupedList header="Claude Code" footer="Rode este comando no terminal.">
        <CodeCells
          what="comando do Claude Code"
          value={claudeCodeCmd}
          copyKey={`${idPrefix}-code`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </GroupedList>
      <GroupedList
        header="Codex CLI"
        footer={
          <>
            Adicione este bloco ao arquivo <code>~/.codex/config.toml</code>.
          </>
        }
      >
        <CodeCells
          what="configuração do Codex CLI"
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
      title="Agentes (MCP)"
      subtitle={
        <>
          {canManage ? MANAGER_INTRO : MEMBER_INTRO}
          {canManage && !canEdit && <span className="phone-mcp-readonly"> Somente leitura.</span>}
        </>
      }
    >
      <FeatureGate flag="feature_mcp" label="Integração com agentes (MCP)">
        <h2 className="phone-group__header phone-mcp-heading">Como conectar</h2>
        <SegmentedControl<McpClient>
          semantics="tablist"
          aria-label="Escolha o assistente"
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
            aria-label={`Como conectar: ${clientTabs.find((t) => t.id === client)?.label}`}
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
              <p className="phone-mcp-guide__intro">{CLIENT_INTRO[client]}</p>
              <ol className="phone-mcp-steps">
                <Steps />
              </ol>
            </li>
            {client === 'codex' ? (
              <CodeCells
                what="configuração do Codex"
                value={codexConfigToml('SUA_CHAVE')}
                copyKey="codex-toml"
                copy={copy}
                copiedKey={copiedKey}
              />
            ) : (
              <>
                <Cell
                  label="URL do servidor MCP"
                  subtitle={<span className="phone-mcp-mono">{MCP_URL}</span>}
                  className="phone-mcp-url"
                />
                <CopyCell
                  what="URL do MCP"
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
          header={canManage ? 'Conexões via conector' : 'Suas conexões'}
          footer="Conexões OAuth (claude.ai, Claude Desktop, ChatGPT). Desconecte para revogar o acesso na hora."
        >
          {grants.length === 0 ? (
            <Cell label="Nenhuma conexão ativa." className="phone-mcp-empty" />
          ) : (
            grants.map((g) => {
              const who = g.connected_by ?? 'Conexão via conector';
              const disconnect = () => props.onRevokeGrant(g);
              const canDisconnect = canEdit || g.mine;
              return (
                <MenuRow
                  key={g.id}
                  label={who}
                  subtitle={`${g.scopes.join(', ')} · conectada ${fmtDate(g.created_at)}`}
                  menuLabel={`Ações de ${who}`}
                  sections={[
                    [
                      {
                        label: 'Desconectar',
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
                            label: 'Desconectar',
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
            header="Chaves de API"
            footer={
              !keysLoading && keys.length === 0
                ? 'Nenhuma chave ainda. Crie uma para conectar um agente.'
                : undefined
            }
          >
            <Cell
              label="Criar chave"
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
                k.last_used_at ? `usada ${fmtDate(k.last_used_at)}` : 'nunca usada',
                k.expires_at ? `expira ${fmtDate(k.expires_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              if (k.revoked_at) {
                return (
                  <MenuRow
                    key={k.id}
                    label={k.name}
                    subtitle={meta}
                    value="revogada"
                    menuLabel={`Ações da chave ${k.name}`}
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
                  menuLabel={`Ações da chave ${k.name}`}
                  onTap={connect}
                  sections={[
                    [{ label: 'Conectar', icon: <Link2 />, onSelect: connect }],
                    [
                      {
                        label: 'Revogar',
                        icon: <KeyRound />,
                        destructive: true,
                        disabled: !canEdit,
                        onSelect: revoke,
                      },
                    ],
                  ]}
                  swipeActions={[
                    { label: 'Conectar', icon: <Link2 />, tone: 'neutral', onAction: connect },
                    ...(canEdit
                      ? [
                          {
                            label: 'Revogar',
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
        title="Revogar chave?"
        message={
          <>
            A chave <strong>{props.revokeTarget?.name}</strong> deixará de funcionar imediatamente.
            Agentes conectados perderão o acesso. Esta ação não pode ser desfeita.
          </>
        }
        actions={[{ label: 'Revogar', destructive: true, onSelect: props.onConfirmRevoke }]}
        onCancel={props.onCancelRevoke}
      />
      <PhoneConfirmSheet
        open={!!props.revokeGrantTarget}
        title="Desconectar?"
        message={
          <>
            A conexão{' '}
            {props.revokeGrantTarget?.connected_by ? (
              <>
                de <strong>{props.revokeGrantTarget.connected_by}</strong>
              </>
            ) : (
              'via conector'
            )}{' '}
            perderá o acesso imediatamente. Para reconectar, será necessário autorizar novamente.
          </>
        }
        actions={[
          { label: 'Desconectar', destructive: true, onSelect: props.onConfirmRevokeGrant },
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
  expiry,
  onExpiryChange,
  creating,
  onCreate,
  copy,
  copiedKey,
}: IntegracoesClaudePhoneProps) {
  const revealing = !!revealToken;
  const canSubmit = !creating && !!name.trim() && scopes.length > 0;
  return (
    <BottomSheet
      open={createOpen || revealing}
      onOpenChange={(open) => {
        if (!open) onCloseKeySheet();
      }}
      title={revealing ? 'Copie sua chave agora' : 'Criar chave de API'}
      description={
        revealing
          ? 'Por segurança, não mostraremos esta chave novamente.'
          : 'Gere uma chave para conectar um agente a este workspace.'
      }
      detents={['large']}
      showClose
      className="phone-mcp-sheet"
    >
      {revealing ? (
        <>
          <GroupedList header="Sua chave">
            <li className="phone-cell phone-mcp-code">
              <pre className="phone-mcp-code__pre" tabIndex={0} aria-label="Sua chave">
                {revealToken}
              </pre>
            </li>
            <CopyCell
              what="chave"
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
          <p className="phone-mcp-note">{KEY_USAGE_NOTE}</p>
          <button
            type="button"
            className="phone-config-primary phone-config-primary--block"
            onClick={onCloseKeySheet}
          >
            Concluído
          </button>
        </>
      ) : (
        <>
          <GroupedList aria-label="Chave">
            <FormRow
              label="Nome"
              input={{
                value: name,
                onChange: (e) => onNameChange(e.target.value),
                placeholder: 'Ex: Agente de conteúdo',
              }}
            />
          </GroupedList>
          <CheckList<string>
            multiple
            header="Permissões"
            options={SCOPE_CHECK_OPTIONS}
            value={scopes}
            onChange={onScopesChange}
          />
          <GroupedList aria-label="Preset de permissões">
            <Cell
              label="Preset: Agente de conteúdo"
              subtitle="Só leitura: clientes, posts, fluxos, ideias, tarefas e equipe"
              className="phone-mcp-action"
              onClick={() => onScopesChange(AGENT_PRESET)}
            />
          </GroupedList>
          <GroupedList aria-label="Expiração">
            <PickerCell<Expiry>
              label="Expiração"
              options={EXPIRY_OPTIONS}
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
            {creating ? 'Criando…' : 'Criar chave'}
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
  return (
    <BottomSheet
      open={!!connectKey}
      onOpenChange={(open) => {
        if (!open) onCloseConnect();
      }}
      title={`Conectar: ${connectKey?.name ?? ''}`}
      description={
        <>
          Por segurança não armazenamos a chave. Cole a chave que você copiou ao criar, ou use o
          modelo abaixo substituindo <code>SUA_CHAVE_AQUI</code>.
        </>
      }
      detents={['large']}
      showClose
      className="phone-mcp-sheet"
    >
      <GroupedList aria-label="Chave">
        <FormRow
          label="Sua chave (opcional)"
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
        token={connectToken.trim() || 'SUA_CHAVE_AQUI'}
        copy={copy}
        copiedKey={copiedKey}
        idPrefix="connect"
      />
      <p className="phone-mcp-note">{KEY_USAGE_NOTE}</p>
      <button
        type="button"
        className="phone-config-primary phone-config-primary--block"
        onClick={onCloseConnect}
      >
        Fechar
      </button>
    </BottomSheet>
  );
}
