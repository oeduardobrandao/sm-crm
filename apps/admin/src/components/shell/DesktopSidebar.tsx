import { useId } from 'react';
import { NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { BrandMark } from '@mesaas/ios-kit';
import { NAV_GROUPS } from '../../lib/nav-items';

export interface DesktopSidebarProps {
  email: string | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  glassEnabled: boolean;
  onToggleGlass: () => void;
  onSignOut: () => void;
}

/** Floating glass sidebar of the desktop shell (≥768px). */
export function DesktopSidebar({
  email,
  theme,
  onToggleTheme,
  glassEnabled,
  onToggleGlass,
  onSignOut,
}: DesktopSidebarProps) {
  const glassLabelId = useId();
  const themeLabel = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  return (
    <aside className="admin-sidebar admin-glass glass-surface--sidebar bg-card text-card-foreground">
      <div className="flex items-center gap-2.5 px-2 pb-[18px]">
        <BrandMark />
        <span className="font-sf text-[17px] font-bold">Mesaas</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          admin
        </span>
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-3.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? 'main'}>
            {group.label && <h2 className="admin-sidebar__group-label">{group.label}</h2>}
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ id, to, label, icon: Icon, tile }) => (
                <li key={id}>
                  <NavLink to={to} end={to === '/admin'} className="admin-sidebar__link">
                    <span
                      className="admin-nav-tile"
                      aria-hidden="true"
                      style={{ ['--tile' as string]: tile }}
                    >
                      <Icon />
                    </span>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mt-3 flex flex-col gap-2.5 border-t border-border px-1.5 pt-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{email}</p>
          <p className="text-[11px] text-muted-foreground">Admin da plataforma</p>
        </div>
        <div className="flex items-center gap-2">
          <span id={glassLabelId} className="flex-1 text-[13px] text-muted-foreground">
            Liquid Glass
          </span>
          {/* `.phone-switch` reads the kit tokens, which live on `.phone-kit`. Only the switch
              gets them, so the sidebar keeps the Admin's own colours. */}
          <span className="phone-kit inline-flex">
            <button
              type="button"
              role="switch"
              aria-checked={glassEnabled}
              aria-labelledby={glassLabelId}
              onClick={onToggleGlass}
              className="phone-switch"
            >
              <span className="phone-switch__thumb" aria-hidden="true" />
            </button>
          </span>
          {!glassEnabled && (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.08] text-muted-foreground hover:text-foreground"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="h-7 rounded-full bg-foreground/[0.08] px-2.5 text-xs text-foreground hover:bg-foreground/[0.14]"
          >
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}
