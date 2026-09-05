import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listAdminMcpGrants, revokeAdminMcpGrant, type AdminMcpGrant } from '../lib/api';
import { ADMIN_SCOPES } from '../lib/mcp-admin-scopes';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CONNECTOR_URL = `${SUPABASE_URL}/functions/v1/mcp-admin`;

function truncateClientId(clientId: string): string {
  return clientId.length > 12 ? `${clientId.slice(0, 12)}…` : clientId;
}

export default function IntegrationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'admin-mcp-grants'],
    queryFn: listAdminMcpGrants,
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => revokeAdminMcpGrant(grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admin-mcp-grants'] });
      toast.success('Conexão revogada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleRevoke = (grant: AdminMcpGrant) => {
    if (!window.confirm('Revogar esta conexão? O conector para de funcionar imediatamente.'))
      return;
    revokeMutation.mutate(grant.id);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      toast.success('URL copiada');
    } catch {
      toast.error('Não foi possível copiar a URL');
    }
  };

  const grants = data?.grants ?? [];

  return (
    <div>
      <h1 className="font-sf text-2xl font-bold mb-1">Integrations</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Conector MCP do Admin da plataforma e conexões OAuth autorizadas.
      </p>

      <div className="flex flex-col gap-6">
        {/* Conector MCP do Admin */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold mb-1">Conector MCP do Admin</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Use esta URL para conectar um agente (claude.ai, Claude Code, Codex) ao Admin da
            plataforma via MCP.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={CONNECTOR_URL}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2.5 rounded-lg bg-background border border-border text-sm font-mono text-foreground"
            />
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
            >
              <Copy size={16} />
              Copiar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Campos de OAuth ficam em branco. Na tela de autorização, escolha Administração da
            plataforma.
          </p>
        </div>

        {/* Como conectar */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold mb-4">Como conectar</h2>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold mb-1">claude.ai</h3>
              <p className="text-sm text-muted-foreground">
                Configurações › Conectores › Adicionar conector personalizado › cole a URL acima.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-1">Claude Code</h3>
              <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 overflow-x-auto">
                {`claude mcp add --transport http mesaas-admin ${CONNECTOR_URL}`}
              </pre>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-1">Codex</h3>
              <p className="text-sm text-muted-foreground mb-1">
                Adicione o bloco abaixo em <code className="font-mono">~/.codex/config.toml</code>:
              </p>
              <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 overflow-x-auto">
                {`[mcp_servers.mesaas_admin]\nurl = "${CONNECTOR_URL}"`}
              </pre>
            </div>
          </div>
        </div>

        {/* Permissões */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold mb-1">Permissões</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Escopos disponíveis para uma conexão MCP do Admin. Quem autoriza escolhe quais conceder
            na tela de consentimento.
          </p>
          <ul className="flex flex-col gap-2">
            {ADMIN_SCOPES.map((scope) => (
              <li key={scope.value} className="flex items-center gap-2 text-sm">
                <code className="text-xs font-mono px-1.5 py-0.5 rounded-sm bg-background border border-border text-muted-foreground">
                  {scope.value}
                </code>
                <span className="text-foreground">{scope.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Conexões autorizadas */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold mb-4">Conexões autorizadas</h2>

          <div className="hidden md:grid grid-cols-[2fr_1fr_2fr_1.5fr_0.8fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
            <span>E-mail</span>
            <span>Cliente</span>
            <span>Escopos</span>
            <span>Criado em</span>
            <span>Status</span>
            <span></span>
          </div>

          {isLoading ? (
            <p className="text-sm text-dim-foreground py-4">Carregando...</p>
          ) : isError ? (
            <div className="flex flex-col items-start gap-2 py-4">
              <p className="text-sm text-destructive">Não foi possível carregar as conexões.</p>
              <button
                onClick={() => refetch()}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : grants.length === 0 ? (
            <p className="text-sm text-dim-foreground py-4">Nenhuma conexão ainda.</p>
          ) : (
            grants.map((grant) => {
              const isActive = !grant.revoked_at;
              return (
                <div
                  key={grant.id}
                  className="border-b border-border/50 py-3 md:grid md:grid-cols-[2fr_1fr_2fr_1.5fr_0.8fr_0.5fr] md:gap-2 md:items-center"
                >
                  <span className="text-sm text-foreground">{grant.email ?? '—'}</span>
                  <span className="text-xs font-mono text-muted-foreground" title={grant.client_id}>
                    {truncateClientId(grant.client_id)}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {grant.scopes.map((scope) => (
                      <code
                        key={scope}
                        className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded-sm bg-background border border-border text-muted-foreground"
                      >
                        {scope}
                      </code>
                    ))}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(grant.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span
                    className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${
                      isActive ? 'text-success bg-success/15' : 'text-muted-foreground bg-muted'
                    }`}
                  >
                    {isActive ? 'Ativa' : 'Revogada'}
                  </span>
                  <span>
                    {isActive && (
                      <button
                        onClick={() => handleRevoke(grant)}
                        disabled={revokeMutation.isPending}
                        className="flex items-center gap-1 text-dim-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Revogar
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
