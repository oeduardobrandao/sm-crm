import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  startCheckout,
  openBillingPortal,
  type BillingInterval,
  type BillingPlan,
} from '@/services/billing';
import './cobranca.css';

const RECOMMENDED_ID = 'pro';

/** plans.price_brl is stored in centavos (e.g. 9990 = R$ 99,90). */
function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatStorage(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function planFeatures(p: BillingPlan): string[] {
  const out: string[] = [];
  out.push(
    p.max_clients == null
      ? 'Clientes ilimitados'
      : `${p.max_clients} ${p.max_clients === 1 ? 'cliente' : 'clientes'}`,
  );
  out.push(
    p.max_team_members == null
      ? 'Usuários ilimitados'
      : `${p.max_team_members} ${p.max_team_members === 1 ? 'usuário' : 'usuários'}`,
  );
  if (p.storage_quota_bytes != null)
    out.push(`${formatStorage(p.storage_quota_bytes)} de armazenamento`);
  if (p.feature_hub_portal) out.push('Portal de aprovação do cliente');
  if (p.feature_analytics_reports) out.push('Relatórios de desempenho');
  if (p.feature_brand_customization) out.push('Personalização de marca');
  return out;
}

export default function CobrancaPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const isOwner = role === 'owner';
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: isOwner,
  });
  const { data: subscription, refetch: refetchSub } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
  });

  // Handle the Checkout return once on mount (see git history for why deps are empty).
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'success') {
      toast.success('Pagamento confirmado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        refetchSub();
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      setSearchParams({}, { replace: true });
      return () => window.clearInterval(id);
    }
    toast('Checkout cancelado.');
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const annualSavingsPct = useMemo(() => {
    let best = 0;
    for (const p of plans ?? []) {
      if (p.price_brl && p.price_brl_annual) {
        const pct = Math.round((1 - p.price_brl_annual / (p.price_brl * 12)) * 100);
        if (pct > best) best = pct;
      }
    }
    return best;
  }, [plans]);

  if (!isOwner) {
    return (
      <div className="page-content" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="header">
          <div className="header-title">
            <h1>Plano &amp; Cobrança</h1>
          </div>
        </div>
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>
            Apenas o proprietário da conta pode gerenciar a assinatura.
          </p>
        </div>
      </div>
    );
  }

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';
  const currentPlanId = subscription?.plan_id ?? 'free';
  const currentPlan = plans?.find((p) => p.id === currentPlanId);

  async function handleUpgrade(planId: string) {
    setBusy(planId);
    try {
      const url = await startCheckout(planId, interval);
      window.location.assign(url);
    } catch (err) {
      toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    try {
      const url = await openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      toast.error('Erro ao abrir portal: ' + (err as Error).message);
      setBusy(null);
    }
  }

  function renderCta(p: BillingPlan) {
    if (p.id === currentPlanId) {
      return <span className="plan-cta__static">Plano atual</span>;
    }
    if (!hasActiveSub && p.id !== 'free') {
      return (
        <button
          className="btn-primary"
          onClick={() => handleUpgrade(p.id)}
          disabled={busy === p.id}
        >
          {busy === p.id ? 'Aguarde…' : 'Fazer upgrade'}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="page-content" style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div className="header">
        <div className="header-title">
          <h1>Plano &amp; Cobrança</h1>
        </div>
      </div>

      {hasActiveSub && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="billing-current">
            <div>
              <span className="billing-current__label">Seu plano</span>
              <div className="billing-current__plan">
                <span className="billing-current__name">{currentPlan?.name ?? currentPlanId}</span>
                <span
                  className={`badge ${subscription?.status === 'past_due' ? 'badge-warning' : 'badge-success'}`}
                >
                  {subscription?.status === 'trialing'
                    ? 'Teste'
                    : subscription?.status === 'past_due'
                      ? 'Pagamento pendente'
                      : 'Ativo'}
                </span>
              </div>
              {subscription?.current_period_end && (
                <div className="billing-current__meta">
                  {subscription.cancel_at_period_end ? 'Cancela em ' : 'Renova em '}
                  {formatDate(subscription.current_period_end)}
                </div>
              )}
            </div>
            <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
              <i className="ph ph-gear-six" aria-hidden="true" />
              {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
            </button>
          </div>
        </div>
      )}

      <div className="billing-toolbar">
        <div className="billing-toggle" role="group" aria-label="Período de cobrança">
          <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            Mensal
          </button>
          <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            Anual
          </button>
        </div>
        {annualSavingsPct > 0 && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            Economize até {annualSavingsPct}% no anual
          </span>
        )}
      </div>

      <div className="plan-grid">
        {plansLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="plan-card plan-skeleton"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="sk" style={{ height: 18, width: '40%' }} />
                <div className="sk" style={{ height: 30, width: '55%', marginTop: 8 }} />
                <div className="sk" style={{ height: 12, width: '85%', marginTop: 16 }} />
                <div className="sk" style={{ height: 12, width: '70%', marginTop: 8 }} />
                <div className="sk" style={{ height: 12, width: '78%', marginTop: 8 }} />
                <div className="sk" style={{ height: 38, width: '100%', marginTop: 'auto' }} />
              </div>
            ))
          : (plans ?? []).map((p, i) => {
              const isYear = interval === 'year';
              const monthly =
                isYear && p.price_brl_annual != null ? p.price_brl_annual / 12 : p.price_brl;
              const isCurrent = p.id === currentPlanId;
              const isReco = p.id === RECOMMENDED_ID && !isCurrent;
              return (
                <div
                  key={p.id}
                  className={`plan-card${isCurrent ? ' is-current' : ''}${isReco ? ' is-recommended' : ''}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="plan-card__top">
                    <span className="plan-name">{p.name}</span>
                    {isCurrent ? (
                      <span className="plan-tag plan-tag--current">Plano atual</span>
                    ) : isReco ? (
                      <span className="plan-tag plan-tag--reco">Recomendado</span>
                    ) : null}
                  </div>

                  <div>
                    <div className="plan-price">
                      {monthly != null && monthly > 0 ? (
                        <>
                          <span className="plan-price__amount">{formatBRL(monthly)}</span>
                          <span className="plan-price__period">/mês</span>
                        </>
                      ) : (
                        <span className="plan-price__free">Grátis</span>
                      )}
                    </div>
                    <div className="plan-annual-note">
                      {isYear && p.price_brl_annual
                        ? `${formatBRL(p.price_brl_annual)} cobrado anualmente`
                        : ' '}
                    </div>
                  </div>

                  <ul className="plan-features">
                    {planFeatures(p).map((f) => (
                      <li key={f}>
                        <i className="ph ph-check" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="plan-cta">{renderCta(p)}</div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
