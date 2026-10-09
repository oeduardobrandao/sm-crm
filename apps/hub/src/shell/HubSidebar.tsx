import { Link, useLocation, useParams } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { useHubLook } from '../hooks/useHubLook';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';
import { useMensagensUnreadCount } from '../hooks/useMensagensUnreadCount';
import { getVisibleNavItems, type HubBadgeKey } from './navItems';
import { PAUTA_BADGE_CLASS, pautaBadgeStyle } from './pautaNav';
import { ClientAvatar } from '../components/ClientAvatar';
import { WorkspaceMark, isWordmarkStyle } from '../components/WorkspaceMark';
import { FlagIcon } from '@mesaas/ui/FlagIcon';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';

function cycleLanguage(current: string) {
  const idx = SUPPORTED_LANGUAGES.indexOf(current as Language);
  changeLanguage(SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length]);
}

export function HubSidebar() {
  const { bootstrap, theme, toggleTheme } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const pauta = useHubLook() === 'pauta';
  const base = `/${workspace}/hub/${token}`;
  const pendingCount = usePendingApprovalsCount(token!);
  const mensagensUnread = useMensagensUnreadCount(token!, bootstrap.feature_mensagens);
  const badgeCounts: Record<HubBadgeKey, number> = {
    aprovacoes: pendingCount,
    mensagens: mensagensUnread,
  };
  const navItems = getVisibleNavItems(
    bootstrap.feature_mensagens,
    bootstrap.feature_agenda ?? false,
  );

  return (
    <aside
      className={
        pauta
          ? 'hidden md:flex fixed left-0 top-0 bottom-0 w-[240px] z-30 flex-col bg-[var(--hub-bg)]'
          : 'hidden md:flex fixed left-0 top-0 bottom-0 w-[240px] z-30 flex-col hub-bg-card border-r hub-border'
      }
    >
      <div className="flex items-center gap-2.5 px-3.5 pt-[18px] pb-4">
        {isWordmarkStyle(bootstrap) ? (
          <div className="min-w-0 flex-1">
            <WorkspaceMark />
            <div className="text-[12px] hub-tx3">{t('hub.clientPortal', 'Hub do cliente')}</div>
          </div>
        ) : (
          <>
            <WorkspaceMark />
            <div className="min-w-0 flex-1">
              <div
                className={
                  pauta
                    ? 'font-display hub-display-title text-[15px] tracking-tight truncate hub-txt'
                    : 'font-semibold text-[14.5px] tracking-tight truncate hub-txt'
                }
              >
                {bootstrap.workspace.name}
              </div>
              <div className="text-[12px] hub-tx3">{t('hub.clientPortal', 'Hub do cliente')}</div>
            </div>
          </>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 px-3 py-3 border-t hub-border overflow-y-auto">
        {navItems.map(({ label, labelKey, icon: Icon, path, badge: badgeKey }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          const badge = badgeKey ? badgeCounts[badgeKey] : null;
          return (
            <Link
              key={path}
              to={href}
              className={
                pauta
                  ? `flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--hub-r-ctl)] text-[13.5px] min-h-[40px] transition-colors ${
                      active
                        ? 'font-semibold hub-nav-pill'
                        : 'font-medium hub-tx2 hover:bg-[var(--hub-soft)]'
                    }`
                  : `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] min-h-[40px] transition-colors ${
                      active
                        ? 'font-semibold hub-nav-active hub-bg-soft'
                        : 'font-medium hub-tx2 hover:bg-[var(--hub-soft)]'
                    }`
              }
            >
              <Icon size={17} strokeWidth={active ? 2.25 : 1.75} />
              <span className="flex-1">{t(labelKey, label)}</span>
              {!!badge &&
                (pauta ? (
                  <span className={PAUTA_BADGE_CLASS} style={pautaBadgeStyle(active)}>
                    {badge}
                  </span>
                ) : (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[12px] font-bold flex items-center justify-center hub-btn-primary">
                    {badge}
                  </span>
                ))}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center gap-2 px-3.5 py-3.5 border-t hub-border">
        <ClientAvatar name={bootstrap.cliente_nome} photoUrl={bootstrap.cliente_foto_url} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate hub-txt">{bootstrap.cliente_nome}</div>
        </div>
        <button
          onClick={() => cycleLanguage(i18n.language)}
          aria-label={t('sidebar.language')}
          className={
            pauta
              ? 'w-8 h-8 flex items-center justify-center rounded-[var(--hub-r-ctl)] border hub-border hover:bg-[var(--hub-soft)] transition-colors'
              : 'w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--hub-soft)] transition-colors'
          }
        >
          <FlagIcon lang={(i18n.language as Language) || 'pt'} />
        </button>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
          className={
            pauta
              ? 'w-8 h-8 flex items-center justify-center rounded-[var(--hub-r-ctl)] border hub-border hub-tx3 hover:bg-[var(--hub-soft)] transition-colors'
              : 'w-8 h-8 flex items-center justify-center rounded-full hub-tx3 hover:bg-[var(--hub-soft)] transition-colors'
          }
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
