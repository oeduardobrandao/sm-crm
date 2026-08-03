import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Timer, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanId, getWorkspaceSubscription } from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { resolveCurrentPlanId } from '@/pages/configuracao/cobranca/plan-display';

const DISMISS_DAYS = 7;

/**
 * True when the stored dismissal is still inside its window. A missing or
 * unparseable value counts as "never dismissed" — a corrupt entry should fail
 * toward showing the card, not toward hiding it forever.
 */
function isDismissalActive(raw: string | null): boolean {
  if (!raw) return false;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < DISMISS_DAYS * 86_400_000;
}

export function TrialNudgeCard() {
  const { role, workspaceRole, profile } = useAuth();
  // Follow the ACTIVE workspace role, not the stale profile-level role — a user
  // can be owner in one workspace and agent in another (see DashboardPage).
  const isOwner = (workspaceRole ?? role) === 'owner';
  const storageKey = `trial_nudge_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() =>
    isDismissalActive(localStorage.getItem(storageKey)),
  );

  const { data: planId } = useQuery({
    queryKey: ['billing', 'effective-plan'],
    queryFn: getEffectivePlanId,
    enabled: isOwner && !dismissed,
  });
  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner && !dismissed,
  });

  if (!isOwner || dismissed) return null;
  // Wait for both answers before deciding: rendering on partial data would flash
  // the card at a paying customer.
  if (planId === undefined || subscription === undefined) return null;
  // A brand-new workspace has workspaces.plan_id = NULL (handle_new_user never
  // sets it and there's no DB default), so the raw effective plan id must not be
  // compared directly against 'free' — that would hide the card from its entire
  // audience. Resolve it the same way CobrancaPage does.
  const currentPlanId = resolveCurrentPlanId(planId, subscription?.plan_id);
  if (currentPlanId !== 'free') return null;
  if (subscription?.hasEverSubscribed) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div className="card trial-nudge">
      <Timer size={22} aria-hidden="true" className="trial-nudge__icon" />
      <div className="trial-nudge__body">
        <p className="trial-nudge__title">Seus 30 dias grátis ainda estão disponíveis</p>
        <p className="trial-nudge__text">
          Você está no plano Free. Ative o teste para liberar relatórios, portal do cliente e
          agendamento.
        </p>
      </div>
      <Link
        to="/comecar"
        className="btn-primary trial-nudge__cta"
        onClick={() => captureEvent('trial_nudge_clicked')}
      >
        Ativar teste
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fechar aviso"
        className="trial-nudge__close"
      >
        <X size={16} />
      </button>
    </div>
  );
}
