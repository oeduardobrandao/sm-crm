import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHubLook } from '../../hooks/useHubLook';
import type { HubAccountState } from '../../types';
import { StatusPill } from '../StatusPill';

export function AccountStatusPill({ state }: { state: HubAccountState }) {
  const { t } = useTranslation('hubHome');
  const look = useHubLook();
  const reconnect = state === 'needs_reconnect';
  const label = reconnect
    ? t('accounts.status.needsReconnect', 'Reconexão necessária')
    : t('accounts.status.connected', 'Conectada');

  // Pauta draws its own dot on every pill (::before): add no marker of ours there.
  if (look === 'pauta') {
    return (
      <span className="shrink-0">
        <StatusPill tone={reconnect ? 'danger' : 'neutral'} semantic={reconnect ? 'fix' : 'ok'}>
          {label}
        </StatusPill>
      </span>
    );
  }

  if (reconnect) {
    return (
      <span className="hub-pill hub-pill-danger shrink-0">
        <TriangleAlert size={12} strokeWidth={2.25} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span className="hub-pill hub-pill-neutral shrink-0">
      <span
        aria-hidden="true"
        className="inline-block w-[7px] h-[7px] rounded-full bg-[var(--hub-st-ok-fg)]"
      />
      {label}
    </span>
  );
}
