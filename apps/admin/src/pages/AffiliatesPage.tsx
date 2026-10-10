import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { HandCoins } from 'lucide-react';
import { listAffiliates } from '../lib/api';
import { affiliateDetailPath } from '../lib/routes';
import { formatMoney } from '../lib/subscription';
import { STRIPE_STATE_LABEL, stripeConnectState } from '../lib/affiliates';
import { CommissionRulesCard } from './affiliates/CommissionRulesCard';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';

export default function AffiliatesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'affiliates'],
    queryFn: listAffiliates,
  });
  const affiliates = data?.affiliates ?? [];
  const totalAvailable = affiliates.reduce((s, a) => s + Math.max(0, a.summary.available_cents), 0);

  return (
    <div>
      <PageHeader
        title="Afiliados"
        description={
          affiliates.length > 0
            ? `${affiliates.length} afiliados · ${formatMoney(totalAvailable)} disponível para repasse`
            : 'Programa de afiliados (comissão sobre pagamentos Stripe, repasse por Stripe Connect)'
        }
      />

      {data?.rules && data.rules.length > 0 && <CommissionRulesCard rules={data.rules} />}

      <Card>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar os afiliados." onRetry={() => refetch()} />
        ) : affiliates.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Nenhum afiliado ainda"
            description="Os cadastros feitos em /afiliados aparecem aqui."
          />
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>Afiliado</TableHead>
                  <TableHead className={HEAD}>Código</TableHead>
                  <TableHead className={HEAD}>Indicações</TableHead>
                  <TableHead className={HEAD}>Assinantes</TableHead>
                  <TableHead className={HEAD}>Pendente</TableHead>
                  <TableHead className={HEAD}>Disponível</TableHead>
                  <TableHead className={HEAD}>Pago</TableHead>
                  <TableHead className={HEAD}>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((a) => {
                  const to = affiliateDetailPath(a.id);
                  return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(to)}>
                      <TableCell>
                        <RowLink to={to} className="block truncate text-sm">
                          {a.nome}
                        </RowLink>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.email}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{a.code}</TableCell>
                      <TableCell className="text-sm">{a.summary.referrals_count}</TableCell>
                      <TableCell className="text-sm">{a.summary.paying_count}</TableCell>
                      <TableCell className="text-sm">
                        {formatMoney(a.summary.pending_cents)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {formatMoney(a.summary.available_cents)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatMoney(a.summary.paid_out_cents)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {a.status === 'suspended' ? (
                            <Badge variant="danger">Suspenso</Badge>
                          ) : (
                            <Badge variant="success">Ativo</Badge>
                          )}
                          {stripeConnectState(a) === 'ready' ? (
                            <Badge variant="info">{STRIPE_STATE_LABEL.ready}</Badge>
                          ) : (
                            <Badge variant="warning">
                              {STRIPE_STATE_LABEL[stripeConnectState(a)]}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="flex flex-col md:hidden">
              {affiliates.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3 last:border-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <RowLink to={affiliateDetailPath(a.id)} className="truncate text-sm">
                      {a.nome}
                    </RowLink>
                    <span className="text-xs text-muted-foreground">
                      {a.summary.referrals_count} indicações · {a.summary.paying_count} assinantes
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-medium">
                    {formatMoney(a.summary.available_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
