import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildReferralLink } from '@/lib/referral';
import {
  formatBRL,
  getAffiliateDashboard,
  updateAffiliatePayout,
  type AffiliateDashboard,
  type CommissionSituacao,
  type PixKeyType,
  type ReferralSituacao,
} from '@/services/affiliates';
import CommissionSimulator from './CommissionSimulator';
import { formatRate } from './simulator';

const REFERRAL_LABEL: Record<ReferralSituacao, string> = {
  cadastrado: 'Cadastrado',
  trial: 'Em teste grátis',
  ativo: 'Assinante',
  outro_meio: 'Assinante (parcelado, sem comissão)',
  cancelado: 'Cancelado',
};

const COMMISSION_LABEL: Record<CommissionSituacao, string> = {
  pendente: 'Pendente',
  disponivel: 'Disponível',
  estornada: 'Estornada',
  contestada: 'Contestada',
};

const PIX_TYPES: Array<{ value: PixKeyType; label: string }> = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'aleatoria', label: 'Chave aleatória' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/afiliados" aria-label="Programa de afiliados Mesaas">
          <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto dark:hidden" />
          <img src="/logo-white.svg" alt="Mesaas" className="hidden h-5 w-auto dark:block" />
        </Link>
        <span className="text-sm text-muted-foreground">Painel do afiliado</span>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16">{children}</main>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PayoutForm({ token, data }: { token: string; data: AffiliateDashboard }) {
  const queryClient = useQueryClient();
  const a = data.affiliate;
  const [type, setType] = useState<PixKeyType>(a.pix_key_type ?? 'cpf');
  const [pixKey, setPixKey] = useState(a.pix_key ?? '');
  const [documento, setDocumento] = useState('');
  const [titular, setTitular] = useState(a.titular_nome ?? a.nome);

  useEffect(() => {
    setType(a.pix_key_type ?? 'cpf');
    setPixKey(a.pix_key ?? '');
    setTitular(a.titular_nome ?? a.nome);
  }, [a.pix_key_type, a.pix_key, a.titular_nome, a.nome]);

  const mutation = useMutation({
    mutationFn: () =>
      updateAffiliatePayout(token, {
        pix_key_type: type,
        pix_key: pixKey,
        titular_nome: titular,
        ...(documento.trim() ? { documento } : {}),
      }),
    onSuccess: () => {
      setDocumento('');
      toast.success('Dados de pagamento salvos');
      queryClient.invalidateQueries({ queryKey: ['affiliate-dashboard', token] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form
      className="rounded-xl border border-border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h2 className="mb-1 text-lg font-semibold">Dados para receber</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Os repasses são feitos por PIX. O CPF ou CNPJ precisa ser do titular da chave.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pix-type">Tipo de chave</Label>
          <Select value={type} onValueChange={(v) => setType(v as PixKeyType)}>
            <SelectTrigger id="pix-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIX_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pix-key">Chave PIX</Label>
          <Input id="pix-key" value={pixKey} onChange={(e) => setPixKey(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pix-titular">Nome do titular</Label>
          <Input
            id="pix-titular"
            value={titular}
            maxLength={120}
            onChange={(e) => setTitular(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pix-doc">CPF ou CNPJ do titular</Label>
          <Input
            id="pix-doc"
            inputMode="numeric"
            value={documento}
            placeholder={a.documento_mascarado ?? '000.000.000-00'}
            onChange={(e) => setDocumento(e.target.value)}
          />
          {a.documento_mascarado && (
            <p className="text-xs text-muted-foreground">
              Deixe em branco para manter o documento já salvo.
            </p>
          )}
        </div>
      </div>
      <Button type="submit" className="mt-5" disabled={mutation.isPending}>
        {mutation.isPending ? 'Salvando…' : 'Salvar dados de pagamento'}
      </Button>
    </form>
  );
}

export default function AfiliadoPainelPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['affiliate-dashboard', token],
    queryFn: () => getAffiliateDashboard(token),
    enabled: token.length > 0,
    retry: false,
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner size="lg" />
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404 || !token;
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <CircleAlert className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]" />
          <h1 className="mb-2 text-xl font-semibold">
            {notFound ? 'Link inválido ou expirado' : 'Não foi possível carregar o painel'}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {notFound
              ? 'Peça um novo link de acesso com o e-mail cadastrado no programa.'
              : 'Tente de novo em alguns instantes.'}
          </p>
          {notFound ? (
            <Button asChild>
              <Link to="/afiliados#cadastro">Pedir novo link</Link>
            </Button>
          ) : (
            <Button onClick={() => refetch()}>Tentar novamente</Button>
          )}
        </div>
      </Shell>
    );
  }

  const { affiliate, summary } = data;
  const link = buildReferralLink(affiliate.code);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-bold">Olá, {affiliate.nome.split(' ')[0]}!</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Você recebe {formatRate(affiliate.commission_rate_bps)} de cada pagamento com cartão dos
        seus indicados.
      </p>

      {affiliate.status === 'suspended' && (
        <div
          className="mb-6 rounded-xl border border-[var(--danger)] bg-card p-4 text-sm"
          role="alert"
        >
          Sua participação no programa está suspensa e novos pagamentos não geram comissão. Fale com
          o suporte do Mesaas.
        </div>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-1 text-lg font-semibold">Seu link de divulgação</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Quem se cadastrar por este link em até 60 dias fica ligado a você.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Seu link"
          />
          <Button type="button" onClick={copyLink} className="shrink-0">
            <Copy className="mr-2 h-4 w-4" />
            Copiar link
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Código: <span className="font-mono">{affiliate.code}</span>
        </p>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Indicações" value={String(summary.referrals_count)} />
        <Kpi label="Em teste grátis" value={String(summary.trialing_count)} />
        <Kpi label="Assinantes" value={String(summary.paying_count)} />
        <Kpi
          label="Pendente"
          value={formatBRL(summary.pending_cents)}
          hint="Libera 30 dias após o pagamento"
        />
        <Kpi
          label="Disponível"
          value={formatBRL(summary.available_cents)}
          hint="A receber no próximo repasse"
        />
        <Kpi label="Já recebido" value={formatBRL(summary.paid_out_cents)} />
      </section>

      <section className="mb-6 grid gap-6 md:grid-cols-2">
        <PayoutForm token={token} data={data} />
        <CommissionSimulator rateBps={affiliate.commission_rate_bps} />
      </section>

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-lg font-semibold">Comissões</h2>
        {data.commissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma comissão ainda. Ela aparece aqui no primeiro pagamento de um indicado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Pagamento</th>
                  <th className="py-2 pr-4 font-medium">Valor pago</th>
                  <th className="py-2 pr-4 font-medium">Sua comissão</th>
                  <th className="py-2 pr-4 font-medium">Libera em</th>
                  <th className="py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.commissions.map((c, i) => (
                  <tr key={`${c.paid_at}-${i}`} className="border-t border-border">
                    <td className="py-2 pr-4">{formatDate(c.paid_at)}</td>
                    <td className="py-2 pr-4">{formatBRL(c.invoice_amount_cents)}</td>
                    <td className="py-2 pr-4 font-medium">{formatBRL(c.net_cents)}</td>
                    <td className="py-2 pr-4">{formatDate(c.available_at)}</td>
                    <td className="py-2">{COMMISSION_LABEL[c.situacao]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Indicações</h2>
          {data.referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ninguém se cadastrou pelo seu link ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.referrals.map((r) => (
                <li key={r.numero} className="flex items-center justify-between py-2">
                  <span>
                    Indicação #{r.numero}{' '}
                    <span className="text-muted-foreground">· {formatDate(r.created_at)}</span>
                  </span>
                  <span className="text-muted-foreground">{REFERRAL_LABEL[r.situacao]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Por privacidade, não mostramos nome nem e-mail de quem se cadastrou.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Repasses recebidos</h2>
          {data.payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum repasse ainda.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.payouts.map((p, i) => (
                <li key={`${p.paid_at}-${i}`} className="flex items-center justify-between py-2">
                  <span>{formatDate(p.paid_at)}</span>
                  <span className="font-medium">
                    {formatBRL(p.amount_cents)} <span className="text-muted-foreground">· PIX</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </Shell>
  );
}
