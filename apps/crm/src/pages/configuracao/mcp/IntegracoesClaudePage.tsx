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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { listMcpKeys, createMcpKey, revokeMcpKey } from '@/services/mcp-keys';

const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
];
const AGENT_PRESET = SCOPE_OPTIONS.map((s) => s.value);
const MCP_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

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
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const desktopConfig = revealToken
    ? JSON.stringify(
        {
          mcpServers: {
            mesaas: {
              command: 'npx',
              args: ['-y', 'mcp-remote', MCP_URL, '--header', 'Authorization:${AUTH_HEADER}'],
              env: { AUTH_HEADER: `Bearer ${revealToken}` },
            },
          },
        },
        null,
        2,
      )
    : '';
  const claudeCodeCmd = revealToken
    ? `claude mcp add --transport http mesaas ${MCP_URL} --header "Authorization: Bearer ${revealToken}"`
    : '';

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
                      <span className="text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeMutation.mutate(k.id)}
                      disabled={revokeMutation.isPending}
                    >
                      Revogar
                    </Button>
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
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Agente de conteúdo"
              />
            </div>
            <div className="space-y-2">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
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
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Sua chave</Label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Input
                  readOnly
                  value={revealToken ?? ''}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <Button variant="outline" size="sm" onClick={() => copy(revealToken ?? '', 'token')}>
                  {copiedKey === 'token' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Claude Desktop</Label>
              <p className="text-xs text-muted-foreground">
                Cole em <code>claude_desktop_config.json</code> e reinicie o app.
              </p>
              <div style={{ position: 'relative' }}>
                <pre
                  style={{
                    background: 'var(--surface-darker)',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    overflowX: 'auto',
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
                  onClick={() => copy(desktopConfig, 'desktop')}
                  style={{ position: 'absolute', top: '0.4rem', right: '0.4rem' }}
                >
                  {copiedKey === 'desktop' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Claude Code</Label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Input
                  readOnly
                  value={claudeCodeCmd}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                />
                <Button variant="outline" size="sm" onClick={() => copy(claudeCodeCmd, 'code')}>
                  {copiedKey === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              O Claude.ai web ainda não suporta chaves estáticas — use Desktop ou Code.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealToken(null)}>Concluído</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
