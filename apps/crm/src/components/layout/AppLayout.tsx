import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';

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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default function AppLayout() {
  const location = useLocation();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isTablet) setDrawerOpen(false);
  }, [isTablet]);

  useEffect(() => {
    const main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    window.$crisp?.push(['do', 'chat:hide']);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="app-container">
      {!isMobile && (
        <TopBar
          showHamburger={isTablet}
          onHamburgerClick={() => setDrawerOpen(v => !v)}
        />
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
        <Outlet />
      </main>

      <MobileNav />
    </div>
  );
}
