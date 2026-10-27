import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  getEffectivePlanWithSource,
  hasUsedTrial,
  startCheckout,
  openBillingPortal,
  cancelPagarmeSubscription,
  type BillingInterval,
  type BillingPlan,
} from '@/services/billing';
import {
  isInternalPlan,
  resolveCurrentPlanId,
  isPlanVisible,
  canUpgradeTo,
  checkoutBlocked,
  ceilPeriodEndToUtcDate,
  switchEligible,
} from './plan-display';
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
import { isPagarme12xEnabled } from '@/lib/pagarme-gate';
import { PagarmeCheckoutDialog, formatUtcDateBR } from '@/components/billing/PagarmeCheckoutDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { UsagePanel } from './UsagePanel';
import { CobrancaPhone, CobrancaPhoneLocked } from './CobrancaPhone';
import './cobranca.css';

const RECOMMENDED_ID = 'pro';

/** plans.price_brl is stored in centavos (e.g. 9990 = R$ 99,90). */
function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString(getIntlLocale(), { style: 'currency', currency: 'BRL' });
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
  return d.toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'long', year: 'numeric' });
}

/** True when `iso` is either a YYYY-MM-DD-prefixed string or anything else `Date` can parse. */
function isFormattableDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return true;
  return !Number.isNaN(new Date(iso).getTime());
}

/**
 * current_period_end display, used both by the renewal/cancel meta line and the
 * cancel-confirmation dialog. Pagar.me returns this as a midnight-UTC calendar-date boundary
 * (the same hazard `formatUtcDateBR` exists for in PagarmeCheckoutDialog's trial_ends_at), so
 * formatting it through the browser's local timezone can print a day early for a Brazil-based
 * user (UTC-3). Stripe's timestamp is not a calendar-date boundary, so that path keeps the
 * existing local-timezone formatDate() completely unchanged. Returns '' for a value neither
 * path can make sense of, instead of throwing or showing a garbled string.
 */
function formatPeriodEnd(iso: string | null, provider: string | null): string {
  if (!iso) return '';
  if (provider === 'pagarme') return isFormattableDate(iso) ? formatUtcDateBR(iso) : '';
  return formatDate(iso);
}

function planFeatures(p: BillingPlan, t: TFunction): string[] {
  const out: string[] = [];
  out.push(
    p.max_clients == null
      ? t('cobrancaPage.features.clientsUnlimited')
      : t('cobrancaPage.features.clients', { count: p.max_clients }),
  );
  out.push(
    p.max_team_members == null
      ? t('cobrancaPage.features.usersUnlimited')
      : t('cobrancaPage.features.users', { count: p.max_team_members }),
  );
  if (p.storage_quota_bytes != null)
    out.push(t('cobrancaPage.features.storage', { size: formatStorage(p.storage_quota_bytes) }));
  if (p.feature_hub_portal) out.push(t('cobrancaPage.features.hubPortal'));
  if (p.feature_analytics_reports) out.push(t('cobrancaPage.features.analyticsReports'));
  if (p.feature_brand_customization) out.push(t('cobrancaPage.features.brandCustomization'));
  return out;
}

