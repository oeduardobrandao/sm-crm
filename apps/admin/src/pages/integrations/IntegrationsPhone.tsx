import { Plug, Trash2 } from 'lucide-react';
import { Cell, GroupedList, SwipeRow } from '@mesaas/ios-kit';
import { ADMIN_SCOPES } from '../../lib/mcp-admin-scopes';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { ConnectGuide } from './ConnectGuide';
import {
  CONNECTOR_URL,
  OAUTH_HELP,
  formatGrantDate,
  scopeCount,
  truncateClientId,
  type IntegrationsViewProps,
} from './shared';

export function IntegrationsPhone({
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
      <PageHeader title="Integrações" description="Conector MCP do Admin e conexões OAuth" />

      <section className="phone-kit phone-group">
        <h2 className="phone-group__header">Conector MCP do Admin</h2>
        <div className="phone-group__list flex min-h-[52px] items-center gap-2.5 py-1.5 pl-4 pr-2">
          <input
            type="text"
            readOnly
            aria-label="URL do conector MCP"
            value={CONNECTOR_URL}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 truncate bg-transparent font-mono text-sm text-foreground outline-none"
          />
          <button
            type="button"
            aria-label="Copiar URL"
            onClick={onCopy}
            className="h-9 shrink-0 rounded-[10px] bg-foreground/[0.12] px-3 text-[15px] font-semibold text-foreground active:bg-foreground/[0.18]"
          >
            Copiar
          </button>
        </div>
        <p className="phone-group__footer">{OAUTH_HELP}</p>
      </section>

      <section className="phone-kit phone-group">
        <h2 className="phone-group__header">Como conectar</h2>
        <div className="phone-group__list p-3">
          <ConnectGuide />
        </div>
      </section>

      <GroupedList header="Permissões">
        {ADMIN_SCOPES.map((scope) => (
          <Cell
            key={scope.value}
            label={scope.label}
            subtitle={<span className="font-mono">{scope.value}</span>}
          />
        ))}
      </GroupedList>

      {isLoading ? (
        <GlassPanel title="Conexões autorizadas">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
          </div>
        </GlassPanel>
      ) : isError ? (
        <GlassPanel title="Conexões autorizadas" flush>
          <ErrorState message="Não foi possível carregar as conexões." onRetry={onRetry} />
        </GlassPanel>
      ) : grants.length === 0 ? (
        <GlassPanel title="Conexões autorizadas" flush>
          <EmptyState icon={Plug} title="Nenhuma conexão autorizada" />
        </GlassPanel>
      ) : (
        <GroupedList
          header="Conexões autorizadas"
          footer={
            grants.some((grant) => !grant.revoked_at)
              ? 'Deslize uma conexão ativa para a esquerda para revogar.'
              : undefined
          }
        >
          {grants.map((grant) => {
            const isActive = !grant.revoked_at;
            const label = grant.email ?? '—';
            const status = (
              <Badge variant={isActive ? 'success' : 'neutral'}>
                {isActive ? 'Ativa' : 'Revogada'}
              </Badge>
            );
            const subtitle = (
              <>
                {scopeCount(grant)} · {formatGrantDate(grant.created_at)}
                <span className="block font-mono text-xs" title={grant.client_id}>
                  {truncateClientId(grant.client_id)}
                </span>
              </>
            );
            if (!isActive) {
              return <Cell key={grant.id} label={label} subtitle={subtitle} accessory={status} />;
            }
            return (
              <SwipeRow
                key={grant.id}
                as="li"
                className="phone-cell"
                trailingActions={[
                  {
                    label: 'Revogar',
                    ariaLabel: `Revogar ${grant.email ?? truncateClientId(grant.client_id)}`,
                    icon: <Trash2 />,
                    tone: 'destructive',
                    onAction: () => {
                      if (!revoking) onRevoke(grant);
                    },
                  },
                ]}
              >
                <div className="phone-cell__main">
                  <span className="phone-cell__body">
                    <span className="phone-cell__text">
                      <span className="phone-cell__label">{label}</span>
                      <span className="phone-cell__subtitle">{subtitle}</span>
                    </span>
                    {status}
                  </span>
                </div>
              </SwipeRow>
            );
          })}
        </GroupedList>
      )}
    </div>
  );
}
