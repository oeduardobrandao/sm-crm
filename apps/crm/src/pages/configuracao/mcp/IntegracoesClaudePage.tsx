import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { Copy, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ListSkeleton } from '@/components/ui/skeletons';
import { listMcpKeys, createMcpKey, revokeMcpKey, type McpKey } from '@/services/mcp-keys';
import { listOAuthGrants, revokeOAuthGrant, type OAuthGrant } from '@/services/mcp-oauth';
import {
  SCOPE_OPTIONS,
  AGENT_PRESET,
  ownerOnlyHelp,
  ownerOnlyScopeError,
  scopeLabel,
} from '@/lib/mcp-scopes';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  CLIENT_TABS,
  ChatgptSteps,
  ClaudeKeyNote,
  ClaudeSteps,
  ClientIntro,
  CodexHeadersNote,
  CodexSteps,
  KeyUsageNote,
  ManagerIntro,
  MCP_URL,
  MemberIntro,
  TryItNote,
  buildConnectSnippets,
  codexConfigToml,
  type McpClient,
} from './mcpGuide';
import { IntegracoesClaudePhone } from './IntegracoesClaudePhone';

const fmtDate = (s: string) => new Date(s).toLocaleDateString(getIntlLocale());

/** Copy-paste connection snippets for a given token (real at creation, or a placeholder/pasted). */
function ConnectSnippets({
  token,
  copy,
  copiedKey,
  idPrefix,
}: {
  token: string;
  copy: (text: string, key: string) => void;
  copiedKey: string | null;
  idPrefix: string;
}) {
  const { t } = useTranslation('mcp');
  const { desktopConfig, claudeCodeCmd, codexToml } = buildConnectSnippets(token);
  return (
    <>
      <div className="space-y-1 min-w-0">
        <Label>{'Claude Desktop' /* product name */}</Label>
        <p className="text-xs text-muted-foreground">
          <Trans t={t} i18nKey="snippets.desktopHelp" components={{ c: <code /> }} />
        </p>
        <CopyBlock
          value={desktopConfig}
          copyKey={`${idPrefix}-desktop`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </div>

      <div className="space-y-1 min-w-0">
        <Label>{'Claude Code' /* product name */}</Label>
        <p className="text-xs text-muted-foreground">{t('snippets.codeHelp')}</p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
          <Input
            readOnly
            value={claudeCodeCmd}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', flex: 1, minWidth: 0 }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(claudeCodeCmd, `${idPrefix}-code`)}
          >
            {copiedKey === `${idPrefix}-code` ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-1 min-w-0">
        <Label>{'Codex CLI' /* product name */}</Label>
        <p className="text-xs text-muted-foreground">
          <Trans t={t} i18nKey="snippets.codexHelp" components={{ c: <code /> }} />
        </p>
        <CopyBlock
          value={codexToml}
          copyKey={`${idPrefix}-codex`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </div>
    </>
  );
}

/** Multi-line copy block for config snippets, shared by the connection guides. */
function CopyBlock({
  value,
  copyKey,
  copy,
  copiedKey,
}: {
  value: string;
  copyKey: string;
  copy: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <pre
        style={{
          background: 'var(--surface-darker)',
          padding: '0.75rem',
          borderRadius: '8px',
          overflowX: 'auto',
          maxWidth: '100%',
          fontSize: '0.7rem',
          fontFamily: 'var(--font-mono)',
          margin: 0,
        }}
      >
        {value}
      </pre>
      <Button
        variant="outline"
        size="sm"
        onClick={() => copy(value, copyKey)}
        style={{ position: 'absolute', top: '0.4rem', right: '0.4rem' }}
      >
        {copiedKey === copyKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

/** Read-only copy field for a URL or command, shared by the connection guides. */
function CopyField({
  value,
  copyKey,
  copy,
  copiedKey,
}: {
  value: string;
  copyKey: string;
  copy: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
      <Input
        readOnly
        value={value}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', flex: 1, minWidth: 0 }}
      />
      <Button variant="outline" size="sm" onClick={() => copy(value, copyKey)}>
        {copiedKey === copyKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function IntegracoesClaudePage() {
  const { t } = useTranslation('mcp');
  const { can, workspaceRole } = useAuth();
  // financeiro:* scopes are owner-only. null (unresolved) counts as not owner.
  const isWorkspaceOwner = workspaceRole === 'owner';
  // The tab is open to every member: anyone can connect Claude via OAuth with the scopes their
  // own role allows, and sees (and can disconnect) their own connections. API keys and the
  // workspace's full connection list stay behind `configuracoes:ver`.
  const canViewConfig = can('configuracoes', 'ver') === true;
  // F4 (revisão externa): criar/revogar chave e desconectar um grant são
  // escritas -- um papel `ver`-only via todos esses controles. Aqui as
  // escritas passam por edge functions que negam de verdade, mas o controle
  // ativo ainda promete uma ação que sempre falha.
  const canEditConfig = can('configuracoes', 'editar') === true;
  const queryClient = useQueryClient();
  const isPhone = !useIsDesktop(768);

  const [client, setClient] = useState<McpClient>('claude');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(AGENT_PRESET);
  const [expiry, setExpiry] = useState<'never' | '30' | '90'>('never');
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState<McpKey | null>(null);
  const [connectToken, setConnectToken] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<McpKey | null>(null);
  const [revokeGrantTarget, setRevokeGrantTarget] = useState<OAuthGrant | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['mcp-keys'],
    queryFn: listMcpKeys,
    enabled: canViewConfig,
  });

  const { data: grants = [] } = useQuery({
    queryKey: ['mcp-oauth-grants'],
    queryFn: listOAuthGrants,
  });
  const activeGrants = grants.filter((g) => !g.revoked_at);
  // Codex connects with an API key, which only `configuracoes` can create.
  const clientTabs = canViewConfig ? CLIENT_TABS : CLIENT_TABS.filter((t) => t.id !== 'codex');

  const createMutation = useMutation({
    mutationFn: () => {
      const expires_at =
        expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 86400000).toISOString();
      return createMcpKey({ name: name.trim(), scopes, expires_at });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-keys'] });
      setCreateOpen(false);
      setRevealToken(res.token);
      setName('');
      setScopes(AGENT_PRESET);
      setExpiry('never');
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message;
      toast.error(
        msg === 'key_limit_reached'
          ? t('toast.keyLimit')
          : msg === 'feature_disabled'
            ? t('toast.featureDisabled')
            : msg === 'owner_only_scope'
              ? ownerOnlyScopeError()
              : t('toast.createError', { message: msg }),
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeMcpKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-keys'] });
      toast.success(t('toast.keyRevoked'));
    },
    onError: (e: unknown) => toast.error(t('toast.revokeError', { message: (e as Error).message })),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: (id: string) => revokeOAuthGrant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-oauth-grants'] });
      toast.success(t('toast.grantRevoked'));
    },
    onError: (e: unknown) =>
      toast.error(t('toast.disconnectError', { message: (e as Error).message })),
  });

  const toggleScope = (value: string) =>
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const confirmRevoke = () => {
    if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
    setRevokeTarget(null);
  };

  const confirmRevokeGrant = () => {
    if (revokeGrantTarget) revokeGrantMutation.mutate(revokeGrantTarget.id);
    setRevokeGrantTarget(null);
  };

  if (isPhone) {
    // Phone: the same state and mutations, drawn as grouped lists and sheets. The
    // desktop Dialogs/AlertDialogs below never mount here.
    return (
      <IntegracoesClaudePhone
        canManage={canViewConfig}
        canEdit={canEditConfig}
        isWorkspaceOwner={isWorkspaceOwner}
        clientTabs={clientTabs}
        client={client}
        onClientChange={setClient}
        copy={copy}
        copiedKey={copiedKey}
        grants={activeGrants}
        keys={keys}
        keysLoading={isLoading}
        createOpen={createOpen}
        onOpenCreate={() => setCreateOpen(true)}
        name={name}
        onNameChange={setName}
        scopes={scopes}
        onScopesChange={setScopes}
        expiry={expiry}
        onExpiryChange={setExpiry}
        creating={createMutation.isPending}
        onCreate={() => createMutation.mutate()}
        revealToken={revealToken}
        onCloseKeySheet={() => {
          if (revealToken) setRevealToken(null);
          else setCreateOpen(false);
        }}
        connectKey={connectKey}
        connectToken={connectToken}
        onConnectTokenChange={setConnectToken}
        onOpenConnect={(k) => {
          setConnectToken('');
          setConnectKey(k);
        }}
        onCloseConnect={() => setConnectKey(null)}
        revokeTarget={revokeTarget}
        onRevoke={setRevokeTarget}
        onConfirmRevoke={confirmRevoke}
        onCancelRevoke={() => setRevokeTarget(null)}
        revokeGrantTarget={revokeGrantTarget}
        onRevokeGrant={setRevokeGrantTarget}
        onConfirmRevokeGrant={confirmRevokeGrant}
        onCancelRevokeGrant={() => setRevokeGrantTarget(null)}
      />
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground" style={{ marginBottom: '0.5rem' }}>
        {canViewConfig ? <ManagerIntro /> : <MemberIntro />}
      </p>
      {canViewConfig && !canEditConfig && (
        <p className="text-xs text-muted-foreground" style={{ marginBottom: '1.5rem' }}>
          {t('page.readOnly')}
        </p>
      )}
      {canEditConfig && <div style={{ marginBottom: '1rem' }} />}

      <FeatureGate flag="feature_mcp" label={t('page.featureLabel')}>
        <div className="card animate-up" style={{ marginBottom: '1rem' }}>
          <h3 className="config-title" style={{ margin: 0, marginBottom: '0.75rem' }}>
            {t('page.howToConnect')}
          </h3>

          <div
            className="page-tabs page-tabs--inline"
            role="tablist"
            aria-label={t('page.chooseAssistant')}
            style={{ marginBottom: '1rem' }}
          >
            {clientTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={client === t.id}
                className={`page-tab${client === t.id ? ' active' : ''}`}
                onClick={() => setClient(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {client === 'claude' && (
            <div className="space-y-3 min-w-0">
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                <ClientIntro client="claude" />
              </p>
              <ol className="mcp-steps">
                <ClaudeSteps />
              </ol>
              <CopyField value={MCP_URL} copyKey="mcp-url" copy={copy} copiedKey={copiedKey} />
              {canViewConfig && (
                <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                  <ClaudeKeyNote />
                </p>
              )}
            </div>
          )}

          {client === 'chatgpt' && (
            <div className="space-y-3 min-w-0">
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                <ClientIntro client="chatgpt" />
              </p>
              <ol className="mcp-steps">
                <ChatgptSteps />
              </ol>
              <CopyField value={MCP_URL} copyKey="mcp-url" copy={copy} copiedKey={copiedKey} />
            </div>
          )}

          {client === 'codex' && canViewConfig && (
            <div className="space-y-3 min-w-0">
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                <ClientIntro client="codex" />
              </p>
              <ol className="mcp-steps">
                <CodexSteps />
              </ol>
              <CopyBlock
                value={codexConfigToml(t('guide.keyPlaceholder'))}
                copyKey="codex-toml"
                copy={copy}
                copiedKey={copiedKey}
              />
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                <CodexHeadersNote />
              </p>
            </div>
          )}

          <p
            className="text-xs text-muted-foreground"
            style={{ marginTop: '1rem', marginBottom: 0 }}
          >
            <TryItNote />
          </p>
        </div>

        <div className="card animate-up" style={{ marginBottom: '1rem' }}>
          <h3 className="config-title" style={{ margin: 0, marginBottom: '0.25rem' }}>
            {canViewConfig ? t('page.grantsTitleManager') : t('page.grantsTitleMember')}
          </h3>
          <p
            className="text-xs text-muted-foreground"
            style={{ margin: 0, marginBottom: '0.75rem' }}
          >
            {t('page.grantsHelp')}
          </p>
          {activeGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.noGrants')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {activeGrants.map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '0.75rem',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {g.connected_by ?? t('page.grantFallback')}
                    </div>
                    <div className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                      {t('page.grantMeta', {
                        scopes: g.scopes.join(', '),
                        date: fmtDate(g.created_at),
                      })}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    style={{ flexShrink: 0 }}
                    disabled={!canEditConfig && !g.mine}
                    onClick={() => setRevokeGrantTarget(g)}
                  >
                    {t('page.disconnect')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {canViewConfig && (
          <div className="card animate-up">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <h3 className="config-title" style={{ margin: 0 }}>
                {t('page.apiKeys')}
              </h3>
              <Button disabled={!canEditConfig} onClick={() => setCreateOpen(true)}>
                {t('page.createKey')}
              </Button>
            </div>

            {isLoading ? (
              <ListSkeleton rows={2} />
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('page.noKeys')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {keys.map((k) => (
                  <div
                    key={k.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '0.75rem',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {k.name}{' '}
                        <span
                          className="text-muted-foreground"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          …{k.token_suffix}
                        </span>
                      </div>
                      <div className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                        {k.scopes.join(', ')}
                        {k.last_used_at
                          ? ` · ${t('page.keyUsed', { date: fmtDate(k.last_used_at) })}`
                          : ` · ${t('page.keyNeverUsed')}`}
                        {k.expires_at
                          ? ` · ${t('page.keyExpires', { date: fmtDate(k.expires_at) })}`
                          : ''}
                      </div>
                    </div>
                    {k.revoked_at ? (
                      <span className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                        {t('page.revoked')}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setConnectToken('');
                            setConnectKey(k);
                          }}
                        >
                          {t('page.connect')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canEditConfig}
                          onClick={() => setRevokeTarget(k)}
                        >
                          {t('page.revoke')}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </FeatureGate>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('page.createKeyTitle')}</DialogTitle>
            <DialogDescription>{t('page.createKeyDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1">
              <Label>{t('page.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('page.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Label>{t('page.permissions')}</Label>
                <button
                  type="button"
                  className="text-xs underline text-primary"
                  onClick={() => setScopes(AGENT_PRESET)}
                >
                  {t('page.presetAgent')}
                </button>
              </div>
              {SCOPE_OPTIONS.map((s) => {
                const locked = s.ownerOnly && !isWorkspaceOwner;
                return (
                  <div key={s.value}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: locked ? 'not-allowed' : 'pointer',
                        opacity: locked ? 0.6 : 1,
                      }}
                    >
                      <Checkbox
                        checked={scopes.includes(s.value)}
                        disabled={locked}
                        onCheckedChange={() => toggleScope(s.value)}
                      />
                      <span className="text-sm">{scopeLabel(s.value)}</span>
                    </label>
                    {locked && (
                      <p className="text-xs text-muted-foreground" style={{ marginLeft: '1.5rem' }}>
                        {ownerOnlyHelp()}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="space-y-1">
              <Label>{t('page.expiry')}</Label>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as 'never' | '30' | '90')}
                className="form-input"
                style={{ width: '100%' }}
              >
                <option value="never">{t('page.expiryNever')}</option>
                <option value="30">{t('page.expiry30')}</option>
                <option value="90">{t('page.expiry90')}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
            >
              {createMutation.isPending ? t('page.creating') : t('page.createKey')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time token reveal */}
      <Dialog open={!!revealToken} onOpenChange={(o) => !o && setRevealToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('page.revealTitle')}</DialogTitle>
            <DialogDescription>{t('page.revealDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1 min-w-0">
              <Label>{t('page.yourKey')}</Label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                <Input
                  readOnly
                  value={revealToken ?? ''}
                  style={{ fontFamily: 'var(--font-mono)', flex: 1, minWidth: 0 }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(revealToken ?? '', 'token')}
                >
                  {copiedKey === 'token' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <ConnectSnippets
              token={revealToken ?? ''}
              copy={copy}
              copiedKey={copiedKey}
              idPrefix="reveal"
            />

            <p className="text-xs text-muted-foreground">
              <KeyUsageNote />
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealToken(null)}>{t('page.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect an existing key */}
      <Dialog open={!!connectKey} onOpenChange={(o) => !o && setConnectKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('page.connectTitle', { name: connectKey?.name ?? '' })}</DialogTitle>
            <DialogDescription>
              <Trans t={t} i18nKey="page.connectDescription" components={{ c: <code /> }} />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1">
              <Label>{t('page.yourKeyOptional')}</Label>
              <Input
                value={connectToken}
                onChange={(e) => setConnectToken(e.target.value)}
                placeholder="mesaas_sk_…"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <ConnectSnippets
              token={connectToken.trim() || t('guide.keyHerePlaceholder')}
              copy={copy}
              copiedKey={copiedKey}
              idPrefix="connect"
            />
            <p className="text-xs text-muted-foreground">
              <KeyUsageNote />
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setConnectKey(null)}>{t('common:actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.revokeKeyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey="page.revokeKeyMessage"
                values={{ name: revokeTarget?.name ?? '' }}
                components={{ b: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('page.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke OAuth connection confirmation */}
      <AlertDialog
        open={!!revokeGrantTarget}
        onOpenChange={(o) => !o && setRevokeGrantTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.revokeGrantTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeGrantTarget?.connected_by ? (
                <Trans
                  t={t}
                  i18nKey="page.revokeGrantMessageNamed"
                  values={{ name: revokeGrantTarget.connected_by }}
                  components={{ b: <strong /> }}
                />
              ) : (
                t('page.revokeGrantMessageConnector')
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevokeGrant}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('page.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
