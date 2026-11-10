import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HubAccountState } from '../../types';

export function AccountStatusPill({ state }: { state: HubAccountState }) {
  const { t } = useTranslation('hubHome');
  if (state === 'needs_reconnect') {
    return (
      <span className="hub-pill hub-pill-danger shrink-0">
        <TriangleAlert size={12} strokeWidth={2.25} aria-hidden="true" />
        {t('accounts.status.needsReconnect', 'Reconexão necessária')}
      </span>
    );
  }
  return (
    <span className="hub-pill hub-pill-neutral shrink-0">
      <span
        aria-hidden="true"
        className="inline-block w-[7px] h-[7px] rounded-full bg-[var(--hub-tx2)]"
      />
      {t('accounts.status.connected', 'Conectada')}
    </span>
  );
}
