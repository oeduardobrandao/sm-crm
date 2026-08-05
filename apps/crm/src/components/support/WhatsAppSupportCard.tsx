import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isWhatsAppSupportEnabled } from '@/lib/whatsapp';
import { WhatsAppSupportButton } from './WhatsAppSupportButton';

/**
 * Dismissal is permanent here, unlike TrialNudgeCard's 7-day window: any valid
 * ISO date means dismissed, however old. A present-but-unparseable value counts
 * as never dismissed, because a corrupt entry should fail toward showing the
 * card rather than hiding it forever.
 */
function isDismissed(raw: string | null): boolean {
  if (!raw) return false;
  return !Number.isNaN(new Date(raw).getTime());
}

/**
 * Shown to every owner until dismissed, so the copy must read correctly at any
 * account age. Nothing here assumes a new account.
 */
export function WhatsAppSupportCard() {
  const { role, workspaceRole, profile } = useAuth();
  // Follow the ACTIVE workspace role, not the stale profile-level role: a user
  // can be owner in one workspace and agent in another. Mirrors TrialNudgeCard.
  const isOwner = (workspaceRole ?? role) === 'owner';
  const storageKey = `whatsapp_support_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() => isDismissed(localStorage.getItem(storageKey)));

  // Checked here as well as in the button: without it the card would render its
  // title and body with no CTA.
  if (!isOwner || dismissed || !isWhatsAppSupportEnabled()) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div className="card whatsapp-support">
      <MessageCircle size={22} aria-hidden="true" className="whatsapp-support__icon" />
      <div className="whatsapp-support__body">
        <p className="whatsapp-support__title">Fale com a gente no WhatsApp</p>
        <p className="whatsapp-support__text">
          Dúvida, ideia ou problema? A gente responde por lá, sem robô no meio.
        </p>
      </div>
      <WhatsAppSupportButton
        context="dashboard"
        label="Abrir WhatsApp"
        className="btn-primary whatsapp-support__cta"
      />
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fechar aviso"
        className="whatsapp-support__close"
      >
        <X size={16} />
      </button>
    </div>
  );
}
