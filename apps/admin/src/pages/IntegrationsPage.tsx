import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listAdminMcpGrants, revokeAdminMcpGrant, type AdminMcpGrant } from '../lib/api';
import { ADMIN_SCOPES } from '../lib/mcp-admin-scopes';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

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

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

  return (
    <div>
      <PageHeader
        title="Integrações"
        description="Conector MCP do Admin da plataforma e conexões OAuth autorizadas."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conector MCP do Admin</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Use esta URL para conectar um agente (claude.ai, Claude Code, Codex) ao Admin da
              plataforma via MCP.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                readOnly
                aria-label="URL do conector MCP"
                value={CONNECTOR_URL}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 font-mono"
              />
              <Button variant="outline" onClick={handleCopy} aria-label="Copiar URL">
                <Copy />
                Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Campos de OAuth ficam em branco. Na tela de autorização, escolha Administração da
              plataforma.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Como conectar</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold">claude.ai</h3>
              <p className="text-sm text-muted-foreground">
                Configurações › Conectores › Adicionar conector personalizado › cole a URL acima.
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Claude Code</h3>
              <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                {`claude mcp add --transport http mesaas-admin ${CONNECTOR_URL}`}
              </pre>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Codex</h3>
              <p className="mb-1 text-sm text-muted-foreground">
                Adicione o bloco abaixo em <code className="font-mono">~/.codex/config.toml</code>:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                {`[mcp_servers.mesaas_admin]\nurl = "${CONNECTOR_URL}"`}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permissões</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Escopos disponíveis para uma conexão MCP do Admin. Quem autoriza escolhe quais
              conceder na tela de consentimento.
            </p>
            <ul className="flex flex-col gap-2">
              {ADMIN_SCOPES.map((scope) => (
                <li key={scope.value} className="flex items-center gap-2 text-sm">
                  <Badge variant="neutral" size="sm" className="font-mono normal-case">
                    {scope.value}
                  </Badge>
                  <span className="text-foreground">{scope.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexões autorizadas</CardTitle>
          </CardHeader>
          {isLoading ? (
            <div className="flex flex-col gap-3 p-5">
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-60" />
            </div>
          ) : isError ? (
            <ErrorState
              message="Não foi possível carregar as conexões."
              onRetry={() => refetch()}
            />
          ) : grants.length === 0 ? (
            <EmptyState icon={Plug} title="Nenhuma conexão autorizada" />
          ) : (
            <>
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[0.7rem] uppercase tracking-wider">E-mail</TableHead>
                    <TableHead className="text-[0.7rem] uppercase tracking-wider">
                      Cliente
                    </TableHead>
                    <TableHead className="text-[0.7rem] uppercase tracking-wider">
                      Escopos
                    </TableHead>
                    <TableHead className="text-[0.7rem] uppercase tracking-wider">
                      Criado em
                    </TableHead>
                    <TableHead className="text-[0.7rem] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((grant) => {
                    const isActive = !grant.revoked_at;
                    return (
                      <TableRow key={grant.id}>
                        <TableCell className="text-sm text-foreground">
                          {grant.email ?? '—'}
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs text-muted-foreground"
                          title={grant.client_id}
                        >
                          {truncateClientId(grant.client_id)}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            {grant.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="neutral"
                                size="sm"
                                className="font-mono normal-case"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(grant.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={isActive ? 'success' : 'neutral'}>
                            {isActive ? 'Ativa' : 'Revogada'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleRevoke(grant)}
                              disabled={revokeMutation.isPending}
                            >
                              <Trash2 />
                              Revogar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <ul className="flex flex-col md:hidden">
                {grants.map((grant) => {
                  const isActive = !grant.revoked_at;
                  return (
                    <li
                      key={grant.id}
                      className="flex flex-col gap-1.5 border-b border-border/50 px-5 py-3 last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-foreground">
                          {grant.email ?? '—'}
                        </span>
                        <Badge variant={isActive ? 'success' : 'neutral'}>
                          {isActive ? 'Ativa' : 'Revogada'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono" title={grant.client_id}>
                          {truncateClientId(grant.client_id)}
                        </span>
                        <span>{formatDate(grant.created_at)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {grant.scopes.map((scope) => (
                          <Badge
                            key={scope}
                            variant="neutral"
                            size="sm"
                            className="font-mono normal-case"
                          >
                            {scope}
                          </Badge>
                        ))}
                      </div>
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-fit text-muted-foreground hover:text-destructive"
                          onClick={() => handleRevoke(grant)}
                          disabled={revokeMutation.isPending}
                        >
                          <Trash2 />
                          Revogar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
