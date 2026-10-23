import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  OWNER_ONLY_HELP,
  OWNER_ONLY_SCOPE_ERROR,
} from '@/lib/mcp-scopes';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  CLIENT_INTRO,
  CLIENT_TABS,
  ChatgptSteps,
  ClaudeKeyNote,
  ClaudeSteps,
  CodexHeadersNote,
  CodexSteps,
  KEY_USAGE_NOTE,
  MANAGER_INTRO,
  MCP_URL,
  MEMBER_INTRO,
  TryItNote,
  buildConnectSnippets,
  codexConfigToml,
  type McpClient,
} from './mcpGuide';
import { IntegracoesClaudePhone } from './IntegracoesClaudePhone';

const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

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
  const { desktopConfig, claudeCodeCmd, codexToml } = buildConnectSnippets(token);
  return (
    <>
      <div className="space-y-1 min-w-0">
        <Label>Claude Desktop</Label>
        <p className="text-xs text-muted-foreground">
          Configurações → Desenvolvedor → Editar configuração (
          <code>claude_desktop_config.json</code>
          ), cole o bloco, salve e reinicie o app.
        </p>
        <CopyBlock
          value={desktopConfig}
          copyKey={`${idPrefix}-desktop`}
          copy={copy}
          copiedKey={copiedKey}
        />
      </div>

      <div className="space-y-1 min-w-0">
        <Label>Claude Code</Label>
        <p className="text-xs text-muted-foreground">Rode este comando no terminal.</p>
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
        <Label>Codex CLI</Label>
        <p className="text-xs text-muted-foreground">
          Adicione este bloco ao arquivo <code>~/.codex/config.toml</code>.
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
          ? 'Limite de chaves atingido para o seu plano.'
          : msg === 'feature_disabled'
            ? 'Recurso não disponível no seu plano.'
            : msg === 'owner_only_scope'
              ? OWNER_ONLY_SCOPE_ERROR
              : 'Erro ao criar chave: ' + msg,
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeMcpKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-keys'] });
      toast.success('Chave revogada.');
    },
    onError: (e: unknown) => toast.error('Erro ao revogar: ' + (e as Error).message),
  });

  const revokeGrantMutation = useMutation({
    mutationFn: (id: string) => revokeOAuthGrant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-oauth-grants'] });
      toast.success('Conexão revogada.');
    },
    onError: (e: unknown) => toast.error('Erro ao desconectar: ' + (e as Error).message),
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
        {canViewConfig ? MANAGER_INTRO : MEMBER_INTRO}
      </p>
      {canViewConfig && !canEditConfig && (
        <p className="text-xs text-muted-foreground" style={{ marginBottom: '1.5rem' }}>
          Somente leitura
        </p>
      )}
      {canEditConfig && <div style={{ marginBottom: '1rem' }} />}

      <FeatureGate flag="feature_mcp" label="Integração com agentes (MCP)">
        <div className="card animate-up" style={{ marginBottom: '1rem' }}>
          <h3 className="config-title" style={{ margin: 0, marginBottom: '0.75rem' }}>
            Como conectar
          </h3>

          <div
            className="page-tabs page-tabs--inline"
            role="tablist"
            aria-label="Escolha o assistente"
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
                {CLIENT_INTRO.claude}
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
                {CLIENT_INTRO.chatgpt}
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
                {CLIENT_INTRO.codex}
              </p>
              <ol className="mcp-steps">
                <CodexSteps />
              </ol>
              <CopyBlock
                value={codexConfigToml('SUA_CHAVE')}
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
            {canViewConfig ? 'Conexões via conector' : 'Suas conexões'}
          </h3>
          <p
            className="text-xs text-muted-foreground"
            style={{ margin: 0, marginBottom: '0.75rem' }}
          >
            Conexões OAuth (claude.ai, Claude Desktop, ChatGPT). Desconecte para revogar o acesso na
            hora.
          </p>
          {activeGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conexão ativa.</p>
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
                      {g.connected_by ?? 'Conexão via conector'}
                    </div>
                    <div className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                      {g.scopes.join(', ')} · conectada {fmtDate(g.created_at)}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    style={{ flexShrink: 0 }}
                    disabled={!canEditConfig && !g.mine}
                    onClick={() => setRevokeGrantTarget(g)}
                  >
                    Desconectar
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
                Chaves de API
              </h3>
              <Button disabled={!canEditConfig} onClick={() => setCreateOpen(true)}>
                Criar chave
              </Button>
            </div>

            {isLoading ? (
              <ListSkeleton rows={2} />
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma chave ainda. Crie uma para conectar um agente.
              </p>
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
                        {k.last_used_at ? ` · usada ${fmtDate(k.last_used_at)}` : ' · nunca usada'}
                        {k.expires_at ? ` · expira ${fmtDate(k.expires_at)}` : ''}
                      </div>
                    </div>
                    {k.revoked_at ? (
                      <span className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                        revogada
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
                          Conectar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canEditConfig}
                          onClick={() => setRevokeTarget(k)}
                        >
                          Revogar
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
            <DialogTitle>Criar chave de API</DialogTitle>
            <DialogDescription>
              Gere uma chave para conectar um agente a este workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Agente de conteúdo"
              />
            </div>
            <div className="space-y-2">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Label>Permissões</Label>
                <button
                  type="button"
                  className="text-xs underline text-primary"
                  onClick={() => setScopes(AGENT_PRESET)}
                >
                  Preset: Agente de conteúdo
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
                      <span className="text-sm">{s.label}</span>
                    </label>
                    {locked && (
                      <p className="text-xs text-muted-foreground" style={{ marginLeft: '1.5rem' }}>
                        {OWNER_ONLY_HELP}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="space-y-1">
              <Label>Expiração</Label>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as 'never' | '30' | '90')}
                className="form-input"
                style={{ width: '100%' }}
              >
                <option value="never">Nunca</option>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
            >
              {createMutation.isPending ? 'Criando…' : 'Criar chave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time token reveal */}
      <Dialog open={!!revealToken} onOpenChange={(o) => !o && setRevealToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copie sua chave agora</DialogTitle>
            <DialogDescription>
              Por segurança, não mostraremos esta chave novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1 min-w-0">
              <Label>Sua chave</Label>
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

            <p className="text-xs text-muted-foreground">{KEY_USAGE_NOTE}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealToken(null)}>Concluído</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect an existing key */}
      <Dialog open={!!connectKey} onOpenChange={(o) => !o && setConnectKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar: {connectKey?.name}</DialogTitle>
            <DialogDescription>
              Por segurança não armazenamos a chave. Cole a chave que você copiou ao criar — ou use
              o modelo abaixo substituindo <code>SUA_CHAVE_AQUI</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="space-y-1">
              <Label>Sua chave (opcional)</Label>
              <Input
                value={connectToken}
                onChange={(e) => setConnectToken(e.target.value)}
                placeholder="mesaas_sk_…"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <ConnectSnippets
              token={connectToken.trim() || 'SUA_CHAVE_AQUI'}
              copy={copy}
              copiedKey={copiedKey}
              idPrefix="connect"
            />
            <p className="text-xs text-muted-foreground">{KEY_USAGE_NOTE}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setConnectKey(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar chave?</AlertDialogTitle>
            <AlertDialogDescription>
              A chave <strong>{revokeTarget?.name}</strong> deixará de funcionar imediatamente.
              Agentes conectados perderão o acesso. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revogar
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
            <AlertDialogTitle>Desconectar?</AlertDialogTitle>
            <AlertDialogDescription>
              A conexão{' '}
              {revokeGrantTarget?.connected_by ? (
                <>
                  de <strong>{revokeGrantTarget.connected_by}</strong>
                </>
              ) : (
                'via conector'
              )}{' '}
              perderá o acesso imediatamente. Para reconectar, será necessário autorizar novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevokeGrant}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
