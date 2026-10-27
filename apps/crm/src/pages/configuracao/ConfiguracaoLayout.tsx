import { Fragment, useEffect } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { UserX, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { useAuth } from '../../context/AuthContext';
import { visibleConfigTabs, canAccessConfigTab, CONFIG_TABS } from './configTabs';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from './phone/ConfigPhoneScreen';

/**
 * Shell for /configuracao/*: page title plus the tab strip, with each tab a real
 * route so a tab is deep-linkable and survives a refresh.
 *
 * Phones (below 768px) get no strip and no card: `/configuracao` is the Settings list
 * (ConfiguracaoIndex) and each tab is a pushed screen that renders its own nav bar
 * (ConfigPhoneScreen), so the layout only keeps the guards.
 */
export default function ConfiguracaoLayout() {
  const { t } = useTranslation('settings');
  const { user, workspaceRole, membershipResolved, can, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPhone = !useIsDesktop(768);
  // Held for the whole section, so the shell's bell bar doesn't flash between one
  // tab's nav bar unmounting and the next lazy tab mounting its own.
  usePhoneChrome({ pageHeader: isPhone });
  // Desktop Vidro toolbar: the layout registers for every tab under it (tabs never do).
  const inToolbar = usePageToolbar({ title: t('nav.configuracoes') });
  const current = pathname.replace(/^\/configuracao\/?/, '').split('/')[0];

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [loading, user, navigate]);

  // Wait for the session/profile before deciding anything: rendering the
  // strip early would flash the agent-sized set of tabs at an owner, and the
  // guard below would bounce them off a tab they are allowed to see.
  if (loading || !user) {
    if (isPhone) {
      // Which tabs exist depends on the role that is still loading; the screen's own
      // title doesn't, so a tab's silhouette already carries it.
      const tabLabelKey = CONFIG_TABS.find((tab) => tab.path === current)?.labelKey;
      return (
        <div className="config-phone">
          {tabLabelKey ? (
            <ConfigPhoneScreen title={t(tabLabelKey)}>
              <ConfigPhoneSkeleton />
            </ConfigPhoneScreen>
          ) : (
            <>
              <PhonePageHeader title={t('nav.configuracoes')} />
              <ConfigPhoneSkeleton groups={3} />
            </>
          )}
        </div>
      );
    }
    // The shell's silhouette (title, section nav, content), drawn with its own classes so
    // it lands where the real shell will. The nav is plain bars on purpose: which tabs
    // exist depends on the role that is still loading.
    return (
      <div className="page-content config-page">
        <SkeletonStatus className="config-shell">
          {!inToolbar && (
            <div className="config-shell-header">
              <Skeleton className="h-7 w-44" />
            </div>
          )}
          <div className="config-shell-body">
            <div className="config-nav">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-7 w-[140px] shrink-0" />
              ))}
            </div>
            <div className="config-shell-content flex flex-col gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full max-w-md" />
              <Skeleton className="h-10 w-full max-w-md" />
              <Skeleton className="h-10 w-full max-w-md" />
            </div>
          </div>
        </SkeletonStatus>
      </div>
    );
  }

  // `workspaceRole` is null here in two DIFFERENT real cases, and
  // `membershipResolved` (see AuthContext.tsx) is what tells them apart:
  //
  //   - membershipResolved === true: the membership lookup RESOLVED (loading
  //     is already false, and that flag only flips once the lookup has
  //     settled) and genuinely found no row for the active workspace. Live
  //     revocation produces this mid-session too, when the caller is removed
  //     from the workspace. This is the only case that should ever show the
  //     definitive "removed" copy below.
  //   - membershipResolved === 'error' (or, defensively, anything other than
  //     `true`): the lookup THREW -- a network/RLS blip, not a resolved
  //     answer. Showing the "removed" card here would tell a real member
  //     they've been kicked out over a transient error. Gating the skeleton
  //     above on `workspaceRole === null` instead of `loading` -- as this
  //     used to -- left a removed user stuck loading forever with no explanation,
  //     since nothing was ever going to make workspaceRole non-null again;
  //     so this branch must render SOMETHING, just not the definitive claim.
  if (workspaceRole === null && membershipResolved === true) {
    return (
      <div className="page-content">
        {isPhone && <PhonePageHeader title={t('nav.configuracoes')} />}
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <UserX size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>{t('layout.removedTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {t('layout.removedBody')}
          </p>
        </div>
      </div>
    );
  }

  if (workspaceRole === null) {
    return (
      <div className="page-content">
        {isPhone && <PhonePageHeader title={t('nav.configuracoes')} />}
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <AlertTriangle size={40} style={{ color: 'var(--warning)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>{t('layout.errorTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            {t('layout.errorBody')}
          </p>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            {t('layout.retry')}
          </button>
        </div>
      </div>
    );
  }

  const tabs = visibleConfigTabs(can, workspaceRole);

  if (current && !canAccessConfigTab(current, can, workspaceRole)) {
    return <Navigate to="/configuracao/perfil" replace />;
  }

  if (isPhone) {
    return (
      <div className="config-phone">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="page-content config-page">
      <div className="config-shell">
        {!inToolbar && (
          <header className="config-shell-header">
            <h1>{t('nav.configuracoes')}</h1>
          </header>
        )}

        <div className={`config-shell-body${tabs.length > 1 ? '' : ' config-shell-body--single'}`}>
          {/* A single visible tab is not a choice — don't render a nav for it. */}
          {tabs.length > 1 && (
            <nav className="config-nav" aria-label={t('layout.navAria')}>
              {tabs.map((tab, i) => {
                const Icon = tab.icon;
                const startsGroup = i === 0 || tabs[i - 1].group !== tab.group;
                return (
                  <Fragment key={tab.path}>
                    {startsGroup && (
                      <span className="config-nav-label">{t(`tabs.groups.${tab.group}`)}</span>
                    )}
                    <NavLink
                      to={tab.path}
                      className={({ isActive }) => `config-nav-item${isActive ? ' active' : ''}`}
                    >
                      <Icon aria-hidden="true" />
                      {t(tab.labelKey)}
                    </NavLink>
                  </Fragment>
                );
              })}
            </nav>
          )}

          <div className="config-shell-content">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
