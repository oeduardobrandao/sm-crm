import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Muted line a member restricted to assigned clients sees on /clientes. The list itself is
 * already filtered by the server (RLS); this only says why it may be short.
 */
export function ClientScopeNotice({ className }: { className?: string }) {
  const { t } = useTranslation('clients');
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        color: 'var(--text-muted)',
      }}
    >
      <Lock aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0 }} />
      {t('scopedNotice')}
    </span>
  );
}
