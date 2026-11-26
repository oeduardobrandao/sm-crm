import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { i18n } from '@mesaas/i18n';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getEffectivePlanWithSource,
  hasUsedTrial,
  getWorkspaceSubscription,
  listActivePlans,
  markTrialOfferSeen,
  startCheckout,
  type BillingInterval,
  type BillingPlan,
  type EffectivePlan,
} from '@/services/billing';
import {
  checkoutBlocked,
  isSelectableTrialPlan,
  isTrialOfferEligible,
  planHasPortal,
  resolveCurrentPlanId,
} from '@/pages/configuracao/cobranca/plan-display';
import { isReverseTrialRunning, reverseTrialPhase } from '@/lib/reverseTrial';
import { captureEvent } from '@/lib/analytics';
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
import { rememberCheckoutValue } from '@/lib/googleAdsLoader';
import { isPagarme12xEnabled } from '@/lib/pagarme-gate';
import {
  formatPlanPrice,
  planAnnualCents,
  planMonthlyCents,
  type BillingCurrency,
} from '@/lib/planPrice';
import { isWhatsAppSupportEnabled } from '@/lib/whatsapp';
import { WhatsAppSupportButton } from '@/components/support/WhatsAppSupportButton';
import { PagarmeCheckoutDialog } from '@/components/billing/PagarmeCheckoutDialog';
import { parsePlanIntent } from './plan-intent';
import { trialCandidates } from './recommend';
import { TrialPlanPicker, type ComecarMode } from './TrialPlanPicker';
import { formatComecarTrialDate, useComecarLang } from './comecarLocale';
import './comecar.css';

const RECOMMENDED_ID = 'pro';
const EFFECTIVE_PLAN_KEY = ['billing', 'effective-plan-with-source'] as const;

type CheckoutExtra = {
  recommended_plan_id?: string;
  accepted_recommendation?: boolean;
  reverse_trial?: boolean;
  days_left?: number;
};

function planHighlights(p: BillingPlan, t: TFunction<'setup'>): string[] {
  const out: string[] = [];
  out.push(
    p.max_clients == null
      ? t('comecar.unlimitedClients')
      : t('comecar.clientsCount', { count: p.max_clients }),
  );
  out.push(
    p.max_team_members == null
      ? t('comecar.unlimitedUsers')
      : t('comecar.usersCount', { count: p.max_team_members }),
  );
  if (planHasPortal(p)) out.push(t('comecar.clientPortal'));
  return out;
}

/**
 * Starts a Stripe Checkout session and redirects to it. Shared by the
 * auto-checkout effect and the manual "Começar teste" button so the two
 * paths cannot drift. Returns whether it succeeded; the caller resets its
 * own local state (the intent or the busy flag) on failure.
 */
async function startAndRedirect(
  planId: string,
  interval: BillingInterval,
  extra?: CheckoutExtra,
): Promise<boolean> {
  try {
    const url = await startCheckout(planId, interval, 'onboarding');
    // The grid and intent paths keep their exact three-argument call; only the picker
    // adds the recommendation context.
    if (extra) captureCheckoutStarted(planId, interval, 'onboarding', 'stripe', extra);
    else captureCheckoutStarted(planId, interval, 'onboarding');
    window.location.assign(url);
    return true;
  } catch (err) {
    toast.error(i18n.t('setup:comecar.checkoutFailed', { message: (err as Error).message }));
    return false;
  }
}

