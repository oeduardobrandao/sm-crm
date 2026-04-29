import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList, Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { useTheme } from '../hooks/useTheme';
import { changeLanguage, SUPPORTED_LANGUAGES } from '@mesaas/i18n';
import type { Language } from '@mesaas/i18n';

const LANGUAGE_FLAGS: Record<Language, string> = { pt: '\u{1F1E7}\u{1F1F7}', en: '\u{1F1FA}\u{1F1F8}' };

const NAV_ITEMS = [
  { label: 'Home', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovacoes', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Marca', labelKey: 'nav.marca', icon: Palette, path: '/marca' },
  { label: 'Paginas', labelKey: 'nav.paginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
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

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:block sticky top-0 z-20 border-b border-stone-900 bg-stone-950/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-5xl px-8 h-16 flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            {bootstrap.workspace.logo_url && (
              <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-6 w-auto object-contain" />
            )}
            <span className="font-display text-[15px] font-semibold tracking-tight text-white">
              {bootstrap.workspace.name}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ label, labelKey, path }) => {
              const href = `${base}${path}`;
              const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
              return (
                <Link
                  key={path}
                  to={href}
                  className={`relative px-3 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200 ${
                    active
                      ? 'text-white bg-white/10'
                      : 'text-stone-400 hover:text-white'
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
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-5 w-auto object-contain" />
          )}
          <span className="font-display text-sm font-semibold tracking-tight text-white">
            {bootstrap.workspace.name}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 truncate max-w-[120px]">{bootstrap.cliente_nome}</span>
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
          {NAV_ITEMS.map(({ label, labelKey, icon: Icon, path }) => {
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
                <Icon size={19} strokeWidth={active ? 2.25 : 1.75} className={active ? 'text-stone-900' : 'text-stone-400'} />
                <span className={active ? 'text-stone-900 font-semibold' : 'text-stone-500 font-medium'}>{t(labelKey, label)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
