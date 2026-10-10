import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Clock, Copy, ExternalLink, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { buildReferralLink } from '@/lib/referral';
import {
  AffiliateApiError,
  affiliateLogout,
  formatBRL,
  getAffiliateDashboard,
  openAffiliateStripeDashboard,
  startAffiliateStripeConnect,
  type AffiliateDashboard,
  type CommissionSituacao,
  type PayoutStatus,
  type ReferralSituacao,
} from '@/services/affiliates';
import AfiliadosLayout from './AfiliadosLayout';
import CommissionSimulator from './CommissionSimulator';
import RequestLinkCard from './RequestLinkCard';
import { clearSession, isSessionPersisted, readSession, saveSession } from './session';
import CommissionTable from './CommissionTable';
import { formatRate } from './simulator';
import { useCommissionTable } from './useCommissionTable';

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

const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  pending: 'Processando',
  paid: 'Enviado',
  failed: 'Não enviado (tentaremos no próximo mês)',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** 404 da função = sessão vencida, revogada ou desconhecida. 429 e 5xx não derrubam a sessão. */
function isSessionGone(err: unknown): boolean {
  return err instanceof AffiliateApiError && err.status === 404;
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

/** Conta Stripe do afiliado: conectar, continuar o cadastro ou abrir o painel do Stripe. */
function StripeCard({
  token,
  data,
  onSessionGone,
}: {
  token: string;
  data: AffiliateDashboard;
  onSessionGone: () => void;
}) {
  const { stripe, status } = data.affiliate;
  const redirect = (url: string) => window.location.assign(url);

  const onError = (err: Error) => (isSessionGone(err) ? onSessionGone() : toast.error(err.message));
  const start = useMutation({
    mutationFn: () => startAffiliateStripeConnect(token),
    onSuccess: ({ url }) => redirect(url),
    onError,
  });
  const dashboard = useMutation({
    mutationFn: () => openAffiliateStripeDashboard(token),
    onSuccess: ({ url }) => redirect(url),
    onError,
  });

  const minPayout = formatBRL(data.min_payout_cents);

  let icon = <Clock className="h-5 w-5 text-[var(--warning)]" aria-hidden="true" />;
  let title = 'Conecte sua conta para receber';
  let body = `Os repasses são feitos pelo Stripe direto para a sua conta bancária, todo mês, a partir de ${minPayout} disponíveis. O Stripe pede seus dados e sua conta bancária.`;
  let action = (
    <Button onClick={() => start.mutate()} disabled={start.isPending || status !== 'active'}>
      {start.isPending ? 'Abrindo o Stripe…' : 'Conectar com Stripe'}
    </Button>
  );

  if (stripe.transfers_active) {
    icon = <CircleCheck className="h-5 w-5 text-[var(--success)]" aria-hidden="true" />;
    title = 'Pronto para receber';
    body = `Seu saldo disponível é enviado pelo Stripe todo mês, a partir de ${minPayout}. No painel do Stripe você vê os depósitos e pode trocar a conta bancária.`;
    action = (
      <Button variant="outline" onClick={() => dashboard.mutate()} disabled={dashboard.isPending}>
        <ExternalLink className="mr-2 h-4 w-4" />
        {dashboard.isPending ? 'Abrindo…' : 'Abrir painel do Stripe'}
      </Button>
    );
  } else if (stripe.details_submitted) {
    title = 'Cadastro em análise pelo Stripe';
    body =
      'O Stripe está verificando seus dados. Se ele pedir alguma informação a mais, continue o cadastro pelo botão abaixo.';
    action = (
      <Button variant="outline" onClick={() => start.mutate()} disabled={start.isPending}>
        {start.isPending ? 'Abrindo o Stripe…' : 'Continuar cadastro no Stripe'}
      </Button>
    );
  } else if (stripe.connected) {
    title = 'Termine seu cadastro no Stripe';
    action = (
      <Button onClick={() => start.mutate()} disabled={start.isPending || status !== 'active'}>
        {start.isPending ? 'Abrindo o Stripe…' : 'Continuar cadastro no Stripe'}
      </Button>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">{body}</p>
      {action}
    </section>
  );
}

/**
 * /afiliados/painel: lê a sessão do navegador (ver session.ts). A rota legada
 * /afiliados/painel/:token (links de 180 dias já enviados) adota o token como sessão, se não
 * houver uma, e troca a URL pela limpa, preservando ?stripe=.
 */
export default function AfiliadoPainelPage() {
  const { token: legacyToken } = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const table = useCommissionTable();
  const storageBlocked = (location.state as { storageBlocked?: boolean } | null)?.storageBlocked;

  const [token, setToken] = useState<string | null>(() => {
    const existing = readSession();
    if (existing) return existing;
    if (legacyToken) {
      saveSession(legacyToken);
      return legacyToken;
    }
    return null;
  });

  useEffect(() => {
    if (legacyToken) navigate(`/afiliados/painel${location.search}`, { replace: true });
  }, [legacyToken, location.search, navigate]);

  const onSessionGone = useCallback(() => {
    clearSession();
    setToken(null);
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['affiliate-dashboard', token],
    queryFn: () => getAffiliateDashboard(token as string),
    enabled: !!token && !legacyToken,
    retry: false,
  });

  useEffect(() => {
    if (isError && isSessionGone(error)) onSessionGone();
  }, [isError, error, onSessionGone]);

  // Volta do onboarding do Stripe: o painel já relê a conta no carregamento.
  const stripeReturn = searchParams.get('stripe');
  useEffect(() => {
    if (legacyToken || !token) return;
    if (stripeReturn === 'retorno') toast.success('Cadastro no Stripe atualizado');
    if (stripeReturn) setSearchParams({}, { replace: true });
  }, [legacyToken, token, stripeReturn, setSearchParams]);

  const logout = async () => {
    const current = token;
    clearSession();
    setToken(null);
    if (current) await affiliateLogout(current).catch(() => undefined);
    navigate('/afiliados', { replace: true });
  };

  const headerRight = (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline">Painel do afiliado</span>
      {token && (
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sair
        </Button>
      )}
    </div>
  );

  if (!token) {
    return (
      <AfiliadosLayout headerRight={headerRight}>
        <RequestLinkCard
          title="Entre no painel do afiliado"
          body="Sua sessão terminou ou este navegador ainda não entrou no painel. Informe o e-mail cadastrado no programa e enviaremos um link de acesso."
        />
      </AfiliadosLayout>
    );
  }

  if (isLoading || legacyToken) {
    return (
      <AfiliadosLayout headerRight={headerRight}>
        <div className="flex justify-center py-24">
          <Spinner size="lg" />
        </div>
      </AfiliadosLayout>
    );
  }

  if (isError || !data) {
    return (
      <AfiliadosLayout headerRight={headerRight}>
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <CircleAlert
            className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]"
            aria-hidden="true"
          />
          <h1 className="mb-2 text-xl font-semibold">Não foi possível carregar o painel</h1>
          <p className="mb-6 text-sm text-muted-foreground">Tente de novo em alguns instantes.</p>
          <Button onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      </AfiliadosLayout>
    );
  }

  const { affiliate, summary } = data;
  const link = buildReferralLink(affiliate.code);
  const planName = (id: string | null) =>
    table.rows.find((r) => r.planId === id)?.planName ?? id ?? '—';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  return (
    <AfiliadosLayout headerRight={headerRight}>
      {(storageBlocked || !isSessionPersisted()) && (
        <div
          className="mb-6 rounded-xl border border-[var(--warning)] bg-card p-4 text-sm"
          role="status"
        >
          Este navegador não deixou o Mesaas guardar o seu acesso. Se você recarregar a página,
          fechar a aba ou sair para o Stripe, vai precisar pedir um novo link por e-mail.
        </div>
      )}
      <h1 className="mb-1 text-2xl font-bold">Olá, {affiliate.nome.split(' ')[0]}!</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Você recebe comissão pelos primeiros meses pagos de cada indicado, conforme a tabela abaixo.
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
          hint="Vai no próximo repasse"
        />
        <Kpi label="Já recebido" value={formatBRL(summary.paid_out_cents)} />
      </section>

      <div className="mb-6">
        <StripeCard token={token} data={data} onSessionGone={onSessionGone} />
      </div>

      <section className="mb-6 grid gap-6 md:grid-cols-2">
        <CommissionTable rows={table.rows} isLoading={table.isLoading} />
        <CommissionSimulator rows={table.rows} isLoading={table.isLoading} />
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
                  <th className="py-2 pr-4 font-medium">Plano</th>
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
                    <td className="py-2 pr-4">
                      {planName(c.plan_id)}{' '}
                      <span className="text-muted-foreground">· {formatRate(c.rate_bps)}</span>
                    </td>
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
          <h2 className="mb-3 text-lg font-semibold">Repasses</h2>
          {data.payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum repasse ainda.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.payouts.map((p, i) => (
                <li key={`${p.created_at}-${i}`} className="flex items-center justify-between py-2">
                  <span>
                    {formatDate(p.paid_at ?? p.created_at)}{' '}
                    <span className="text-muted-foreground">· {PAYOUT_LABEL[p.status]}</span>
                  </span>
                  <span className="font-medium">{formatBRL(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AfiliadosLayout>
  );
}
