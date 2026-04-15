import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList } from 'lucide-react';
import { useHub } from '../HubContext';

const NAV_ITEMS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
];

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;

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
            {NAV_ITEMS.map(({ label, path }) => {
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
                  {label}
                  {active && (
                    <span className="absolute left-1/2 -translate-x-1/2 -bottom-[17px] h-[2px] w-8 rounded-full bg-[#FFBF30]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <span className="ml-auto text-[13px] text-stone-400">{bootstrap.cliente_nome}</span>
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
        <span className="text-[11px] text-stone-400 truncate max-w-[40%]">{bootstrap.cliente_nome}</span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
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
                <span className={active ? 'text-stone-900 font-semibold' : 'text-stone-500 font-medium'}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
