import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { listPublicPricingPlans, type PublicPricingPlan } from '@/services/billing';
import { buildPlanIntentQuery } from '@/pages/comecar/plan-intent';
import { isPagarme12xEnabled } from '@/lib/pagarme-gate';
import PlanComparison from './PlanComparison';

/** Centavos → display string. R$ 0 stays "R$ 0"; otherwise pt-BR currency (e.g. R$ 99,90). */
function formatPrice(centavos: number): string {
  if (centavos === 0) return 'R$ 0';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const PLAN_MARKETING: Record<string, { description: string; cta: string; highlight?: boolean }> = {
  free: {
    description: 'Para conhecer a plataforma.',
    cta: 'Começar grátis',
  },
  start: {
    description: 'Para freelancers que estão começando.',
    cta: 'Começar teste grátis',
  },
  pro: {
    description: 'Para freelancers com carteira consolidada.',
    cta: 'Começar teste grátis',
    highlight: true,
  },
  max: {
    description: 'Para micro-agências e equipes completas.',
    cta: 'Começar teste grátis',
  },
};

function displayLimit(limit: number | null): string {
  return limit == null ? 'Ilimitado' : String(limit);
}

function annualSavingsPct(plans: PublicPricingPlan[]): number {
  return plans.reduce((best, plan) => {
    if (!plan.price_brl || !plan.price_brl_annual) return best;
    const saving = Math.round((1 - plan.price_brl_annual / (plan.price_brl * 12)) * 100);
    return Math.max(best, saving);
  }, 0);
}

export function PricingSection() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const pricingRef = useRef<HTMLElement>(null);
  const [shouldLoadPlans, setShouldLoadPlans] = useState(false);

  useEffect(() => {
    const section = pricingRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadPlans(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoadPlans(true);
        observer.disconnect();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const {
    data: plans = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['landing', 'pricing-plans'],
    queryFn: listPublicPricingPlans,
    enabled: shouldLoadPlans,
    staleTime: 5 * 60_000,
  });

  const savingsPct = annualSavingsPct(plans);

  const isYear = period === 'year';
  const isLoadingPlans = !shouldLoadPlans || isPending;

  // Visitors must sign up before checkout. Paid plans carry the choice through
  // signup so the trial starts without another plan decision.
  const planHref = (id: string) => {
    if (id === 'free') return user ? '/dashboard' : '/login?tab=register';
    if (user) return '/configuracao/cobranca';
    return `/login?tab=register&${buildPlanIntentQuery(id, period)}`;
  };

  const planAction = (plan: PublicPricingPlan) => {
    const marketing = PLAN_MARKETING[plan.id] ?? {
      description: `Conheça o plano ${plan.name}.`,
      cta: `Assinar ${plan.name}`,
    };
    return {
      href: planHref(plan.id),
      label: plan.id === 'free' && user ? 'Acessar painel' : marketing.cta,
      primary: marketing.highlight,
    };
  };

  return (
    <section ref={pricingRef} className="lp-pad" id="pricing">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Planos e preços</span>
          <h2>Um plano que cresce junto com a sua agência.</h2>
          <p>
            Comece com o plano Free e mude de plano quando quiser. Sem fidelidade — cancele a
            qualquer momento.
          </p>
          <div className="pricing-promo-note">
            30 dias grátis em qualquer plano pago. Sem código, cancele quando quiser.
          </div>
        </div>

        <div className="pricing-toggle-row reveal">
          <div className="pricing-toggle" role="group" aria-label="Período de cobrança">
            <button aria-pressed={!isYear} onClick={() => setPeriod('month')}>
              Mensal
            </button>
            <button aria-pressed={isYear} onClick={() => setPeriod('year')}>
              Anual
            </button>
          </div>
          {savingsPct > 0 && (
            <span className="pricing-save">Economize até {savingsPct}% no plano anual</span>
          )}
        </div>

        <div className="plans-grid" aria-busy={isLoadingPlans}>
          {isLoadingPlans ? (
            <>
              <span className="pricing-loading-status" role="status">
                Carregando planos
              </span>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="plan-card plan-card-skeleton" aria-hidden="true">
                  <span className="pricing-sk pricing-sk--name" />
                  <span className="pricing-sk pricing-sk--price" />
                  <span className="pricing-sk pricing-sk--description" />
                  <span className="pricing-sk pricing-sk--line" />
                  <span className="pricing-sk pricing-sk--line" />
                  <span className="pricing-sk pricing-sk--button" />
                </div>
              ))}
            </>
          ) : isError ? (
            <div className="pricing-state" role="alert">
              <p>Não foi possível carregar os planos agora.</p>
              <button type="button" className="lp-btn lp-btn-outline" onClick={() => refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : plans.length === 0 ? (
            <div className="pricing-state">
              <p>Os planos estão temporariamente indisponíveis.</p>
            </div>
          ) : (
            plans.map((plan) => {
              const marketing = PLAN_MARKETING[plan.id] ?? {
                description: `Conheça o plano ${plan.name}.`,
                cta: `Assinar ${plan.name}`,
              };
              const hasAnnualPrice = plan.price_brl_annual != null && plan.price_brl_annual > 0;
              const isFree = plan.price_brl === 0 && plan.price_brl_annual === 0;
              // PRIMARY AMOUNT RULE: a gated year card's prominent price is the 12x's own
              // parcela (pagarme_installment_cents), never price_brl_annual / 12 — that
              // derivation would contradict the exact figure the checkout dialog charges.
              // Non-gated cards (or gate off) keep today's derivation unchanged.
              const gated = isYear && hasAnnualPrice && isPagarme12xEnabled(plan);
              const amount = isYear
                ? isFree
                  ? 0
                  : gated
                    ? plan.pagarme_installment_cents!
                    : hasAnnualPrice
                      ? plan.price_brl_annual! / 12
                      : null
                : plan.price_brl;
              // The discount vs. paying monthly all year, always computed from the real
              // catalog values (never a hard-coded percentage — plans discount unevenly).
              const upfrontOffPct =
                gated && plan.price_brl && plan.price_brl > 0
                  ? Math.round((1 - plan.price_brl_annual! / (12 * plan.price_brl)) * 100)
                  : null;
              return (
                <div
                  key={plan.id}
                  className={`plan-card${marketing.highlight ? ' highlight' : ''}`}
                >
                  {marketing.highlight && <div className="plan-badge">Mais popular</div>}
                  <h3>{plan.name}</h3>
                  <div className="price-row">
                    <span className="price">
                      {amount == null ? 'Sob consulta' : formatPrice(amount)}
                    </span>
                    {amount != null && <span className="price-sub">/mês</span>}
                  </div>
                  <div className="price-annual-note">
                    {isYear && hasAnnualPrice
                      ? gated
                        ? `12x no cartão, sem juros · ou ${formatPrice(plan.price_brl_annual!)} à vista${
                            upfrontOffPct != null ? ` (${upfrontOffPct}% off)` : ''
                          }`
                        : `cobrado anualmente (${formatPrice(plan.price_brl_annual!)}/ano)`
                      : ' '}
                  </div>
                  {!isFree && <div className="plan-trial-note">30 dias grátis para começar</div>}
                  <div className="plan-tag">{marketing.description}</div>
                  <div className="plan-label">Limites</div>
                  <ul className="plan-list plan-limits">
                    <li>
                      <span className="k">Clientes</span>
                      <span className="v">{displayLimit(plan.max_clients)}</span>
                    </li>
                    <li>
                      <span className="k">Usuários</span>
                      <span className="v">{displayLimit(plan.max_team_members)}</span>
                    </li>
                  </ul>
                  <div className="plan-cta">
                    <a
                      href={planHref(plan.id)}
                      className={`lp-btn ${marketing.highlight ? 'lp-btn-primary' : 'lp-btn-outline'}`}
                    >
                      {plan.id === 'free' && user ? 'Acessar painel' : marketing.cta}
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!isLoadingPlans && !isError && plans.length > 0 && (
          <PlanComparison plans={plans} actionFor={planAction} />
        )}
      </div>
    </section>
  );
}
