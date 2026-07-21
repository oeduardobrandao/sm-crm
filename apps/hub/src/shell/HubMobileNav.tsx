import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Home,
  CheckSquare,
  LayoutList,
  FileText,
  BookOpen,
  Palette,
  Lightbulb,
  FileBarChart,
  MessageCircle,
  Menu,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';

const NAV_ITEMS = [
  { label: 'Início', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovações', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Páginas', labelKey: 'nav.paginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Marca', labelKey: 'nav.marca', icon: Palette, path: '/marca' },
  { label: 'Ideias', labelKey: 'nav.ideias', icon: Lightbulb, path: '/ideias' },
  { label: 'Relatórios', labelKey: 'nav.relatorios', icon: FileBarChart, path: '/relatorios' },
  { label: 'Mensagens', labelKey: 'nav.mensagens', icon: MessageCircle, path: '/mensagens' },
];

export function HubMobileNav() {
  const { bootstrap, theme, toggleTheme } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const base = `/${workspace}/hub/${token}`;
  const pendingCount = usePendingApprovalsCount(token!);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

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
      <header className="md:hidden sticky top-0 z-20 h-[54px] px-5 flex items-center justify-between border-b hub-border hub-bg-card">
        <span className="font-display text-[15px] font-medium hub-txt">
          {bootstrap.workspace.name}
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
              <span className="font-display text-[15px] font-medium hub-txt">
                {bootstrap.workspace.name}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('actions.close', 'Fechar')}
                className="w-9 h-9 rounded-full flex items-center justify-center hub-tx2 hover:hub-bg-soft"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map(({ label, labelKey, icon: Icon, path }, i) => {
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
                        : 'font-medium hub-tx2 hover:hub-bg-soft'
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
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold hub-txt">{bootstrap.cliente_nome}</div>
              </div>
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
                className="w-9 h-9 flex items-center justify-center rounded-full hub-tx2 hover:hub-bg-soft"
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
