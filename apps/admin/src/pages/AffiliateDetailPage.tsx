import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import {
  createAffiliatePayout,
  getAffiliate,
  updateAffiliate,
  type AffiliateDetail,
} from '../lib/api';
import { affiliatesPath, workspaceDetailPath } from '../lib/routes';
import { formatMoney } from '../lib/subscription';
import { formatRateBps, parseBRLToCents } from '../lib/affiliates';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';
const PIX_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Aleatória',
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

function formatDocumento(doc: string | null): string {
  if (!doc) return '—';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14)
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

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
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [rate, setRate] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'affiliate', id],
    queryFn: () => getAffiliate(id),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliates'] });
  };

  const updateMutation = useMutation({
    mutationFn: (params: Parameters<typeof updateAffiliate>[1]) => updateAffiliate(id, params),
    onSuccess: () => {
      invalidate();
      setRateOpen(false);
      toast.success('Afiliado atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const payoutMutation = useMutation({
    mutationFn: (cents: number) =>
      createAffiliatePayout(id, {
        amount_cents: cents,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setPayoutOpen(false);
      setAmount('');
      setReference('');
      setNote('');
      toast.success('Repasse registrado');
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
  const available = summary.available_cents;

  const submitPayout = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseBRLToCents(amount);
    if (cents == null) {
      toast.error('Valor inválido.');
      return;
    }
    payoutMutation.mutate(cents);
  };

  const submitRate = (e: React.FormEvent) => {
    e.preventDefault();
    const pct = Number(rate.replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error('Percentual inválido (0 a 100).');
      return;
    }
    updateMutation.mutate({ commission_rate_bps: Math.round(pct * 100) });
  };

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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRate(String(a.commission_rate_bps / 100).replace('.', ','));
              setRateOpen(true);
            }}
          >
            Comissão: {formatRateBps(a.commission_rate_bps)}
          </Button>
          <Button
            variant="outline"
            disabled={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({ status: a.status === 'active' ? 'suspended' : 'active' })
            }
          >
            {a.status === 'active' ? 'Suspender' : 'Reativar'}
          </Button>
          <Button onClick={() => setPayoutOpen(true)} disabled={available <= 0}>
            Registrar repasse
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Indicações" value={String(summary.referrals_count)} />
        <Stat label="Em teste" value={String(summary.trialing_count)} />
        <Stat label="Assinantes (Stripe)" value={String(summary.paying_count)} />
        <Stat label="Pendente" value={formatMoney(summary.pending_cents)} />
        <Stat label="Disponível" value={formatMoney(available)} />
        <Stat label="Já pago" value={formatMoney(summary.paid_out_cents)} />
      </div>

      <Card className="mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold">Dados para repasse (PIX)</h2>
        {a.pix_key ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                Chave ({PIX_LABEL[a.pix_key_type ?? ''] ?? '—'})
              </dt>
              <dd className="font-mono">{a.pix_key}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Titular</dt>
              <dd>
                {a.titular_nome ?? '—'} · {formatDocumento(a.documento)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            O afiliado ainda não cadastrou a chave PIX no painel dele.
          </p>
        )}
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
                <TableHead className={HEAD}>Referência</TableHead>
                <TableHead className={HEAD}>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{formatDate(p.paid_at)}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatMoney(p.amount_cents)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.reference ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent>
          <form onSubmit={submitPayout}>
            <DialogHeader>
              <DialogTitle>Registrar repasse</DialogTitle>
              <DialogDescription>
                Faça o PIX antes e registre aqui. Disponível: {formatMoney(available)}.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="payout-amount">Valor (R$)</Label>
                <Input
                  id="payout-amount"
                  inputMode="decimal"
                  placeholder={(available / 100).toFixed(2).replace('.', ',')}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payout-ref">ID da transação PIX (opcional)</Label>
                <Input
                  id="payout-ref"
                  maxLength={200}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payout-note">Observação (opcional)</Label>
                <Input
                  id="payout-note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPayoutOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={payoutMutation.isPending}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent>
          <form onSubmit={submitRate}>
            <DialogHeader>
              <DialogTitle>Percentual de comissão</DialogTitle>
              <DialogDescription>
                Vale para os próximos pagamentos. Comissões já registradas não mudam.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-1.5">
              <Label htmlFor="rate-input">Percentual (%)</Label>
              <Input
                id="rate-input"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
