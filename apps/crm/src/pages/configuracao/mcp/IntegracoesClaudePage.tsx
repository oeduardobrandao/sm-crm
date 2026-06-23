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
import { SCOPE_OPTIONS, AGENT_PRESET } from '@/lib/mcp-scopes';

const MCP_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp';
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
            {desktopConfig}
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(desktopConfig, `${idPrefix}-desktop`)}
            style={{ position: 'absolute', top: '0.4rem', right: '0.4rem' }}
          >
            {copiedKey === `${idPrefix}-desktop` ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
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
    </>
  );
}

export default function IntegracoesClaudePage() {
  const { role } = useAuth();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(AGENT_PRESET);
  const [expiry, setExpiry] = useState<'never' | '30' | '90'>('never');
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState<McpKey | null>(null);
  const [connectToken, setConnectToken] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<McpKey | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['mcp-keys'],
    queryFn: listMcpKeys,
    enabled: isOwnerOrAdmin,
  });

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

  const toggleScope = (value: string) =>
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  if (!isOwnerOrAdmin) {
    return (
      <div className="card animate-up" style={{ margin: '1.5rem' }}>
        <h1 className="config-title">Claude (MCP)</h1>
        <p className="text-sm text-muted-foreground">
          Apenas proprietários e administradores podem gerenciar as chaves de API.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      <h1 className="config-title" style={{ marginBottom: '0.5rem' }}>
        Claude (MCP)
      </h1>
      <p className="text-sm text-muted-foreground" style={{ marginBottom: '1.5rem' }}>
        Conecte seus agentes Claude para ler clientes, posts e pautas deste workspace.
      </p>

      <FeatureGate flag="feature_mcp" label="Integração com Claude (MCP)">
        <div className="card animate-up" style={{ marginBottom: '1rem' }}>
          <h3 className="config-title" style={{ margin: 0, marginBottom: '0.75rem' }}>
            Como conectar
          </h3>

          <p className="text-sm" style={{ fontWeight: 600, margin: 0, marginBottom: '0.4rem' }}>
            Recomendado — claude.ai e Claude Desktop (sem chave)
          </p>
          <ol
            className="text-sm text-muted-foreground"
            style={{
              margin: 0,
              paddingLeft: '1.1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            <li>
              No Claude, abra{' '}
              <strong>Configurações → Conectores → Adicionar conector personalizado</strong>.
            </li>
            <li>
              Cole a URL abaixo, deixe os campos de OAuth em branco e clique em{' '}
              <strong>Adicionar</strong>.
            </li>
            <li>
              Faça login no Mesaas, escolha o workspace e as permissões e clique em{' '}
              <strong>Autorizar</strong>.
            </li>
          </ol>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              minWidth: 0,
              marginTop: '0.5rem',
            }}
          >
            <Input
              readOnly
              value={MCP_URL}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', flex: 1, minWidth: 0 }}
            />
            <Button variant="outline" size="sm" onClick={() => copy(MCP_URL, 'mcp-url')}>
              {copiedKey === 'mcp-url' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <p
            className="text-sm"
            style={{ fontWeight: 600, margin: 0, marginTop: '1rem', marginBottom: '0.4rem' }}
          >
            Claude Code, API ou agentes headless (com chave)
          </p>
          <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>
            Crie uma chave abaixo e copie o comando (Claude Code) ou o bloco de configuração (Claude
            Desktop sem conector). Já tem uma chave? Use <strong>Conectar</strong> ao lado dela.
          </p>

          <p className="text-xs text-muted-foreground" style={{ marginTop: '0.75rem' }}>
            Depois, peça ao agente: <em>"liste meus clientes ativos"</em> ou{' '}
            <em>"mostre o post X com métricas"</em>.
          </p>
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
            <Button onClick={() => setCreateOpen(true)}>Criar chave</Button>
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
                      <Button variant="outline" size="sm" onClick={() => setRevokeTarget(k)}>
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
              Gere uma chave para conectar um agente Claude a este workspace.
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
              Esta chave é para Claude Code, API ou agentes headless. Em claude.ai ou Desktop,
              conecte pelo conector (sem chave) — veja “Como conectar”.
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
              Esta chave é para Claude Code, API ou agentes headless. Em claude.ai ou Desktop,
              conecte pelo conector (sem chave) — veja “Como conectar”.
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
    </div>
  );
}
