import { Plug } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ConnectGuide } from './ConnectGuide';
import { ScopeChips } from './ScopeChips';
import {
  CONNECTOR_URL,
  OAUTH_HELP,
  formatGrantDate,
  truncateClientId,
  type IntegrationsViewProps,
} from './shared';

export function IntegrationsDesktop({
  grants,
  isLoading,
  isError,
  onRetry,
  onCopy,
  onRevoke,
  revoking,
}: IntegrationsViewProps) {
  return (
    <div>
      <PageHeader
        title="Integrações"
        description="Conector MCP do Admin da plataforma e conexões OAuth autorizadas."
      />

      <div className="mb-4 flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-4">
          <GlassPanel title="Conector MCP do Admin" titleId="integ-url">
            <p className="mb-3 text-sm text-muted-foreground">
              Use esta URL para conectar um agente (claude.ai, Claude Code, Codex) ao Admin da
              plataforma via MCP.
            </p>
            <div className="flex gap-2">
              <Input
                type="text"
                readOnly
                aria-label="URL do conector MCP"
                value={CONNECTOR_URL}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 font-mono"
              />
              <Button variant="secondary" onClick={onCopy} aria-label="Copiar URL">
                Copiar
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{OAUTH_HELP}</p>
          </GlassPanel>

          <GlassPanel title="Permissões" titleId="integ-scopes">
            <p className="mb-3 text-sm text-muted-foreground">
              Escopos disponíveis para uma conexão MCP do Admin. Quem autoriza escolhe quais
              conceder na tela de consentimento.
            </p>
            <ScopeChips />
          </GlassPanel>
        </div>

        <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-4">
          <GlassPanel title="Como conectar" titleId="integ-how">
            <ConnectGuide />
          </GlassPanel>
        </div>
      </div>

      <GlassPanel title="Conexões autorizadas" titleId="integ-grants" flush>
        {isLoading ? (
          <div className="flex flex-col gap-3 px-[18px] pb-5">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar as conexões." onRetry={onRetry} />
        ) : grants.length === 0 ? (
          <EmptyState icon={Plug} title="Nenhuma conexão autorizada" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">Conta</TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">Cliente</TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">Escopos</TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">
                  Autorizada em
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
                    <TableCell className={isActive ? 'text-sm' : 'text-sm text-muted-foreground'}>
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
                      {formatGrantDate(grant.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isActive ? 'success' : 'neutral'}>
                        {isActive ? 'Ativa' : 'Revogada'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isActive && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRevoke(grant)}
                          disabled={revoking}
                        >
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassPanel>
    </div>
  );
}
