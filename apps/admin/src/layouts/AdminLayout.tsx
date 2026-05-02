import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Package, Users, Menu, X } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext';

const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/workspaces', icon: Building2, label: 'Workspaces' },
  { to: '/admin/plans', icon: Package, label: 'Plans' },
  { to: '/admin/admins', icon: Users, label: 'Admins' },
];

export default function AdminLayout() {
  const { adminEmail, signOut } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile hamburger */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="md:hidden fixed top-4 left-4 z-30 p-2 rounded-lg bg-[#12151a] border border-[#1e2430] text-[#e8eaf0]"
      >
        <Menu size={20} />
      </button>

      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`w-[220px] bg-[#12151a] border-r border-[#1e2430] flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="px-5 pt-6 pb-4 flex items-center justify-between">
          <div>
            <span className="font-['Playfair_Display'] text-xl font-black text-[#eab308]">mesaas</span>
            <span className="ml-1.5 text-[0.6rem] font-medium text-[#9ca3af] uppercase tracking-widest">admin</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-[#9ca3af] hover:text-[#e8eaf0]">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1e2430] text-[#e8eaf0]'
                    : 'text-[#9ca3af] hover:bg-[#1e2430]/50 hover:text-[#e8eaf0]'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-[#1e2430] mt-auto">
          <p className="text-sm text-[#9ca3af] truncate">{adminEmail}</p>
          <button
            onClick={signOut}
            className="text-xs text-[#4b5563] hover:text-[#eab308] transition-colors mt-1"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="md:ml-[220px] flex-1 p-4 pt-16 md:p-8 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
