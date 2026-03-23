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
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
