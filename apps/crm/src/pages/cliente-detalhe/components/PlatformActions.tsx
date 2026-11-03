import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export type AnalyticsPlatform = 'instagram' | 'tiktok' | 'youtube' | 'google';

/**
 * "Sincronizar Dados" + "Desconectar" for a platform card in the Redes sociais tab, the same
 * labeled buttons the Instagram and TikTok cards render (`.btn-instagram-action`). Each icon
 * swaps to a spinner while its request runs.
 */
export function PlatformActions({
  onSync,
  syncing,
  onDisconnect,
  disconnecting = false,
  syncDisabled = false,
}: {
  onSync: () => void;
  syncing: boolean;
  onDisconnect: () => void;
  disconnecting?: boolean;
  syncDisabled?: boolean;
}) {
  const { t } = useTranslation('clients');
  const busy = syncing || disconnecting;
  return (
    <div className="instagram-overview__actions">
      <button
        type="button"
        className="btn-instagram-action"
        onClick={onSync}
        disabled={busy || syncDisabled}
      >
        <i
          className={syncing ? 'ph ph-spinner ph-spin' : 'ph ph-arrows-clockwise'}
          aria-hidden="true"
        />
        <span>{t('instagram.syncTooltip')}</span>
      </button>
      <button
        type="button"
        className="btn-instagram-action btn-instagram-action--danger"
        onClick={onDisconnect}
        disabled={busy}
      >
        <i className={disconnecting ? 'ph ph-spinner ph-spin' : 'ph ph-plugs'} aria-hidden="true" />
        <span>{t('instagram.disconnectTooltip')}</span>
      </button>
    </div>
  );
}

/**
 * "Ver analytics completo" under a connected platform card: a centered button on desktop, a
 * grouped-list cell on a phone (as the Instagram card has), to that platform's analytics tab.
 */
export function FullAnalyticsLink({
  clienteId,
  platform,
}: {
  clienteId: number;
  platform: AnalyticsPlatform;
}) {
  const { t } = useTranslation('clients');
  const navigate = useNavigate();
  const isPhone = !useIsDesktop(768);
  const go = () => navigate(`/analytics/${clienteId}/${platform}`);
  const label = t('detail.viewFullAnalytics');

  if (isPhone) {
    return (
      <GroupedList aria-label={label} className="phone-cli-wrap">
        <Cell label={label.replace(/\s*→\s*$/, '')} onClick={go} />
      </GroupedList>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
      <Button onClick={go}>{label}</Button>
    </div>
  );
}
