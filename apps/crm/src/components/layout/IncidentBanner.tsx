import { useState } from 'react';

/**
 * Hardcoded incident banner, deliberately not a global_banners row: the
 * incident it announces (2026-09-02, "Não foi possível confirmar seu acesso"
 * on every page while the frontend queried role_id/workspace_roles ahead of
 * the migration) broke the very session hydration a DB-driven banner would
 * ride on, and there is no admin-side path to seed one during an outage.
 * Shipping it in the bundle guarantees it renders for exactly the users who
 * got the fixed bundle.
 *
 * Retire it in a follow-up by flipping INCIDENT_BANNER_ACTIVE to false (or
 * deleting the component + its AppLayout mount) once the incident window is
 * over.
 */
export const INCIDENT_BANNER_ACTIVE = false;

const INCIDENT_ID = 'workspace-access-2026-09-02';
const STORAGE_KEY = `incident-banner-dismissed:${INCIDENT_ID}`;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage can throw (private mode, blocked site data) — show the banner.
    return false;
  }
}

export function IncidentBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!INCIDENT_BANNER_ACTIVE || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Best-effort persistence; the in-memory state already hides it.
    }
  };

  return (
    <div
      role="status"
      className="banner-bar"
      style={{
        background: 'rgba(245, 163, 66, 0.22)',
        borderBottom: '1px solid rgba(245, 163, 66, 0.35)',
        color: 'var(--text-main)',
      }}
    >
      <div className="banner-content">
        <strong>Instabilidade no acesso ao workspace:</strong> alguns usuários viram o erro
        {' "Não foi possível confirmar seu acesso". '}A correção já está no ar — se o erro aparecer,
        recarregue a página.
      </div>
      <button className="banner-dismiss" onClick={dismiss} aria-label="Dispensar aviso">
        ×
      </button>
    </div>
  );
}
