import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';

export default function AppLayout() {
  const location = useLocation();

  // Close flyout on route change (Sidebar handles its own state,
  // but scroll-to-top on navigation is handled here)
  useEffect(() => {
    const main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="app-container">
      <Sidebar />
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
