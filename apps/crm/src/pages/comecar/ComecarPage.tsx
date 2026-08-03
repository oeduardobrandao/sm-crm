import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getWorkspaceSubscription,
  listActivePlans,
  startCheckout,
  type BillingInterval,
  type BillingPlan,
} from '@/services/billing';
import { isSelectableTrialPlan } from '@/pages/configuracao/cobranca/plan-display';
import { captureEvent } from '@/lib/analytics';
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
import { parsePlanIntent } from './plan-intent';
import './comecar.css';

const RECOMMENDED_ID = 'pro';

/** plans.price_brl is stored in centavos (e.g. 9990 = R$ 99,90). */
function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function planHighlights(p: BillingPlan): string[] {
  const out: string[] = [];
  out.push(p.max_clients == null ? 'Clientes ilimitados' : `${p.max_clients} clientes`);
  out.push(p.max_team_members == null ? 'Usuários ilimitados' : `${p.max_team_members} usuários`);
  if (p.feature_hub_portal) out.push('Portal de aprovação do cliente');
  return out;
}

/**
 * Starts a Stripe Checkout session and redirects to it. Shared by the
 * auto-checkout effect and the manual "Começar teste" button so the two
 * paths cannot drift. Returns whether it succeeded; the caller resets its
 * own local state (the intent or the busy flag) on failure.
 */
async function startAndRedirect(planId: string, interval: BillingInterval): Promise<boolean> {
  try {
    const url = await startCheckout(planId, interval, 'onboarding');
    captureCheckoutStarted(planId, interval, 'onboarding');
    window.location.assign(url);
    return true;
  } catch (err) {
    toast.error('Não foi possível abrir o checkout: ' + (err as Error).message);
    return false;
  }
}

export default function ComecarPage() {
  const { role, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntent] = useState(() => parsePlanIntent(location.search));
  // Latches so the auto-checkout and the view event fire once per mount. React's
  // double-invoke in development would otherwise open two Stripe sessions.
  const autoStarted = useRef(false);
  const viewLogged = useRef(false);

  const isOwner = role === 'owner';

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

  // Hooks cannot sit behind the early returns below, so the effects re-check
  // readiness themselves. `ready` is what keeps them from firing against
  // undefined data mid-load.
  const ready = !authLoading && isOwner && !subLoading && !plansLoading;
  const hasError = subError || plansError;
  // A failed subscription query must never read as "never subscribed" - that
  // would let a workspace that already subscribed reopen a trial checkout.
  // `eligible` stays false while either query has errored.
  const eligible = ready && !hasError && subscription?.hasEverSubscribed !== true;

  useEffect(() => {
    if (!eligible || viewLogged.current) return;
    viewLogged.current = true;
    captureEvent('trial_step_viewed', { has_intent: Boolean(intent) });
  }, [eligible, intent]);

  useEffect(() => {
    if (!eligible || !intent || autoStarted.current) return;
    autoStarted.current = true;
    void (async () => {
      const ok = await startAndRedirect(intent.planId, intent.interval);
      if (!ok) setIntent(null);
    })();
  }, [eligible, intent]);

  if (authLoading || (isOwner && (subLoading || plansLoading))) {
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
          <h1>Não foi possível carregar seu plano</h1>
          <p>Tivemos um problema ao buscar as informações da sua assinatura.</p>
          <button
            type="button"
            className="comecar-cta"
            onClick={() => {
              void refetchSubscription();
              void refetchPlans();
            }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (subscription?.hasEverSubscribed) return <Navigate to="/dashboard" replace />;

  const intentPlan = intent ? plans?.find((p) => p.id === intent.planId) : undefined;
  if (intent) {
    return (
      <div className="comecar-shell comecar-shell--center">
        <div className="comecar-standby">
          <Loader2 className="comecar-spin" size={24} aria-hidden="true" />
          <h1>Preparando seu teste do plano {intentPlan?.name ?? intent.planId}</h1>
          <p>Levamos você ao pagamento seguro do Stripe. Nada é cobrado nos próximos 30 dias.</p>
          <button type="button" className="comecar-link" onClick={() => setIntent(null)}>
            Escolher outro plano
          </button>
        </div>
      </div>
    );
  }

  const selectable = (plans ?? []).filter(isSelectableTrialPlan);

  async function handleStart(planId: string) {
    setBusy(planId);
    const ok = await startAndRedirect(planId, interval);
    if (!ok) setBusy(null);
  }

  function handleSkip() {
    captureEvent('trial_skipped');
    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="comecar-shell">
      <div className="comecar-inner">
        <header className="comecar-head">
          <h1>Comece com 30 dias grátis</h1>
          <p>
            Escolha o plano do seu teste. Você só é cobrado depois de 30 dias e pode cancelar quando
            quiser.
          </p>
        </header>

        <div className="comecar-toggle" role="group" aria-label="Período de cobrança">
          <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            Mensal
          </button>
          <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            Anual
          </button>
        </div>

        <div className="comecar-grid">
          {selectable.map((p) => {
            const isYear = interval === 'year';
            const monthly =
              isYear && p.price_brl_annual != null ? p.price_brl_annual / 12 : p.price_brl;
            return (
              <div
                key={p.id}
                className={`comecar-card${p.id === RECOMMENDED_ID ? ' is-recommended' : ''}`}
              >
                <div className="comecar-card__top">
                  <span className="comecar-card__name">{p.name}</span>
                  {p.id === RECOMMENDED_ID && <span className="comecar-tag">Recomendado</span>}
                </div>
                <p className="comecar-card__trial">30 dias grátis</p>
                <p className="comecar-card__price">
                  depois {monthly != null ? `${formatBRL(monthly)}/mês` : 'Sob consulta'}
                </p>
                <ul className="comecar-card__features">
                  {planHighlights(p).map((f) => (
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
                  disabled={busy !== null}
                >
                  {busy === p.id ? 'Aguarde…' : 'Começar teste'}
                </button>
              </div>
            );
          })}
        </div>

        <footer className="comecar-foot">
          <p>Pedimos o cartão agora, mas nada é cobrado nos primeiros 30 dias.</p>
          <button type="button" className="comecar-link" onClick={handleSkip}>
            Prefiro continuar no plano Free por enquanto
          </button>
        </footer>
      </div>
    </div>
  );
}
