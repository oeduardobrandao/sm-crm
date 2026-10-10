import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { getAffiliate, updateAffiliateStatus, type AffiliateDetail } from '../lib/api';
import { affiliatesPath, workspaceDetailPath } from '../lib/routes';
import { formatMoney } from '../lib/subscription';
import { formatRateBps, STRIPE_STATE_LABEL, stripeConnectState } from '../lib/affiliates';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
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
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const PAYOUT_LABEL: Record<AffiliateDetail['payouts'][number]['status'], string> = {
  pending: 'Processando',
  paid: 'Enviado',
  failed: 'Falhou',
};

function referralStatus(r: AffiliateDetail['referrals'][number]) {
  if (!r.status) return <Badge>Cadastrado</Badge>;
  if (r.provider && r.provider !== 'stripe') {
    return <Badge variant="warning">Pagar.me · {r.status}</Badge>;
  }
  if (r.status === 'active' || r.status === 'past_due') {
    return <Badge variant="success">{r.status === 'active' ? 'Assinante' : 'Inadimplente'}</Badge>;
  }
  if (r.status === 'trialing') return <Badge variant="info">Teste</Badge>;
  return <Badge>{r.status}</Badge>;
}

function commissionStatus(c: AffiliateDetail['commissions'][number]) {
  if (c.disputed) return <Badge variant="danger">Contestada</Badge>;
  if (c.net_cents <= 0) return <Badge variant="danger">Estornada</Badge>;
  if (Date.parse(c.available_at) > Date.now()) return <Badge variant="warning">Pendente</Badge>;
  return <Badge variant="success">Liberada</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-sf text-lg font-semibold">{value}</p>
    </Card>
  );
}

export default function AffiliateDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'affiliate', id],
    queryFn: () => getAffiliate(id),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliates'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') => updateAffiliateStatus(id, status),
    onSuccess: () => {
      invalidate();
      toast.success('Afiliado atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isError) {
    return <ErrorState message="Não foi possível carregar o afiliado." onRetry={() => refetch()} />;
  }
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { affiliate: a, summary } = data;
  const stripeState = stripeConnectState(a);

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(affiliatesPath())}
        className="mb-4 -ml-2 text-muted-foreground"
      >
        <ArrowLeft />
        Voltar
      </Button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-sf text-xl font-bold">{a.nome}</h1>
            {a.status === 'suspended' ? (
              <Badge variant="danger">Suspenso</Badge>
            ) : (
              <Badge variant="success">Ativo</Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {a.email}
            {a.telefone ? ` · ${a.telefone}` : ''} · código{' '}
            <span className="font-mono">{a.code}</span> · desde {formatDate(a.created_at)}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate(a.status === 'active' ? 'suspended' : 'active')}
        >
          {a.status === 'active' ? 'Suspender' : 'Reativar'}
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Indicações" value={String(summary.referrals_count)} />
        <Stat label="Em teste" value={String(summary.trialing_count)} />
        <Stat label="Assinantes (Stripe)" value={String(summary.paying_count)} />
        <Stat label="Pendente" value={formatMoney(summary.pending_cents)} />
        <Stat label="Disponível" value={formatMoney(summary.available_cents)} />
        <Stat label="Já pago" value={formatMoney(summary.paid_out_cents)} />
      </div>

      <Card className="mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold">Repasse (Stripe Connect)</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={stripeState === 'ready' ? 'success' : 'warning'}>
            {STRIPE_STATE_LABEL[stripeState]}
          </Badge>
          {a.stripe_account_id && (
            <span className="font-mono text-xs text-muted-foreground">{a.stripe_account_id}</span>
          )}
          {a.stripe_status_checked_at && (
            <span className="text-xs text-muted-foreground">
              · conferido em {formatDate(a.stripe_status_checked_at)}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          O saldo disponível é transferido todo dia 5 pelo affiliate-payout-cron, se a conta estiver
          apta e o valor passar do mínimo.
        </p>
      </Card>

      <Card className="mb-6">
        <h2 className="px-5 pt-5 text-sm font-semibold">Indicações</h2>
        {data.referrals.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhuma indicação.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>Workspace</TableHead>
                <TableHead className={HEAD}>Cadastro</TableHead>
                <TableHead className={HEAD}>Plano</TableHead>
                <TableHead className={HEAD}>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.referrals.map((r) => (
                <TableRow key={r.workspace_id}>
                  <TableCell>
                    <RowLink to={workspaceDetailPath(r.workspace_id)} className="text-sm">
                      {r.workspace_name ?? r.workspace_id}
                    </RowLink>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(r.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">{r.plan_id ?? '—'}</TableCell>
                  <TableCell>{referralStatus(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="px-5 pt-5 text-sm font-semibold">Comissões</h2>
        {data.commissions.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhuma comissão.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>Pagamento</TableHead>
                <TableHead className={HEAD}>Workspace</TableHead>
                <TableHead className={HEAD}>Fatura</TableHead>
                <TableHead className={HEAD}>Plano</TableHead>
                <TableHead className={HEAD}>Comissão</TableHead>
                <TableHead className={HEAD}>Libera em</TableHead>
                <TableHead className={HEAD}>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">{formatDate(c.paid_at)}</TableCell>
                  <TableCell className="text-sm">{c.workspace_name ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {formatMoney(c.invoice_amount_cents)}
                    <span className="block font-mono text-xs text-muted-foreground">
                      {c.stripe_invoice_id}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.plan_id ?? '—'} · {formatRateBps(c.rate_bps)}
                    <span className="block text-xs text-muted-foreground">
                      {c.covered_months > 0 ? `${c.covered_months} mês(es) da janela` : 'ajuste'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatMoney(c.net_cents)}
                    {c.net_cents !== c.commission_cents && (
                      <span className="block text-xs text-muted-foreground">
                        de {formatMoney(c.commission_cents)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(c.available_at)}
                  </TableCell>
                  <TableCell>{commissionStatus(c)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="px-5 pt-5 text-sm font-semibold">Repasses</h2>
        {data.payouts.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhum repasse registrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>Data</TableHead>
                <TableHead className={HEAD}>Valor</TableHead>
                <TableHead className={HEAD}>Situação</TableHead>
                <TableHead className={HEAD}>Transfer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{formatDate(p.paid_at ?? p.created_at)}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatMoney(p.amount_cents)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        p.status === 'paid'
                          ? 'success'
                          : p.status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {PAYOUT_LABEL[p.status]}
                    </Badge>
                    {p.failure_code && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {p.failure_code}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.stripe_transfer_id ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
