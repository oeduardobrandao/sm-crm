import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Home,
  CheckSquare,
  Palette,
  FileText,
  BookOpen,
  LayoutList,
  Lightbulb,
  FileBarChart,
  MoreHorizontal,
  ChevronRight,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { useTheme } from '../hooks/useTheme';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';

const LANGUAGE_FLAGS: Record<Language, string> = {
  pt: '\u{1F1E7}\u{1F1F7}',
  en: '\u{1F1FA}\u{1F1F8}',
};

/** Desktop navigation — unchanged (six direct links). */
const NAV_ITEMS = [
  { label: 'Home', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovacoes', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Marca', labelKey: 'nav.marca', icon: Palette, path: '/marca' },
  { label: 'Paginas', labelKey: 'nav.paginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
];

/** Mobile bottom bar: five direct destinations + a "Mais" overflow control. */
const MOBILE_PRIMARY = NAV_ITEMS.slice(0, 5);
/** Everything reachable from the "Mais" sheet (keeps existing routes without crowding the bar). */
const MOBILE_OVERFLOW = [
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Ideias', labelKey: 'nav.ideias', icon: Lightbulb, path: '/ideias' },
  { label: 'Relatórios', labelKey: 'nav.relatorios', icon: FileBarChart, path: '/relatorios' },
];

function cycleLanguage(current: string) {
  const idx = SUPPORTED_LANGUAGES.indexOf(current as Language);
  const next = SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length];
  changeLanguage(next);
}

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();

  const [sheetOpen, setSheetOpen] = useState(false);
  const maisButtonRef = useRef<HTMLButtonElement>(null);
  const firstSheetItemRef = useRef<HTMLAnchorElement>(null);

  const maisActive = MOBILE_OVERFLOW.some((item) => pathname.startsWith(`${base}${item.path}`));

  // While the sheet is open: close on Escape, lock body scroll, move focus in
  // and restore it to the trigger on close.
  useEffect(() => {
    if (!sheetOpen) return;
    const trigger = maisButtonRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstSheetItemRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [sheetOpen]);

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:block sticky top-0 z-20 border-b border-stone-900 bg-stone-950/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-5xl px-8 h-16 flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            {bootstrap.workspace.logo_url && (
              <img
                src={bootstrap.workspace.logo_url}
                alt={bootstrap.workspace.name}
                className="h-6 w-auto object-contain"
              />
            )}
            <span className="font-display text-[15px] font-semibold tracking-tight text-white">
              {bootstrap.workspace.name}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ label, labelKey, path }) => {
              const href = `${base}${path}`;
              const active =
                path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
              return (
                <Link
                  key={path}
                  to={href}
                  className={`relative px-3 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200 ${
                    active ? 'text-white bg-white/10' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  {t(labelKey, label)}
                  {active && (
                    <span className="absolute left-1/2 -translate-x-1/2 -bottom-[17px] h-[2px] w-8 rounded-full bg-[#FFBF30]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-[13px] text-stone-400">{bootstrap.cliente_nome}</span>
            <button
              onClick={() => cycleLanguage(i18n.language)}
              aria-label={t('sidebar.language')}
              className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors text-sm"
            >
              {LANGUAGE_FLAGS[i18n.language as Language] || LANGUAGE_FLAGS.pt}
            </button>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
              className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </span>
        </div>
      </header>

      {/* Mobile top bar (brand only) */}
      <header className="md:hidden sticky top-0 z-20 h-14 px-5 flex items-center justify-between border-b border-stone-900 bg-stone-950/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {bootstrap.workspace.logo_url && (
            <img
              src={bootstrap.workspace.logo_url}
              alt={bootstrap.workspace.name}
              className="h-5 w-auto object-contain"
            />
          )}
          <span className="font-display text-sm font-semibold tracking-tight text-white">
            {bootstrap.workspace.name}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 truncate max-w-[120px]">
            {bootstrap.cliente_nome}
          </span>
          <button
            onClick={() => cycleLanguage(i18n.language)}
            aria-label={t('sidebar.language')}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            {LANGUAGE_FLAGS[i18n.language as Language] || LANGUAGE_FLAGS.pt}
          </button>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {MOBILE_PRIMARY.map(({ label, labelKey, icon: Icon, path }) => {
            const href = `${base}${path}`;
            const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
            return (
              <Link
                key={path}
                to={href}
                className="relative flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px]"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-[#FFBF30]" />
                )}
                <Icon
                  size={19}
                  strokeWidth={active ? 2.25 : 1.75}
                  className={active ? 'text-stone-900' : 'text-stone-400'}
                />
                <span
                  className={active ? 'text-stone-900 font-semibold' : 'text-stone-500 font-medium'}
                >
                  {t(labelKey, label)}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            ref={maisButtonRef}
            data-active={maisActive ? 'true' : 'false'}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="relative flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px]"
          >
            {maisActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-[#FFBF30]" />
            )}
            <MoreHorizontal
              size={19}
              strokeWidth={maisActive ? 2.25 : 1.75}
              className={maisActive ? 'text-stone-900' : 'text-stone-400'}
            />
            <span
              className={maisActive ? 'text-stone-900 font-semibold' : 'text-stone-500 font-medium'}
            >
              {t('nav.mais', 'Mais')}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile "Mais" overflow sheet */}
      {sheetOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={() => setSheetOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.mais', 'Mais')}
            className="hub-fade-up absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white dark:bg-[#12151a] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="font-display text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                {t('nav.mais', 'Mais')}
              </span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={t('common.close', 'Fechar')}
                className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-3 pb-3">
              {MOBILE_OVERFLOW.map(({ label, labelKey, icon: Icon, path }, i) => {
                const href = `${base}${path}`;
                const active = pathname.startsWith(`${base}${path}`);
                return (
                  <Link
                    key={path}
                    to={href}
                    ref={i === 0 ? firstSheetItemRef : undefined}
                    onClick={() => setSheetOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3.5 rounded-2xl transition-colors ${
                      active
                        ? 'bg-stone-100 dark:bg-white/10'
                        : 'hover:bg-stone-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-stone-100 dark:bg-white/[0.06] text-stone-700 dark:text-stone-200">
                      <Icon size={18} strokeWidth={1.9} />
                    </span>
                    <span className="flex-1 text-[15px] font-medium text-stone-900 dark:text-stone-100">
                      {t(labelKey, label)}
                    </span>
                    <ChevronRight size={16} className="text-stone-300 dark:text-stone-600" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
