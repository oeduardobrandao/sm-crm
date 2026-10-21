import { Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { BuildPrefetch } from '../components/BuildPrefetch';
import { LiquidBackdrop } from '../liquidglass/LiquidBackdrop';
import { useIsPhone } from '../hooks/useIsPhone';
import { hidesTabBar } from '../lib/nav-items';
import { DesktopSidebar } from '../components/shell/DesktopSidebar';
import { AdminTabBar } from '../components/shell/AdminTabBar';
import { useAdminTheme } from './useAdminTheme';

export default function AdminLayout() {
  const { adminEmail, signOut } = useAdminAuth();
  const { theme, setTheme, toggleTheme, glassEnabled, toggleGlass } = useAdminTheme();
  const isPhone = useIsPhone();
  const { pathname } = useLocation();
  const hideTabs = isPhone && hidesTabBar(pathname);

  // Same element types at the same positions in both modes, so crossing 768px (an iPhone
  // rotated to landscape) never remounts the route element through the shell. The
  // `{cond && …}` holes keep their slots, so <main> stays at the same child index.
  return (
    <div
      className={isPhone ? 'phone-kit admin-phone-shell' : 'admin-desktop-shell'}
      data-tab-bar={hideTabs ? 'hidden' : undefined}
    >
      <BuildPrefetch />
      <LiquidBackdrop />
      {!isPhone && (
        <DesktopSidebar
          email={adminEmail}
          theme={theme}
          onToggleTheme={toggleTheme}
          glassEnabled={glassEnabled}
          onToggleGlass={toggleGlass}
          onSignOut={signOut}
        />
      )}
      <main className={isPhone ? 'admin-phone-main' : 'admin-desktop-main'}>
        <div className={isPhone ? undefined : 'admin-desktop-content'}>
          <Outlet />
        </div>
      </main>
      {isPhone && !hideTabs && (
        <AdminTabBar
          email={adminEmail}
          theme={theme}
          onSetTheme={setTheme}
          glassEnabled={glassEnabled}
          onToggleGlass={toggleGlass}
          onSignOut={signOut}
        />
      )}
    </div>
  );
}
