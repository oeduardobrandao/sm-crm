import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TabletTopBar from './TabletTopBar';

function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() => {
    const w = window.innerWidth;
    return w >= 768 && w <= 1100;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (max-width: 1100px)');
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isTablet;
}

export default function AppLayout() {
  const location = useLocation();
  const isTablet = useIsTablet();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer when leaving tablet range
  useEffect(() => {
    if (!isTablet) setDrawerOpen(false);
  }, [isTablet]);

  // Scroll to top on route change
  useEffect(() => {
    const main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="app-container">
      {isTablet && (
        <TabletTopBar onHamburgerClick={() => setDrawerOpen(true)} />
      )}

      <Sidebar
        isDrawer={isTablet}
        isOpen={drawerOpen}
        onClose={closeDrawer}
      />

      {isTablet && drawerOpen && (
        <div
          className="tablet-drawer-backdrop visible"
          onClick={closeDrawer}
        />
      )}

      <main className="main-content" id="app">
        <div className="app-logo-bar">
          <img src="/logo-black.svg" className="app-logo logo-light" alt="Logo" />
          <img src="/logo-white.svg" className="app-logo logo-dark" alt="Logo" />
        </div>
        <Outlet />
      </main>

      <MobileNav />
    </div>
  );
}
