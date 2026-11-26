import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLandingUser } from './LandingChrome';
import {
  getEffectivePlanWithSource,
  getWorkspaceSubscription,
  hasUsedTrial,
  listPublicPricingPlans,
  type PublicPricingPlan,
} from '@/services/billing';
import { isPagarme12xEnabled } from '@/lib/pagarme-gate';
import { formatPlanPrice } from '@/lib/planPrice';
import { landingContent, signupHref, type SiteLocale } from '@/content/locale';
import PlanComparison from './PlanComparison';

type Content = ReturnType<typeof landingContent>;

/** Centavos → display string. R$ 0 stays "R$ 0"; otherwise pt-BR currency (e.g. R$ 99,90). */
function formatPrice(centavos: number): string {
  if (centavos === 0) return 'R$ 0';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** English renders USD ($29.00, "$0" for zero); Portuguese keeps the BRL formatter above. */
function priceFormatter(locale: SiteLocale): (cents: number) => string {
  return locale === 'en' ? (cents) => formatPlanPrice(cents, 'usd', 'en-US') : formatPrice;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

/** "15 clientes" / "Clientes ilimitados" — for the single-line limits chip. */
function limitPhrase(
  limit: number | null,
  [singular, plural]: [string, string],
  unlimitedSuffix: string,
): string {
  if (limit == null)
    return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ${unlimitedSuffix}`;
  return `${limit} ${limit === 1 ? singular : plural}`;
}

/** Splits "R$ 139,90" so the centavos render smaller ("R$ 139" + ",90"); en splits "$29.00". */
function PriceValue({ amount, format }: { amount: number; format: (cents: number) => string }) {
  const formatted = format(amount);
  const sep = formatted.lastIndexOf(formatted.includes(',') ? ',' : '.');
  if (sep === -1) return <>{formatted}</>;
  return (
    <>
      {formatted.slice(0, sep)}
      <span className="price-cents">{formatted.slice(sep)}</span>
    </>
  );
}

const isFreePlan = (plan: PublicPricingPlan, locale: SiteLocale) =>
  locale === 'en'
    ? plan.id === 'free' || (plan.price_usd === 0 && plan.price_usd_annual === 0)
    : plan.price_brl === 0 && plan.price_brl_annual === 0;

/** English shows Free plus the paid plans priced in USD (both monthly and annual set). */
function plansForLocale(plans: PublicPricingPlan[], locale: SiteLocale): PublicPricingPlan[] {
  if (locale !== 'en') return plans;
  return plans.filter(
    (plan) => isFreePlan(plan, locale) || (plan.price_usd != null && plan.price_usd_annual != null),
  );
}

function annualSavingsPct(plans: PublicPricingPlan[], locale: SiteLocale): number {
  return plans.reduce((best, plan) => {
    const monthly = locale === 'en' ? plan.price_usd : plan.price_brl;
    const annual = locale === 'en' ? plan.price_usd_annual : plan.price_brl_annual;
    if (!monthly || !annual) return best;
    const saving = Math.round((1 - annual / (monthly * 12)) * 100);
    return Math.max(best, saving);
  }, 0);
}

export function PricingSection({ locale = 'pt' }: { locale?: SiteLocale }) {
  const content: Content = landingContent(locale);
  const t = content.pricing;
  const format = priceFormatter(locale);
  const user = useLandingUser();
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
    data: allPlans = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['landing', 'pricing-plans'],
    queryFn: listPublicPricingPlans,
    enabled: shouldLoadPlans,
    staleTime: 5 * 60_000,
  });

  // Signed-in visitors only: the trial copy must not promise 30 days to a workspace that
  // already spent it. Until both answers arrive the offer is unknown, and an unknown offer
  // renders the neutral "Assinar" label rather than a promise that might get withdrawn.
  const { data: effectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: () => getEffectivePlanWithSource(),
    enabled: Boolean(user),
  });
  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => getWorkspaceSubscription(),
    enabled: Boolean(user),
  });
  const trialOffered = user
    ? effectivePlan !== undefined &&
      subscription !== undefined &&
      !hasUsedTrial(subscription, effectivePlan)
    : true;

  const plans = plansForLocale(allPlans, locale);
  const savingsPct = annualSavingsPct(plans, locale);
  const hasPaidPlan = plans.some((plan) => !isFreePlan(plan, locale));

  const isYear = period === 'year';
  const isLoadingPlans = !shouldLoadPlans || isPending;

  // Visitors must sign up before checkout. Paid plans carry the choice through
  // signup so the trial starts without another plan decision.
  const planHref = (id: string) => {
    if (id === 'free') return user ? '/dashboard' : signupHref(locale);
    if (user) return '/configuracao/cobranca';
    return signupHref(locale, id, period);
  };

  // Paid plans read "Assinar" once the trial is spent (or not known to be on offer).
  const ctaLabel = (plan: PublicPricingPlan, trialCta: string) => {
    if (plan.id === 'free') return user ? t.openDashboard : trialCta;
    return trialOffered ? trialCta : fill(t.subscribeTemplate, { plan: plan.name });
  };

  const planAction = (plan: PublicPricingPlan) => {
    const marketing = content.planMarketing[plan.id] ?? {
      description: fill(t.discoverTemplate, { plan: plan.name }),
      cta: fill(t.subscribeTemplate, { plan: plan.name }),
    };
    return {
      href: planHref(plan.id),
      label: ctaLabel(plan, marketing.cta),
      primary: marketing.highlight,
    };
  };

  return (
    <section ref={pricingRef} className="lp-pad" id="pricing">
      <div className="lp-container">
        <div className="section-head reveal">
          <h2>{t.title}</h2>
          <p>{`${t.promo} ${t.body}`}</p>
          <div className="pricing-promo-note">{t.promoNote}</div>
        </div>

        <div className="pricing-toggle-row reveal">
          <div className="pricing-toggle" role="group" aria-label={t.periodLabel}>
            <button aria-pressed={!isYear} onClick={() => setPeriod('month')}>
              {t.monthly}
            </button>
            <button aria-pressed={isYear} onClick={() => setPeriod('year')}>
              {t.yearly}
              {savingsPct > 0 && <span className="pricing-off">−{savingsPct}%</span>}
            </button>
          </div>
        </div>

        <div className="plans-grid" aria-busy={isLoadingPlans}>
          {isLoadingPlans ? (
            <>
              <span className="pricing-loading-status" role="status">
                {t.loading}
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
              <p>{t.loadError}</p>
              <button type="button" className="lp-btn lp-btn-outline" onClick={() => refetch()}>
                {t.retry}
              </button>
            </div>
          ) : plans.length === 0 ? (
            <div className="pricing-state">
              <p>{t.unavailable}</p>
            </div>
          ) : (
            plans.map((plan) => {
              const marketing = content.planMarketing[plan.id] ?? {
                description: fill(t.discoverTemplate, { plan: plan.name }),
                cta: fill(t.subscribeTemplate, { plan: plan.name }),
              };
              const monthlyCents = locale === 'en' ? plan.price_usd : plan.price_brl;
              const annualCents = locale === 'en' ? plan.price_usd_annual : plan.price_brl_annual;
              const hasAnnualPrice = annualCents != null && annualCents > 0;
              const isFree = isFreePlan(plan, locale);
              // PRIMARY AMOUNT RULE: a gated year card's prominent price is the 12x's own
              // parcela (pagarme_installment_cents), never price_brl_annual / 12 — that
              // derivation would contradict the exact figure the checkout dialog charges.
              // Non-gated cards (or gate off) keep today's derivation unchanged.
              const gated =
                locale === 'pt' && isYear && hasAnnualPrice && isPagarme12xEnabled(plan);
              const amount = isYear
                ? isFree
                  ? 0
                  : gated
                    ? plan.pagarme_installment_cents!
                    : hasAnnualPrice
                      ? annualCents! / 12
                      : null
                : monthlyCents;
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
                  <div className="plan-head">
                    <h3>{plan.name}</h3>
                    {marketing.highlight && <span className="plan-badge">{t.popular}</span>}
                  </div>
                  <div className="price-row">
                    <span className="price">
                      {amount == null ? (
                        t.onRequest
                      ) : (
                        <PriceValue amount={amount} format={format} />
                      )}
                    </span>
                    {amount != null && <span className="price-sub">{t.perMonth}</span>}
                  </div>
                  <div className="price-annual-note">
                    {isYear && hasAnnualPrice
                      ? gated && t.installments
                        ? `${fill(t.installments.noInterestTemplate, {
                            total: formatPrice(plan.price_brl_annual!),
                          })}${
                            upfrontOffPct != null
                              ? fill(t.installments.offTemplate, { pct: String(upfrontOffPct) })
                              : ''
                          }`
                        : fill(t.billedAnnuallyTemplate, { total: format(annualCents!) })
                      : ' '}
                  </div>
                  {!isFree && trialOffered && <div className="plan-trial-note">{t.trialNote}</div>}
                  <div className="plan-tag">{marketing.description}</div>
                  <div className="plan-limits-line">
                    {limitPhrase(plan.max_clients, t.client, t.unlimitedSuffix)} ·{' '}
                    {limitPhrase(plan.max_team_members, t.user, t.unlimitedSuffix)}
                  </div>
                  <div className="plan-cta">
                    <a
                      href={planHref(plan.id)}
                      className={`lp-btn ${marketing.highlight ? 'lp-btn-primary' : 'lp-btn-outline'}`}
                    >
                      {ctaLabel(plan, marketing.cta)}
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!isLoadingPlans && !isError && plans.length > 0 && !hasPaidPlan && t.comingSoon && (
          <p className="pricing-coming-soon">{t.comingSoon}</p>
        )}
        {!isLoadingPlans && !isError && plans.length > 0 && (
          <PlanComparison plans={plans} actionFor={planAction} locale={locale} />
        )}
      </div>
    </section>
  );
}