export default function ComecarPage() {
  const { t } = useTranslation('setup');
  const lang = useComecarLang();
  const { role, workspaceRole, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'picker' | 'grid'>('picker');
  const [now] = useState(() => new Date());
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntent] = useState(() => parsePlanIntent(location.search));
  const [pagarmeDialog, setPagarmeDialog] = useState<{ plan: BillingPlan } | null>(null);
  // Latches so the auto-checkout and the view event fire once per mount. React's
  // double-invoke in development would otherwise open two Stripe sessions.
  const autoStarted = useRef(false);
  const viewLogged = useRef(false);
  // One mark_trial_offer_seen call per mount, shared by the view effect, checkout and
  // the Free link, so none of them can race ahead of it.
  const seenPromise = useRef<Promise<void> | null>(null);

  // Follow the ACTIVE workspace role, not the stale profile-level role — a user
  // can be owner in one workspace and agent in another, and switch_workspace
  // never rewrites profiles.role. This mirrors TrialNudgeCard and what
  // billing-checkout now enforces server side against workspace_members.
  const isOwner = (workspaceRole ?? role) === 'owner';

  const {
    data: subscription,
    isLoading: subLoading,
    isError: subError,
    refetch: refetchSubscription,
  } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
  });
  const {
    data: plans,
    isLoading: plansLoading,
    isError: plansError,
    refetch: refetchPlans,
  } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: isOwner,
  });
  // Same key TrialNudgeCard uses, so the two share one cache entry. Needed
  // because hasEverSubscribed alone does not catch a comp/internal plan: a
  // Lifetime workspace, or one an admin granted a paid plan in the platform
  // admin portal, has no Stripe subscription and would otherwise sail past the
  // guard and start a paid subscription on top of its comp arrangement.
  const {
    data: effectivePlan,
    isLoading: planLoading,
    isError: planError,
    refetch: refetchEffectivePlan,
  } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: isOwner,
  });

  // Hooks cannot sit behind the early returns below, so the effects re-check
  // readiness themselves. `ready` is what keeps them from firing against
  // undefined data mid-load.
  const ready = !authLoading && isOwner && !subLoading && !plansLoading && !planLoading;
  // Only a query that never produced data gates the screen. A failed background
  // refetch (window focus, a later invalidation) keeps the last good value, so it must
  // never replace the picker or unmount an open Pagar.me dialog.
  const hasError =
    (subError && subscription === undefined) ||
    (plansError && plans === undefined) ||
    (planError && effectivePlan === undefined);
  // Only a Free workspace (a NULL workspaces.plan_id resolves to 'free') that was not
  // put there by an admin (`manual`) and has never trialed may start a trial. Paid and
  // comp/internal plans like Lifetime are already provisioned.
  // A failed subscription query must never read as "never subscribed" - that
  // would let a workspace that already subscribed reopen a trial checkout.
  // `eligible` stays false while any query has errored.
  const eligible = ready && !hasError && isTrialOfferEligible(effectivePlan, subscription);
  // The workspace's billing currency: prices, the 12x gate and the conversion value follow it.
  const currency: BillingCurrency = effectivePlan?.billingCurrency ?? 'brl';

  // Reverse trial (14 days of Pro without a card). A running trial, or one that ended on Free,
  // is admitted here as a plan picker even though the card trial is spent: during the trial
  // the first charge waits for its end date, after it the charge is immediate. The landing
  // intent auto-checkout stays gated on `eligible` (never trialed) alone.
  const reverseRunning = isReverseTrialRunning(effectivePlan);
  const reverseEndsAt = reverseRunning ? (effectivePlan?.reverseTrial?.endsAt ?? null) : null;
  const reverseEnded =
    !reverseRunning &&
    Boolean(effectivePlan?.reverseTrial?.startedAt) &&
    effectivePlan?.planSource !== 'manual' &&
    resolveCurrentPlanId(effectivePlan?.planId, subscription?.plan_id) === 'free';
  const reverseAdmitted = (reverseRunning || reverseEnded) && !checkoutBlocked(subscription, now);
  const mode: ComecarMode = reverseRunning
    ? 'reverse_running'
    : reverseEnded
      ? 'reverse_ended'
      : 'card_trial';
  const reverseExtra: CheckoutExtra | undefined = reverseEndsAt
    ? { reverse_trial: true, days_left: reverseTrialPhase(now, reverseEndsAt).daysLeft }
    : undefined;
  // `recomendado` only preselects the picker; it never starts a checkout (unlike plan/interval).
  const preferredPlanId = new URLSearchParams(location.search).get('recomendado');

  /** Stamps the cached effective plan as seen, without a refetch that could fail. */
  const markSeenInCache = () => {
    queryClient.setQueryData<EffectivePlan>(EFFECTIVE_PLAN_KEY, (old) =>
      old ? { ...old, trialOfferSeenAt: old.trialOfferSeenAt ?? new Date().toISOString() } : old,
    );
  };

  /** Records that the offer was shown. Failures are logged and swallowed: the screen must still work. */
  const ensureTrialOfferSeen = (): Promise<void> => {
    if (!seenPromise.current) {
      seenPromise.current = markTrialOfferSeen().then(
        () => {
          markSeenInCache();
        },
        (err: unknown) => {
          console.warn('[comecar] mark_trial_offer_seen failed', err);
        },
      );
    }
    return seenPromise.current;
  };

  /**
   * Dispatches to the Pagar.me 12x dialog for a gated annual plan, or falls back to the
   * Stripe redirect otherwise. Shared by the auto-intent effect and the manual "Começar
   * teste" button so the two paths cannot drift, mirroring startAndRedirect above.
   *
   * When it opens the dialog it also clears `busy` and `intent`: `intent` gates the
   * "Preparando checkout" standby screen below, which must not linger over a dialog that
   * isn't redirecting anywhere, and closing the dialog without completing must land back
   * on a usable plan grid rather than that screen. Both calls are no-ops for the manual
   * path (intent is already null there, since the standby screen would otherwise block
   * the grid) and harmless for the auto-intent path (busy isn't read while it renders the
   * standby screen). Neither touches the Stripe/startAndRedirect branch, so that path
   * stays byte-identical to today.
   */
  const beginCheckout = async (
    planId: string,
    interval: BillingInterval,
    extra?: CheckoutExtra,
  ): Promise<boolean> => {
    // Wait for the seen marker before leaving for Stripe (or opening Pagar.me), so a
    // lagging webhook can never bounce someone who just entered a card back here.
    await ensureTrialOfferSeen();
    const plan = plans?.find((p) => p.id === planId);
    rememberCheckoutValue(
      plan
        ? interval === 'year'
          ? planAnnualCents(plan, currency)
          : planMonthlyCents(plan, currency)
        : null,
      currency,
    );
    if (interval === 'year' && plan && isPagarme12xEnabled(plan, currency)) {
      if (reverseExtra) {
        captureCheckoutStarted(planId, 'year', 'onboarding', 'pagarme', reverseExtra);
      } else {
        captureCheckoutStarted(planId, 'year', 'onboarding', 'pagarme');
      }
      setPagarmeDialog({ plan });
      setBusy(null);
      setIntent(null);
      return true;
    }
    return startAndRedirect(planId, interval, extra);
  };

  useEffect(() => {
    if (!eligible) return;
    void ensureTrialOfferSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible]);

  useEffect(() => {
    if (!eligible || viewLogged.current) return;
    viewLogged.current = true;
    captureEvent('trial_step_viewed', { has_intent: Boolean(intent) });
  }, [eligible, intent]);

  useEffect(() => {
    if (!eligible || !intent || autoStarted.current) return;
    autoStarted.current = true;
    void (async () => {
      const ok = await beginCheckout(intent.planId, intent.interval);
      if (!ok) setIntent(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, intent]);

  if (authLoading || (isOwner && (subLoading || plansLoading || planLoading))) {
    return (
      <div className="comecar-shell comecar-shell--center">
        <Loader2 className="comecar-spin" size={24} aria-hidden="true" />
      </div>
    );
  }
  if (!isOwner) return <Navigate to="/dashboard" replace />;

  if (hasError) {
    // A transient failure (network, RLS blip) must not silently cost a
    // legitimate new user their trial, so this fails open to a retry screen
    // rather than redirecting away.
    return (
      <div className="comecar-shell comecar-shell--center">
        <div className="comecar-standby">
          <h1>{t('comecar.loadErrorTitle')}</h1>
          <p>{t('comecar.loadErrorSub')}</p>
          <button
            type="button"
            className="comecar-cta"
            onClick={() => {
              void refetchSubscription();
              void refetchPlans();
              void refetchEffectivePlan();
            }}
          >
            {t('comecar.loadErrorRetry')}
          </button>
        </div>
      </div>
    );
  }

  // Already trialed, on a paid or comp/internal plan, or put on Free by an admin.
  // /comecar is a typeable URL that WorkspaceSetupPage links to unconditionally, so
  // this has to be enforced here and not only by hiding the entry point. Mirrors the
  // invariant canUpgradeTo already holds on Plano e Cobrança.
  if (!isTrialOfferEligible(effectivePlan, subscription) && !reverseAdmitted) {
    return <Navigate to="/dashboard" replace />;
  }

  const intentPlan = intent ? plans?.find((p) => p.id === intent.planId) : undefined;
  if (intent && eligible) {
    return (
      <div className="comecar-shell comecar-shell--center">
        <div className="comecar-standby">
          <Loader2 className="comecar-spin" size={24} aria-hidden="true" />
          <h1>{t('comecar.standbyTitle', { plan: intentPlan?.name ?? intent.planId })}</h1>
          <p>{t('comecar.standbySub')}</p>
          <button type="button" className="comecar-link" onClick={() => setIntent(null)}>
            {t('comecar.standbyOther')}
          </button>
        </div>
      </div>
    );
  }

  const selectable = (plans ?? []).filter((p) => isSelectableTrialPlan(p, currency));
  // No monthly-priced candidate means a misconfigured catalog: fall back to the grid.
  const hasPicker = trialCandidates(plans ?? [], currency).length > 0;
  const showPicker = hasPicker && view === 'picker';

  async function handleStart(planId: string) {
    setBusy(planId);
    const ok = await beginCheckout(planId, interval, reverseExtra);
    if (!ok) setBusy(null);
  }

  async function handlePickerStart(planId: string, recommendedPlanId: string) {
    setBusy(planId);
    const ok = await beginCheckout(planId, 'month', {
      recommended_plan_id: recommendedPlanId,
      accepted_recommendation: planId === recommendedPlanId,
      ...reverseExtra,
    });
    if (!ok) setBusy(null);
  }

  async function handleSkip() {
    if (mode === 'card_trial') captureEvent('trial_skipped');
    // The dashboard redirect reads the cached effective plan: mark it seen (and the
    // cache with it) first, or a fast click bounces straight back to /comecar.
    await ensureTrialOfferSeen();
    // Unconditional: also covers a failed RPC, so the click never bounces back here.
    markSeenInCache();
    navigate('/dashboard', { replace: true });
  }

  const reverseEndDate = reverseEndsAt ? formatComecarTrialDate(reverseEndsAt, lang) : '';
  const footNote =
    mode === 'reverse_running'
      ? t('comecar.footReverseRunning', { date: reverseEndDate })
      : mode === 'reverse_ended'
        ? null
        : t('comecar.footCardTrial');

  // WhatsApp support is a Brazilian channel: a USD workspace never sees it (spec §7).
  const footerHelp = currency !== 'usd' && isWhatsAppSupportEnabled() && (
    <p className="comecar-foot__help">
      {t('comecar.helpPrompt')}{' '}
      <WhatsAppSupportButton
        context="onboarding"
        label={t('comecar.helpWhatsApp')}
        className="comecar-link comecar-link--inline"
      />
    </p>
  );

  return (
    <div className="comecar-shell">
      {showPicker ? (
        <div className="comecar-inner">
          <TrialPlanPicker
            plans={plans ?? []}
            currency={currency}
            busyPlanId={busy}
            now={now}
            mode={mode}
            trialEndsAt={reverseEndsAt}
            preferredPlanId={preferredPlanId}
            onStart={(planId, recommendedPlanId) =>
              void handlePickerStart(planId, recommendedPlanId)
            }
            onSkip={() => void handleSkip()}
            onShowAllPlans={() => setView('grid')}
            onRecommended={({ clients, team, planId }) =>
              captureEvent('trial_plan_recommended', {
                clients_bucket: clients,
                team_bucket: team,
                plan_id: planId,
              })
            }
          />
          <footer className="comecar-foot">
            {footNote && <p>{footNote}</p>}
            {footerHelp}
          </footer>
        </div>
      ) : (
        <div className="comecar-inner">
          {hasPicker && (
            <button
              type="button"
              className="comecar-link comecar-back"
              onClick={() => setView('picker')}
            >
              {t('comecar.back')}
            </button>
          )}
          <header className="comecar-head">
            {mode === 'reverse_running' ? (
              <>
                <h1>{t('comecar.gridTitleReverseRunning')}</h1>
                <p>{t('comecar.gridSubReverseRunning', { date: reverseEndDate })}</p>
              </>
            ) : mode === 'reverse_ended' ? (
              <>
                <h1>{t('comecar.gridTitleReverseEnded')}</h1>
                <p>{t('comecar.gridSubReverseEnded')}</p>
              </>
            ) : (
              <>
                <h1>{t('comecar.gridTitleCardTrial')}</h1>
                <p>{t('comecar.gridSubCardTrial')}</p>
              </>
            )}
          </header>

          <div className="comecar-toggle" role="group" aria-label={t('comecar.billingPeriod')}>
            <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
              {t('comecar.monthly')}
            </button>
            <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
              {t('comecar.annual')}
            </button>
          </div>

          <div className="comecar-grid">
            {selectable.map((p) => {
              const isYear = interval === 'year';
              // No price for the SELECTED interval means no Stripe price id for
              // it either, so checkout would 400 with "Plan price not
              // configured". Show the "Sob consulta" card, but never an
              // actionable CTA behind it. Falling back to the monthly figure
              // under the Anual toggle would price the card wrong on top of
              // offering something unbuyable. Matches PricingSection.
              const amount = isYear ? planAnnualCents(p, currency) : planMonthlyCents(p, currency);
              const unpriced = amount == null || amount <= 0;
              const monthly = unpriced ? null : isYear ? amount / 12 : amount;
              const gated = isYear && isPagarme12xEnabled(p, currency);
              return (
                <div
                  key={p.id}
                  className={`comecar-card${p.id === RECOMMENDED_ID ? ' is-recommended' : ''}`}
                >
                  <div className="comecar-card__top">
                    <span className="comecar-card__name">{p.name}</span>
                    {p.id === RECOMMENDED_ID && (
                      <span className="comecar-tag">{t('comecar.recommended')}</span>
                    )}
                  </div>
                  {mode === 'reverse_running' ? (
                    <p className="comecar-card__trial">
                      {t('comecar.freeUntil', { date: reverseEndDate })}
                    </p>
                  ) : mode === 'card_trial' ? (
                    <p className="comecar-card__trial">{t('comecar.thirtyDaysFree')}</p>
                  ) : null}
                  <p className="comecar-card__price">
                    {mode === 'reverse_ended' ? '' : t('comecar.afterPrefix')}
                    {monthly == null
                      ? t('comecar.onRequest')
                      : gated
                        ? // PRIMARY AMOUNT RULE: the 12x's own parcela, never price_brl_annual / 12.
                          t('comecar.installments', {
                            installment: formatPlanPrice(
                              p.pagarme_installment_cents ?? 0,
                              currency,
                            ),
                            total: formatPlanPrice(amount ?? 0, currency),
                          })
                        : t('comecar.perMonth', { price: formatPlanPrice(monthly, currency) })}
                  </p>
                  <ul className="comecar-card__features">
                    {planHighlights(p, t).map((f) => (
                      <li key={f}>
                        <Check size={14} aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="comecar-cta"
                    onClick={() => handleStart(p.id)}
                    disabled={busy !== null || unpriced}
                  >
                    {busy === p.id
                      ? t('comecar.wait')
                      : mode === 'reverse_running'
                        ? t('comecar.ctaReverseRunning')
                        : mode === 'reverse_ended'
                          ? t('comecar.ctaReverseEnded')
                          : t('comecar.ctaCardTrial')}
                  </button>
                </div>
              );
            })}
          </div>

          <footer className="comecar-foot">
            {footNote && <p>{footNote}</p>}
            <button type="button" className="comecar-link" onClick={() => void handleSkip()}>
              {mode === 'reverse_running' ? t('comecar.decideLater') : t('comecar.stayFree')}
            </button>
            {footerHelp}
          </footer>
        </div>
      )}

      <PagarmeCheckoutDialog
        open={!!pagarmeDialog}
        mode="checkout"
        plan={
          pagarmeDialog
            ? {
                id: pagarmeDialog.plan.id,
                name: pagarmeDialog.plan.name,
                price_brl_annual: pagarmeDialog.plan.price_brl_annual ?? 0,
                pagarme_installment_cents: pagarmeDialog.plan.pagarme_installment_cents ?? 0,
              }
            : null
        }
        source="onboarding"
        trialEligible={reverseRunning || !hasUsedTrial(subscription, effectivePlan)}
        trialEndsAt={reverseEndsAt}
        onPayUpfront={
          pagarmeDialog
            ? () => {
                const planId = pagarmeDialog.plan.id;
                setPagarmeDialog(null);
                void startAndRedirect(planId, 'year');
              }
            : undefined
        }
        onClose={() => setPagarmeDialog(null)}
        onSuccess={() =>
          // The dashboard's ?trial=started toast promises the 30-day card trial; a reverse-trial
          // checkout lands on Cobrança, which confirms the payment and polls the plan.
          navigate(
            mode === 'card_trial'
              ? '/dashboard?trial=started'
              : '/configuracao/cobranca?status=success',
          )
        }
      />
    </div>
  );
}
