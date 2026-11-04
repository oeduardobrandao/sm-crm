import { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { AuthContext } from '../../../context/AuthContext';
import { canAccessConfigTab } from '../../configuracao/configTabs';

export type AnalyticsPlatform = 'instagram' | 'tiktok' | 'youtube' | 'google';

/**
 * "Sincronizar Dados" + "Desconectar" for a platform card in the Redes sociais tab, the same
 * labeled buttons the Instagram and TikTok cards render (`.btn-instagram-action`). Each icon
 * swaps to a spinner while its request runs. `disconnectLabel` overrides "Desconectar" (the
 * Google cards say "Desconectar deste cliente", next to the account-level disconnect).
 */
export function PlatformActions({
  onSync,
  syncing,
  onDisconnect,
  disconnecting = false,
  syncDisabled = false,
  disconnectLabel,
}: {
  onSync: () => void;
  syncing: boolean;
  onDisconnect: () => void;
  disconnecting?: boolean;
  syncDisabled?: boolean;
  disconnectLabel?: string;
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
        <span>{disconnectLabel ?? t('instagram.disconnectTooltip')}</span>
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

/**
 * "Gerenciar contas" after a Google card's "Conta Google: ..." line, to Configurações >
 * Contas conectadas. Shown only to who can open that tab (`configuracoes:ver`). Reads the
 * context directly so the card still renders (without the link) outside an AuthProvider.
 */
export function ManageGoogleAccountsLink() {
  const { t } = useTranslation('clients');
  const auth = useContext(AuthContext);
  if (!auth || !canAccessConfigTab('contas-conectadas', auth.can, auth.workspaceRole)) return null;
  return (
    <Link to="/configuracao/contas-conectadas" style={{ fontSize: '0.8125rem' }}>
      {t('google.manageAccounts')}
    </Link>
  );
}
