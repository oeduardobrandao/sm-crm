import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Calendar, Palette, FileText, BookOpen } from 'lucide-react';
import { useHub } from '../HubContext';

const NAV_ITEMS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Calendário', icon: Calendar, path: '/calendario' },
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
      <header className="hidden md:flex items-center gap-6 px-6 py-3 border-b bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2 mr-4">
          {bootstrap.workspace.logo_url && (
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-7 w-auto object-contain" />
          )}
          <span className="font-semibold text-sm">{bootstrap.workspace.name}</span>
        </div>
        {NAV_ITEMS.map(({ label, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`text-sm transition-colors ${active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </Link>
          );
        })}
        <span className="ml-auto text-sm text-muted-foreground">{bootstrap.cliente_nome}</span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-10 flex">
        {NAV_ITEMS.slice(0, 5).map(({ label, icon: Icon, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