export default function CobrancaPage() {
  const { t } = useTranslation('billing');
  const { role, workspaceRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [pagarmeDialog, setPagarmeDialog] = useState<{
    mode: 'checkout' | 'update-card' | 'switch';
    plan: BillingPlan | null;
  } | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Phone layout below 768px; every state, query and handler above and below is shared.
  const isPhone = !useIsDesktop(768);

  // Follow the ACTIVE workspace role, not the stale profile-level role: a user
  // can be owner in one workspace and agent in another, and switch_workspace
  // never rewrites profiles.role. Every authority now resolves ownership from
  // per-workspace membership: this gate, ComecarPage, TrialNudgeCard, the
  // workspace_subscriptions_owner_read RLS policy, and the workspace_members
  // checks in billing-checkout and billing-portal. So the two actions this page
  // offers, upgrade and "Gerenciar assinatura", cannot be shown to someone the
  // server will refuse.
  const isOwner = (workspaceRole ?? role) === 'owner';
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
  // Source of truth for the workspace's plan, incl. comp overrides (e.g. Lifetime)
  // that have no Stripe subscription and would otherwise read as Free. planSource is
  // used below to hide the switch CTA from comped (plan_source='manual') workspaces —
  // the same query key TrialNudgeCard/ComecarPage share, so one cache entry feeds all three
  // (wasDemo also drives the trial gate via hasUsedTrial).
  const { data: effectivePlan, refetch: refetchEffectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: isOwner,
  });
  const effectivePlanId = effectivePlan?.planId;
  const planSource = effectivePlan?.planSource;
  const isDemo = planSource === 'demo';

  // Refetches the subscription + effective-plan queries every 2s, up to 5 tries, so the
  // UI catches up once the backend (Stripe webhook or the synchronous Pagar.me checkout)
  // has actually updated the row. Used both by the Checkout-return effect below (which
  // owns the interval's cleanup) and by imperative callers (dialog onSuccess, cancel
  // confirm) that fire-and-forget it — a self-clearing interval is fine there since
  // there's no unmount to race against a stale closure.
  function startPlanRefetchPoll(): number {
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      refetchSub();
      refetchEffectivePlan();
      if (tries >= 5) window.clearInterval(id);
    }, 2000);
    return id;
  }

  // Handle the Checkout return once on mount (see git history for why deps are empty).
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'success') {
      toast.success(t('cobrancaPage.toastPaymentConfirmed'));
      const id = startPlanRefetchPoll();
      setSearchParams({}, { replace: true });
      return () => window.clearInterval(id);
    }
    toast(t('cobrancaPage.toastCheckoutCancelled'));
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
    if (isPhone) return <CobrancaPhoneLocked />;
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)' }}>{t('shared.ownerOnly')}</p>
      </div>
    );
  }

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';
  // Pagar.me treats past_due as still in force (a new checkout is 409-blocked), and
  // update-card is the dunning-recovery path, so past_due must ALSO surface the manage
  // controls for a pagarme row — unlike hasActiveSub above, which stripe upgrade-gating
  // deliberately leaves untouched.
  const showPagarmeManage =
    subscription?.provider === 'pagarme' &&
    ['active', 'trialing', 'past_due'].includes(subscription?.status ?? '');
  // Stripe past_due/unpaid: hasActiveSub is deliberately false for these (see above), so
  // without this the manage card — the only entry point to the Billing Portal, which IS the
  // Stripe recovery path (update card / cancel) — would never render, leaving the customer
  // with no affordance at all once the upgrade CTAs are suppressed below. pagarme rows are
  // excluded: showPagarmeManage already covers past_due for that provider.
  const showStripeManage =
    subscription?.provider !== 'pagarme' &&
    ['past_due', 'unpaid'].includes(subscription?.status ?? '');
  const currentPlanId = resolveCurrentPlanId(effectivePlanId, subscription?.plan_id);
  const currentPlan = plans?.find((p) => p.id === currentPlanId);
  const visiblePlans = (plans ?? []).filter((p) => isPlanVisible(p.id, currentPlanId));
  // Mirrors the backend's checkout gate (pagarme-checkout/logic.ts + billing-checkout): a
  // past_due row, or a canceled-but-paid-through row, would still 409 a new checkout even
  // though hasActiveSub (above) is false for both. Only affects a card that canUpgradeTo would
  // otherwise have offered — active/trialing already suppress the CTA via hasActiveSub, so that
  // path stays exactly as it is today.
  const blocked = checkoutBlocked(subscription, new Date());
  // Switch mensal Stripe -> 12x (espelho do gate do backend; os dois mudam juntos).
  // planSource null/undefined (still loading, or unset) fails OPEN here on purpose — this
  // gate is UX only, the backend's own plan-writer guard (plan_source='manual' skips every
  // write) is the real enforcement. A comped workspace (plan_source='manual') never sees the
  // CTA, since the backend would 409 it after a full card entry.
  const canSwitch =
    switchEligible(subscription) &&
    !isInternalPlan(currentPlanId) &&
    planSource !== 'manual' &&
    planSource !== 'demo';
  const switchWindow =
    subscription?.provider === 'pagarme' &&
    subscription?.status === 'trialing' &&
    subscription?.switchScheduled === true;
  const switchPreviewDate = subscription?.current_period_end
    ? ceilPeriodEndToUtcDate(subscription.current_period_end)
    : null;
  const statusLabel = switchWindow
    ? t('cobrancaPage.status.switchScheduled')
    : subscription?.status === 'trialing'
      ? t('cobrancaPage.status.trialing')
      : subscription?.status === 'past_due'
        ? t('cobrancaPage.status.pastDue')
        : t('cobrancaPage.status.active');
  const periodLabel = switchWindow
    ? t('cobrancaPage.period.firstCharge')
    : subscription?.cancel_at_period_end
      ? t('cobrancaPage.period.cancels')
      : t('cobrancaPage.period.renews');

  /**
   * Starts the Stripe checkout for `planId` at the current `interval`. Shared by the Stripe
   * branch of `handleUpgrade` (month, or year on a non-gated plan) and the à vista escape
   * hatch (year on a gated plan, reached from the secondary "Assinar à vista" CTA or from
   * inside the Pagar.me dialog's `onPayUpfront`) so both callers cannot drift.
   */
  async function startStripeUpgrade(planId: string) {
    setBusy(planId);
    try {
      const url = await startCheckout(planId, interval, 'billing');
      captureCheckoutStarted(planId, interval, 'billing');
      window.location.assign(url);
    } catch (err) {
      toast.error(t('cobrancaPage.checkoutError', { message: (err as Error).message }));
      setBusy(null);
    }
  }

  async function handleUpgrade(planId: string) {
    const plan = plans?.find((p) => p.id === planId);
    if (interval === 'year' && isPagarme12xEnabled(plan)) {
      captureCheckoutStarted(planId, 'year', 'billing', 'pagarme');
      setPagarmeDialog({ mode: 'checkout', plan: plan ?? null });
      return;
    }
    await startStripeUpgrade(planId);
  }

  function handleSwitch(planId: string) {
    const plan = plans?.find((p) => p.id === planId);
    captureCheckoutStarted(planId, 'year', 'billing', 'pagarme');
    setPagarmeDialog({ mode: 'switch', plan: plan ?? null });
  }

  async function handleManage() {
    setBusy('portal');
    try {
      const url = await openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      toast.error(t('cobrancaPage.portalError', { message: (err as Error).message }));
      setBusy(null);
    }
  }

  async function handleCancelPagarmeSubscription() {
    setCancelling(true);
    try {
      const result = await cancelPagarmeSubscription();
      toast.success(
        result.status === 'reverted'
          ? t('cobrancaPage.switchReverted')
          : t('cobrancaPage.subscriptionCancelled'),
      );
      startPlanRefetchPoll();
      // Close only on success: a failure must leave the dialog open with the button
      // re-enabled so the user has an in-context retry instead of only a toast.
      setCancelDialogOpen(false);
    } catch (err) {
      // O 409 de consolidação (a fronteira cruzou durante o undo) muda o estado no
      // backend: mostra a mensagem e re-sincroniza.
      toast.error((err as Error).message);
      startPlanRefetchPoll();
    } finally {
      setCancelling(false);
    }
  }

  function renderCta(p: BillingPlan) {
    // Um assinante mensal ativo tem hasActiveSub true, então nenhum branch abaixo mostraria
    // CTA, inclusive o card do próprio plano atual, que sem este branch cairia direto em
    // "Plano atual" estático. Por isso o switch vem ANTES de tudo, inclusive do check de
    // plano atual.
    const switchable =
      canSwitch && interval === 'year' && isPagarme12xEnabled(p) && p.id !== 'free';
    if (switchable) {
      return (
        <>
          <button
            className="btn-primary"
            onClick={() => handleSwitch(p.id)}
            disabled={busy === p.id}
          >
            {busy === p.id
              ? t('shared.wait')
              : p.id === currentPlanId
                ? t('shared.switchToAnnual12x')
                : t('cobrancaPage.switchToPlan12x', { name: p.name })}
          </button>
          <p className="plan-cta__note">
            {switchPreviewDate
              ? t('cobrancaPage.switchFirstInstallmentOn', {
                  date: formatUtcDateBR(switchPreviewDate),
                })
              : t('cobrancaPage.switchNoChargeNow')}
          </p>
        </>
      );
    }
    // A demo has no subscription: its own plan is a first checkout, so it gets a CTA (below)
    // instead of the static label.
    if (p.id === currentPlanId && !isDemo) {
      return <span className="plan-cta__static">{t('shared.currentPlan')}</span>;
    }
    const upgradable = canUpgradeTo(p.id, currentPlanId, hasActiveSub, planSource);
    // Suppress a CTA the backend would 409 on: this only fires for the past_due /
    // canceled-but-paid-through cases hasActiveSub doesn't cover — hasActiveSub already
    // makes `upgradable` false for active/trialing, so that path never reaches here.
    if (upgradable && blocked) {
      return <p className="plan-cta__note">{t('cobrancaPage.blockedNote')}</p>;
    }
    if (upgradable) {
      // A demo always has wasDemo, so firstTime is false for it: the 'Assinar' label below
      // relies on that (the trial label would win otherwise).
      const firstTime = !hasUsedTrial(subscription, effectivePlan);
      // The à vista escape hatch only makes sense next to the 12x path itself: month plans and
      // non-gated year plans already charge price_brl_annual (or price_brl) directly via
      // startStripeUpgrade above, so this second CTA would just be a duplicate of the primary one.
      const showUpfront = interval === 'year' && isPagarme12xEnabled(p);
      return (
        <>
          <button
            className="btn-primary"
            onClick={() => handleUpgrade(p.id)}
            disabled={busy === p.id}
          >
            {busy === p.id
              ? t('shared.wait')
              : firstTime
                ? t('cobrancaPage.startTrial')
                : isDemo && p.id === currentPlanId
                  ? t('cobrancaPage.subscribe')
                  : t('cobrancaPage.upgrade')}
          </button>
          {showUpfront && (
            <button
              type="button"
              className="plan-cta__upfront"
              onClick={() => startStripeUpgrade(p.id)}
              disabled={busy === p.id}
            >
              {t('cobrancaPage.payUpfront')}
            </button>
          )}
        </>
      );
    }
    return null;
  }

  // Only relevant to the pagarme cancel dialog, so it's computed only when that dialog is
  // reachable at all (showPagarmeManage is also what gates the trigger button that opens it).
  // A malformed current_period_end must degrade to the no-date variant, not throw: formatDate's
  // own NaN guard doesn't apply here since this reads dd/MM/yyyy via formatUtcDateBR, so the
  // isFormattableDate check stands in for it.
  const cancelDialogDescription = !showPagarmeManage
    ? ''
    : switchWindow
      ? t('cobrancaPage.cancelDesc.switchWindow')
      : subscription?.status === 'trialing'
        ? t('cobrancaPage.cancelDesc.trialing')
        : subscription?.status === 'past_due'
          ? t('cobrancaPage.cancelDesc.pastDue')
          : subscription?.current_period_end && isFormattableDate(subscription.current_period_end)
            ? t('cobrancaPage.cancelDesc.untilDate', {
                date: formatUtcDateBR(subscription.current_period_end),
              })
            : t('cobrancaPage.cancelDesc.default');

  const demoNote = isDemo ? (
    <p className="billing-demo-note text-sm text-muted-foreground">
      {t('cobrancaPage.demoNote', { plan: currentPlan?.name ?? currentPlanId })}
    </p>
  ) : null;

  const planGrid = (
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
        : visiblePlans.map((p, i) => {
            const isYear = interval === 'year';
            // PRIMARY AMOUNT RULE: a gated year card's prominent price is the 12x's own
            // parcela (pagarme_installment_cents), never price_brl_annual / 12 — that
            // derivation would contradict the exact figure the checkout dialog charges.
            // Non-gated cards (or gate off) keep today's derivation unchanged.
            const gated = isYear && isPagarme12xEnabled(p);
            const monthly = gated
              ? (p.pagarme_installment_cents ?? 0)
              : isYear && p.price_brl_annual != null
                ? p.price_brl_annual / 12
                : p.price_brl;
            const isCurrent = p.id === currentPlanId;
            const isReco = p.id === RECOMMENDED_ID && !isCurrent;
            const isInternal = isInternalPlan(p.id);
            return (
              <div
                key={p.id}
                className={`plan-card${isCurrent ? ' is-current' : ''}${isReco ? ' is-recommended' : ''}${isInternal ? ' is-lifetime' : ''}`}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="plan-card__top">
                  <span className="plan-name">{p.name}</span>
                  {isCurrent ? (
                    <span className="plan-tag plan-tag--current">
                      {isInternal && <i className="ph ph-crown-simple" aria-hidden="true" />}
                      {t('shared.currentPlan')}
                    </span>
                  ) : isReco ? (
                    <span className="plan-tag plan-tag--reco">{t('cobrancaPage.recommended')}</span>
                  ) : null}
                </div>

                <div>
                  {!isInternal && isYear && monthly != null && monthly > 0 && (
                    <div className="plan-annual-lead">
                      {gated
                        ? t('cobrancaPage.annualLeadGated')
                        : t('cobrancaPage.annualLeadBilled')}
                    </div>
                  )}
                  <div className="plan-price">
                    {isInternal ? (
                      <span className="plan-price__note">{t('cobrancaPage.exclusivePlan')}</span>
                    ) : monthly != null && monthly > 0 ? (
                      <>
                        <span className="plan-price__amount">{formatBRL(monthly)}</span>
                        {!isYear && (
                          <span className="plan-price__period">{t('cobrancaPage.perMonth')}</span>
                        )}
                      </>
                    ) : (
                      <span className="plan-price__free">{t('cobrancaPage.free')}</span>
                    )}
                  </div>
                  {gated && p.price_brl_annual != null && p.price_brl_annual > 0 && (
                    <div className="plan-price__secondary">
                      {t('cobrancaPage.orUpfront', { price: formatBRL(p.price_brl_annual) })}
                    </div>
                  )}
                </div>

                <ul className="plan-features">
                  {planFeatures(p, t).map((f) => (
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
  );

  const checkoutDialog = (
    <PagarmeCheckoutDialog
      open={!!pagarmeDialog}
      mode={pagarmeDialog?.mode ?? 'checkout'}
      plan={
        pagarmeDialog?.plan
          ? {
              id: pagarmeDialog.plan.id,
              name: pagarmeDialog.plan.name,
              price_brl_annual: pagarmeDialog.plan.price_brl_annual ?? 0,
              pagarme_installment_cents: pagarmeDialog.plan.pagarme_installment_cents ?? 0,
            }
          : null
      }
      source="billing"
      trialEligible={!hasUsedTrial(subscription, effectivePlan)}
      firstChargeAt={switchPreviewDate}
      switchChangesPlan={pagarmeDialog?.plan ? pagarmeDialog.plan.id !== currentPlanId : false}
      onPayUpfront={
        // undefined no modo switch: a saída à vista abriria um checkout Stripe que 409a
        // com a assinatura ativa.
        pagarmeDialog?.plan && pagarmeDialog.mode === 'checkout'
          ? () => {
              const planId = pagarmeDialog.plan!.id;
              setPagarmeDialog(null);
              void startStripeUpgrade(planId);
            }
          : undefined
      }
      onClose={() => setPagarmeDialog(null)}
      onSuccess={startPlanRefetchPoll}
    />
  );

  if (isPhone) {
    const showCurrent = hasActiveSub || showPagarmeManage || showStripeManage;
    return (
      <CobrancaPhone
        showCurrent={showCurrent}
        planName={currentPlan?.name ?? currentPlanId}
        statusLabel={statusLabel}
        statusWarning={subscription?.status === 'past_due'}
        periodLabel={subscription?.current_period_end ? periodLabel : null}
        periodDate={
          subscription?.current_period_end
            ? formatPeriodEnd(subscription.current_period_end, subscription.provider)
            : ''
        }
        warning={
          (showPagarmeManage && subscription?.status === 'past_due') ||
          (!showPagarmeManage && showStripeManage)
            ? t('shared.cardChargeFailed')
            : null
        }
        showPagarmeManage={showPagarmeManage}
        switchWindow={switchWindow}
        portalBusy={busy === 'portal'}
        onUpdateCard={() => setPagarmeDialog({ mode: 'update-card', plan: null })}
        onOpenCancel={() => setCancelDialogOpen(true)}
        onManage={handleManage}
        cancelOpen={cancelDialogOpen}
        cancelDescription={cancelDialogDescription}
        cancelling={cancelling}
        onCancelDismiss={() => setCancelDialogOpen(false)}
        onCancelConfirm={() => {
          // The confirm sheet closes itself on a choice; clearing the open flag here
          // (instead of only on success, as the desktop dialog does) lets the row reopen
          // it for a retry after a failure. Same handler as the desktop confirm.
          setCancelDialogOpen(false);
          void handleCancelPagarmeSubscription();
        }}
        usage={<UsagePanel />}
        interval={interval}
        onIntervalChange={setInterval}
        annualSavingsPct={annualSavingsPct}
        firstTime={!hasUsedTrial(subscription, effectivePlan)}
        demoNote={demoNote}
        plans={planGrid}
        checkout={checkoutDialog}
      />
    );
  }

  return (
    <>
      {(hasActiveSub || showPagarmeManage || showStripeManage) && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="billing-current">
            <div>
              <span className="billing-current__label">{t('shared.yourPlan')}</span>
              <div className="billing-current__plan">
                <span className="billing-current__name">{currentPlan?.name ?? currentPlanId}</span>
                <span
                  className={`badge ${subscription?.status === 'past_due' ? 'badge-warning' : 'badge-success'}`}
                >
                  {statusLabel}
                </span>
              </div>
              {subscription?.current_period_end && (
                <div className="billing-current__meta">
                  {periodLabel}{' '}
                  {formatPeriodEnd(subscription.current_period_end, subscription.provider)}
                </div>
              )}
            </div>
            {showPagarmeManage ? (
              <div className="billing-current__actions">
                {subscription?.status === 'past_due' && (
                  <p className="billing-current__warning">{t('shared.cardChargeFailed')}</p>
                )}
                <div className="billing-current__action-row">
                  <button
                    className="btn-secondary"
                    onClick={() => setPagarmeDialog({ mode: 'update-card', plan: null })}
                  >
                    {t('shared.updateCard')}
                  </button>
                  <button className="btn-secondary" onClick={() => setCancelDialogOpen(true)}>
                    {switchWindow ? t('shared.undoSwitch') : t('shared.cancelSubscription')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="billing-current__actions">
                {showStripeManage && (
                  <p className="billing-current__warning">{t('shared.cardChargeFailed')}</p>
                )}
                <button
                  className="btn-secondary"
                  onClick={handleManage}
                  disabled={busy === 'portal'}
                >
                  <i className="ph ph-gear-six" aria-hidden="true" />
                  {busy === 'portal' ? t('shared.wait') : t('shared.manageSubscription')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <UsagePanel />

      <div className="billing-toolbar">
        <div className="billing-toggle" role="group" aria-label={t('shared.billingPeriod')}>
          <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            {t('shared.monthly')}
          </button>
          <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            {t('shared.annual')}
          </button>
        </div>
        {annualSavingsPct > 0 && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            {t('shared.annualSavings', { pct: annualSavingsPct })}
          </span>
        )}
        {!hasUsedTrial(subscription, effectivePlan) && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            {t('shared.firstDaysFree')}
          </span>
        )}
      </div>

      {demoNote}

      {planGrid}

      {checkoutDialog}

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('shared.cancelSubscription')}</AlertDialogTitle>
            <AlertDialogDescription>{cancelDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>
              {t('shared.keepSubscription')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // AlertDialogAction is Radix's DialogPrimitive.Close under the hood: without
                // preventDefault it closes synchronously on click, before the request below
                // ever resolves, making `cancelling` dead code and leaving a failed cancel
                // with no in-context retry. The dialog now closes itself, deliberately, only
                // from inside handleCancelPagarmeSubscription's success path.
                e.preventDefault();
                void handleCancelPagarmeSubscription();
              }}
              disabled={cancelling}
            >
              {cancelling ? t('shared.cancelling') : t('shared.confirmCancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
