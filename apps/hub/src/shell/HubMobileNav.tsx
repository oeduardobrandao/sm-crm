import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Menu, X, Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';
import { getVisibleNavItems } from './navItems';
import { ClientAvatar } from '../components/ClientAvatar';
import { WorkspaceMark } from '../components/WorkspaceMark';
import { FlagIcon } from '../components/FlagIcon';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';

function cycleLanguage(current: string) {
  const idx = SUPPORTED_LANGUAGES.indexOf(current as Language);
  changeLanguage(SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length]);
}

export function HubMobileNav() {
  const { bootstrap, theme, toggleTheme } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const base = `/${workspace}/hub/${token}`;
  const pendingCount = usePendingApprovalsCount(token!);
  const navItems = getVisibleNavItems(bootstrap.feature_mensagens);

  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // A sentinel at the top of the document tells us when the page has scrolled,
  // without caring which element is the scroll container (a scroll listener
  // would have to guess between window and body). Mirrors VideoPrewarm's guard
  // so jsdom, which has no IntersectionObserver, simply stays un-scrolled.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="md:hidden h-px -mb-px" />
      {/* Reserves the flow height the fixed bar no longer occupies. */}
      <div aria-hidden="true" className="md:hidden h-[70px]" />

      {/* The bar detaches into a floating, blurred pill once the page scrolls;
          at rest it sits flush so the page still opens on its own heading.
          `pointer-events-none` keeps the transparent gutter around the pill
          from swallowing taps meant for the content scrolling behind it.

          Deliberately `fixed`, not `sticky`: main.tsx pulls in the CRM's global
          stylesheet, which sets `overflow-x: hidden` on #root. That computes
          overflow-y to `auto`, making #root a scroll container whose scrollport
          is its own full height — so a sticky descendant has nothing to stick
          to and just scrolls away. Ancestor overflow doesn't affect `fixed`. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-20 px-3 py-2 pointer-events-none">
        <div
          className={`pointer-events-auto h-[54px] px-4 rounded-2xl flex items-center justify-between border transition-[background-color,border-color,box-shadow] duration-200 ${
            scrolled
              ? 'hub-border shadow-[0_10px_30px_-12px_rgba(0,0,0,.35)]'
              : 'border-transparent'
          }`}
          style={
            scrolled
              ? {
                  background: 'color-mix(in srgb, var(--hub-card) 80%, transparent)',
                  backdropFilter: 'saturate(180%) blur(14px)',
                  WebkitBackdropFilter: 'saturate(180%) blur(14px)',
                }
              : undefined
          }
        >
          <span className="flex items-center gap-2 min-w-0">
            <WorkspaceMark size={28} />
            <span className="font-display text-[15px] font-medium hub-txt truncate">
              {bootstrap.workspace.name}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] hub-tx3 truncate max-w-[100px]">
              {bootstrap.cliente_nome}
            </span>
            <button
              type="button"
              ref={triggerRef}
              aria-label={t('nav.openMenu', 'Abrir menu')}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="w-10 h-10 rounded-lg border hub-border flex items-center justify-center hub-txt"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/35"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.menu', 'Menu')}
            className="hub-fade-up absolute top-0 right-0 bottom-0 w-[min(300px,84vw)] hub-bg-card border-l hub-border flex flex-col p-3 overflow-y-auto shadow-[0_20px_40px_rgba(0,0,0,.15)]"
          >
            <div className="flex items-center justify-between px-2 pb-3.5">
              <span className="flex items-center gap-2 min-w-0">
                <WorkspaceMark size={28} />
                <span className="font-display text-[15px] font-medium hub-txt truncate">
                  {bootstrap.workspace.name}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('actions.close', 'Fechar')}
                className="w-9 h-9 rounded-full flex items-center justify-center hub-tx2 hover:bg-[var(--hub-soft)]"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {navItems.map(({ label, labelKey, icon: Icon, path }, i) => {
                const href = `${base}${path}`;
                const active =
                  path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
                const badge = path === '/aprovacoes' ? pendingCount : null;
                return (
                  <Link
                    key={path}
                    to={href}
                    ref={i === 0 ? firstItemRef : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] transition-colors ${
                      active
                        ? 'font-semibold hub-txt hub-bg-soft'
                        : 'font-medium hub-tx2 hover:bg-[var(--hub-soft)]'
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                    <span className="flex-1 text-[15px]">{t(labelKey, label)}</span>
                    {!!badge && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center hub-btn-primary">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto flex items-center gap-3 px-2 pt-3.5 border-t hub-border">
              <ClientAvatar
                name={bootstrap.cliente_nome}
                photoUrl={bootstrap.cliente_foto_url}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold truncate hub-txt">
                  {bootstrap.cliente_nome}
                </div>
              </div>
              <button
                onClick={() => cycleLanguage(i18n.language)}
                aria-label={t('sidebar.language')}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--hub-soft)] transition-colors"
              >
                <FlagIcon lang={(i18n.language as Language) || 'pt'} size={20} />
              </button>
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
                className="w-9 h-9 flex items-center justify-center rounded-full hub-tx3 hover:bg-[var(--hub-soft)] transition-colors"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
