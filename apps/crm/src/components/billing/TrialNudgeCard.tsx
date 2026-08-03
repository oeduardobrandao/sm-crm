import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Timer, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanId, getWorkspaceSubscription } from '@/services/billing';
import { captureEvent } from '@/lib/analytics';

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
  const { role, profile } = useAuth();
  const isOwner = role === 'owner';
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
  if (planId !== 'free') return null;
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
