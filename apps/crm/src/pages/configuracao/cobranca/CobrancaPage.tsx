import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  getEffectivePlanId,
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
import { UsagePanel } from './UsagePanel';
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
  const { role, workspaceRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [pagarmeDialog, setPagarmeDialog] = useState<{
    mode: 'checkout' | 'update-card';
    plan: BillingPlan | null;
  } | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
  // that have no Stripe subscription and would otherwise read as Free.
  const { data: effectivePlanId, refetch: refetchEffectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan'],
    queryFn: getEffectivePlanId,
    enabled: isOwner,
  });

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
      toast.success('Pagamento confirmado! Atualizando seu plano…');
      const id = startPlanRefetchPoll();
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
      <div className="card">
        <p style={{ color: 'var(--text-muted)' }}>
          Apenas o proprietário da conta pode gerenciar a assinatura.
        </p>
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
      toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
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

  async function handleCancelPagarmeSubscription() {
    setCancelling(true);
    try {
      await cancelPagarmeSubscription();
      toast.success('Assinatura cancelada.');
      startPlanRefetchPoll();
      // Close only on success: a failure must leave the dialog open with the button
      // re-enabled so the user has an in-context retry instead of only a toast.
      setCancelDialogOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  function renderCta(p: BillingPlan) {
    if (p.id === currentPlanId) {
      return <span className="plan-cta__static">Plano atual</span>;
    }
    const upgradable = canUpgradeTo(p.id, currentPlanId, hasActiveSub);
    // Suppress a CTA the backend would 409 on: this only fires for the past_due /
    // canceled-but-paid-through cases hasActiveSub doesn't cover — hasActiveSub already
    // makes `upgradable` false for active/trialing, so that path never reaches here.
    if (upgradable && blocked) {
      return (
        <p className="plan-cta__note">
          Cancele ou aguarde o fim do período atual para trocar de plano.
        </p>
      );
    }
    if (upgradable) {
      const firstTime = !subscription?.hasEverSubscribed;
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
            {busy === p.id ? 'Aguarde…' : firstTime ? 'Começar teste de 30 dias' : 'Fazer upgrade'}
          </button>
          {showUpfront && (
            <button
              type="button"
              className="plan-cta__upfront"
              onClick={() => startStripeUpgrade(p.id)}
              disabled={busy === p.id}
            >
              Assinar à vista
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
    : subscription?.status === 'trialing'
      ? 'Sua assinatura será cancelada agora, sem cobrança.'
      : subscription?.status === 'past_due'
        ? 'Sua assinatura será cancelada agora.'
        : subscription?.current_period_end && isFormattableDate(subscription.current_period_end)
          ? `Seu acesso continua até ${formatUtcDateBR(subscription.current_period_end)}. Depois disso, o workspace volta ao plano gratuito.`
          : 'Sua assinatura será cancelada.';

  return (
    <>
      {(hasActiveSub || showPagarmeManage || showStripeManage) && (
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
                  {formatPeriodEnd(subscription.current_period_end, subscription.provider)}
                </div>
              )}
            </div>
            {showPagarmeManage ? (
              <div className="billing-current__actions">
                {subscription?.status === 'past_due' && (
                  <p className="billing-current__warning">
                    Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.
                  </p>
                )}
                <div className="billing-current__action-row">
                  <button
                    className="btn-secondary"
                    onClick={() => setPagarmeDialog({ mode: 'update-card', plan: null })}
                  >
                    Atualizar cartão
                  </button>
                  <button className="btn-secondary" onClick={() => setCancelDialogOpen(true)}>
                    Cancelar assinatura
                  </button>
                </div>
              </div>
            ) : (
              <div className="billing-current__actions">
                {showStripeManage && (
                  <p className="billing-current__warning">
                    Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.
                  </p>
                )}
                <button
                  className="btn-secondary"
                  onClick={handleManage}
                  disabled={busy === 'portal'}
                >
                  <i className="ph ph-gear-six" aria-hidden="true" />
                  {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <UsagePanel />

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
        {!subscription?.hasEverSubscribed && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            Seus primeiros 30 dias são grátis
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
                        Plano atual
                      </span>
                    ) : isReco ? (
                      <span className="plan-tag plan-tag--reco">Recomendado</span>
                    ) : null}
                  </div>

                  <div>
                    {!isInternal && isYear && monthly != null && monthly > 0 && (
                      <div className="plan-annual-lead">
                        {gated ? 'em 12x de' : 'cobrado anualmente,'}
                      </div>
                    )}
                    <div className="plan-price">
                      {isInternal ? (
                        <span className="plan-price__note">Plano exclusivo</span>
                      ) : monthly != null && monthly > 0 ? (
                        <>
                          <span className="plan-price__amount">{formatBRL(monthly)}</span>
                          {!isYear && <span className="plan-price__period">/mês</span>}
                        </>
                      ) : (
                        <span className="plan-price__free">Grátis</span>
                      )}
                    </div>
                    {gated && p.price_brl_annual != null && p.price_brl_annual > 0 && (
                      <div className="plan-price__secondary">
                        {`ou ${formatBRL(p.price_brl_annual)} à vista`}
                      </div>
                    )}
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
        trialEligible={!subscription?.hasEverSubscribed}
        onPayUpfront={
          pagarmeDialog?.plan
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

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar assinatura</AlertDialogTitle>
            <AlertDialogDescription>{cancelDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Manter assinatura</AlertDialogCancel>
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
              {cancelling ? 'Cancelando…' : 'Sim, cancelar assinatura'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
