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
import { listMcpKeys, createMcpKey, revokeMcpKey, type McpKey } from '@/services/mcp-keys';
import { listOAuthGrants, revokeOAuthGrant, type OAuthGrant } from '@/services/mcp-oauth';
import { SCOPE_OPTIONS, AGENT_PRESET } from '@/lib/mcp-scopes';

const MCP_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp';
const MESAAS_LOGO_URL = 'https://www.mesaas.com.br/mesaas-icon-256.png';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

const codexConfigToml = (token: string) =>
  `[mcp_servers.mesaas]
url = "${MCP_URL}"

[mcp_servers.mesaas.http_headers]
Authorization = "Bearer ${token}"`;

type McpClient = 'claude' | 'chatgpt' | 'codex';

const CLIENT_TABS: { id: McpClient; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'codex', label: 'Codex' },
];

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
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        mesaas: {
          command: 'npx',
          args: ['-y', 'mcp-remote', MCP_URL, '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  const claudeCodeCmd = `claude mcp add --transport http mesaas ${MCP_URL} --header "Authorization: Bearer ${token}"`;
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
          value={codexConfigToml(token)}
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
  const { can } = useAuth();
  // The `configuracoes` tab itself is already gated on `configuracoes:ver`
  // at the tab layer (configTabs.ts, Task 12) -- mirrors that here. Was
  // `role === 'owner' || role === 'admin'`, which a custom role with the
  // chassis 'agent' role never passed even when it held the tab-level
  // grant.
  const canViewConfig = can('configuracoes', 'ver') === true;
  // F4 (revisão externa): criar/revogar chave e desconectar um grant são
  // escritas -- um papel `ver`-only via todos esses controles. Aqui as
  // escritas passam por edge functions que negam de verdade, mas o controle
  // ativo ainda promete uma ação que sempre falha.
  const canEditConfig = can('configuracoes', 'editar') === true;
  const queryClient = useQueryClient();

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
    enabled: canViewConfig,
  });
  const activeGrants = grants.filter((g) => !g.revoked_at);

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

  if (!canViewConfig) {
    return (
      <div className="card animate-up">
        <p className="text-sm text-muted-foreground">
          Apenas proprietários e administradores podem gerenciar as chaves de API.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground" style={{ marginBottom: '0.5rem' }}>
        Conecte Claude, ChatGPT ou Codex para ler clientes, posts e pautas deste workspace.
      </p>
      {!canEditConfig && (
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
            {CLIENT_TABS.map((t) => (
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
                Sem chave: a conexão usa OAuth e pode ser revogada aqui a qualquer momento.
              </p>
              <ol className="mcp-steps">
                <li>
                  <span>
                    No claude.ai ou no Claude Desktop, abra{' '}
                    <strong>Configurações → Conectores → Adicionar conector personalizado</strong>.
                  </span>
                </li>
                <li>
                  <span>
                    Cole a URL abaixo, deixe os campos de OAuth em branco e clique em{' '}
                    <strong>Adicionar</strong>.
                  </span>
                </li>
                <li>
                  <span>
                    Faça login no Mesaas, escolha o workspace e as permissões e clique em{' '}
                    <strong>Autorizar</strong>.
                  </span>
                </li>
              </ol>
              <CopyField value={MCP_URL} copyKey="mcp-url" copy={copy} copiedKey={copiedKey} />
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                Claude Code, API ou agentes headless usam uma chave: crie uma em{' '}
                <strong>Chaves de API</strong> abaixo e copie o comando pronto.
              </p>
            </div>
          )}

          {client === 'chatgpt' && (
            <div className="space-y-3 min-w-0">
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                Sem chave: a conexão usa OAuth. Requer o modo de desenvolvedor do ChatGPT (não exige
                plano pago).
              </p>
              <ol className="mcp-steps">
                <li>
                  <span>
                    No ChatGPT, abra <strong>Configurações → Security and login</strong> e ative o{' '}
                    <strong>Developer mode</strong> (opção marcada como "elevated risk"; também
                    acessível em <strong>Configurações → Plugins</strong>).
                  </span>
                </li>
                <li>
                  <span>
                    Abra <strong>chatgpt.com/plugins</strong>, clique no botão <strong>+</strong> e,
                    no diálogo <strong>New Plugin</strong>, dê o nome "Mesaas", cole a URL abaixo em{' '}
                    <strong>MCP Server URL</strong> e escolha <strong>OAuth</strong> como
                    autenticação.
                  </span>
                </li>
                <li>
                  <span>
                    Opcional: para o conector aparecer com a nossa marca,{' '}
                    <a
                      href={MESAAS_LOGO_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-primary"
                    >
                      baixe a logo do Mesaas (PNG)
                    </a>{' '}
                    e envie no campo <strong>Icon</strong>. O ícone só pode ser definido nesse
                    passo: depois de criado o conector, não dá para trocar.
                  </span>
                </li>
                <li>
                  <span>
                    Marque a confirmação de risco, clique em <strong>Create</strong> e depois em{' '}
                    <strong>Sign in with Mesaas</strong>: faça login, escolha o workspace e as
                    permissões e clique em <strong>Autorizar</strong>.
                  </span>
                </li>
                <li>
                  <span>
                    Na conversa, clique no botão <strong>+</strong> do campo de mensagem e ative o{' '}
                    <strong>Mesaas</strong>.
                  </span>
                </li>
              </ol>
              <CopyField value={MCP_URL} copyKey="mcp-url" copy={copy} copiedKey={copiedKey} />
            </div>
          )}

          {client === 'codex' && (
            <div className="space-y-3 min-w-0">
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                O Codex CLI conecta com uma chave de API deste workspace, direto via HTTP (sem
                dependências extras).
              </p>
              <ol className="mcp-steps">
                <li>
                  <span>
                    Crie uma chave em <strong>Chaves de API</strong> abaixo e copie o valor (ele
                    aparece uma única vez).
                  </span>
                </li>
                <li>
                  <span>
                    Adicione o bloco abaixo ao arquivo <code>~/.codex/config.toml</code>, trocando{' '}
                    <code>SUA_CHAVE</code> pela chave copiada.
                  </span>
                </li>
                <li>
                  <span>
                    Abra o Codex e confirme com <code>/mcp</code> que o servidor{' '}
                    <strong>mesaas</strong> aparece na lista.
                  </span>
                </li>
              </ol>
              <CopyBlock
                value={codexConfigToml('SUA_CHAVE')}
                copyKey="codex-toml"
                copy={copy}
                copiedKey={copiedKey}
              />
              <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
                Use <code>http_headers</code> como no bloco: o campo <code>bearer_token</code> não é
                aceito para servidores HTTP.
              </p>
            </div>
          )}

          <p
            className="text-xs text-muted-foreground"
            style={{ marginTop: '1rem', marginBottom: 0 }}
          >
            Depois, peça ao assistente: <em>"liste meus clientes ativos"</em> ou{' '}
            <em>"mostre o post X com métricas"</em>.
          </p>
        </div>

        <div className="card animate-up" style={{ marginBottom: '1rem' }}>
          <h3 className="config-title" style={{ margin: 0, marginBottom: '0.25rem' }}>
            Conexões via conector
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
                    disabled={!canEditConfig}
                    onClick={() => setRevokeGrantTarget(g)}
                  >
                    Desconectar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

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
            <p className="text-sm text-muted-foreground">Carregando…</p>
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
              {SCOPE_OPTIONS.map((s) => (
                <label
                  key={s.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  <Checkbox
                    checked={scopes.includes(s.value)}
                    onCheckedChange={() => toggleScope(s.value)}
                  />
                  <span className="text-sm">{s.label}</span>
                </label>
              ))}
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

            <p className="text-xs text-muted-foreground">
              Esta chave é para Claude Code, Codex, API ou agentes headless. No claude.ai, Claude
              Desktop ou ChatGPT, conecte pelo conector (sem chave): veja "Como conectar".
            </p>
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
            <p className="text-xs text-muted-foreground">
              Esta chave é para Claude Code, Codex, API ou agentes headless. No claude.ai, Claude
              Desktop ou ChatGPT, conecte pelo conector (sem chave): veja "Como conectar".
            </p>
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
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
                setRevokeTarget(null);
              }}
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
              onClick={() => {
                if (revokeGrantTarget) revokeGrantMutation.mutate(revokeGrantTarget.id);
                setRevokeGrantTarget(null);
              }}
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
