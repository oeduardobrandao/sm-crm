import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { GroupedList } from '@/components/mobile/GroupedList';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useAuth } from '../../../context/AuthContext';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import {
  GOOGLE_ACCOUNTS_QUERY_KEY,
  listGoogleAccounts,
  type GoogleAccount,
} from '../../../services/google';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../phone/ConfigPhoneScreen';
import { GoogleAccountCard } from './contas-conectadas/GoogleAccountCard';
import { GoogleAccountDisconnectDialog } from './contas-conectadas/GoogleAccountDisconnectDialog';
import './phone/contasConectadasPhone.css';

/**
 * Configurações > Contas conectadas: the workspace's Google accounts (shared by YouTube and
 * Google Meu Negócio), what each one feeds, and "Desconectar conta". Reachable by URL with
 * both product flags off (a downgraded workspace can still remove access); the nav lists it
 * only with a flag on (configTabs `visibleConfigTabs`). Laid out per provider so Instagram
 * and TikTok can join later.
 */
export default function ContasConectadasTab() {
  const { t } = useTranslation('settings');
  const { can } = useAuth();
  const { features } = useWorkspaceLimits();
  const isPhone = !useIsDesktop(768);
  const canDisconnect = can('configuracoes', 'editar') === true;
  // The client-tab connect buttons only exist while a product flag is on.
  const canConnectFromClients =
    features?.feature_youtube === true || features?.feature_google_business === true;

  // `target` outlives `open` so the dialog keeps its content while it animates closed.
  const [target, setTarget] = useState<GoogleAccount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    data: accounts,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: GOOGLE_ACCOUNTS_QUERY_KEY,
    queryFn: listGoogleAccounts,
    staleTime: 30_000,
  });

  const openDisconnect = (account: GoogleAccount) => {
    setTarget(account);
    setDialogOpen(true);
  };

  const layout: 'phone' | 'desktop' = isPhone ? 'phone' : 'desktop';
  const list = accounts ?? [];

  const emptyCopy = canConnectFromClients
    ? `${t('connectedAccounts.empty')} ${t('connectedAccounts.emptyConnect')}`
    : t('connectedAccounts.empty');

  const errorState = (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
      <span style={{ color: 'var(--danger-text)' }}>{t('connectedAccounts.loadError')}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void refetch()}
        disabled={isRefetching}
      >
        {t('connectedAccounts.retry')}
      </Button>
    </div>
  );

  const card = (account: GoogleAccount) => (
    <GoogleAccountCard
      key={account.id}
      account={account}
      layout={layout}
      canDisconnect={canDisconnect}
      onDisconnect={openDisconnect}
    />
  );

  const dialog = (
    <GoogleAccountDisconnectDialog
      account={target}
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
    />
  );

  if (isPhone) {
    return (
      <ConfigPhoneScreen
        title={t('connectedAccounts.title')}
        subtitle={t('connectedAccounts.subtitle')}
      >
        {isLoading ? (
          <ConfigPhoneSkeleton groups={1} rows={2} />
        ) : (
          <GroupedList header={t('connectedAccounts.googleHeading')}>
            {isError ? (
              <li className="phone-config-block">{errorState}</li>
            ) : list.length === 0 ? (
              <li className="phone-config-block">{emptyCopy}</li>
            ) : (
              list.map((account) => (
                <li key={account.id} className="connected-account-cell">
                  {card(account)}
                </li>
              ))
            )}
          </GroupedList>
        )}
        {dialog}
      </ConfigPhoneScreen>
    );
  }

  return (
    <div>
      <section className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('connectedAccounts.title')}</h3>
        <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t('connectedAccounts.subtitle')}
        </p>

        <h4 className="m-0 mb-3 text-sm font-semibold">{t('connectedAccounts.googleHeading')}</h4>

        {isLoading ? (
          <SkeletonStatus className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border p-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </SkeletonStatus>
        ) : isError ? (
          errorState
        ) : list.length === 0 ? (
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            {emptyCopy}
          </p>
        ) : (
          <div className="flex flex-col gap-3">{list.map(card)}</div>
        )}
      </section>
      {dialog}
    </div>
  );
}
