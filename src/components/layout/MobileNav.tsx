import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');

  const path = location.pathname;

  const go = (route: string) => {
    navigate(route);
    setMoreOpen(false);
  };

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const initials = profile?.nome
    ? profile.nome.split(' ').map((w: string) => w?.[0] || '').join('').substring(0, 2).toUpperCase()
    : 'U';

  return (
    <>
      <nav className="mobile-nav" id="mobile-nav">
        <a href="#" onClick={(e) => { e.preventDefault(); go('/dashboard'); }} className={`mobile-nav-item${path === '/dashboard' ? ' active' : ''}`}>
          <i className="ph ph-chart-pie-slice" /><span>Dashboard</span>
        </a>
        <a href="#" onClick={(e) => { e.preventDefault(); go('/clientes'); }} className={`mobile-nav-item${path.startsWith('/clientes') ? ' active' : ''}`}>
          <i className="ph ph-users" /><span>Clientes</span>
        </a>
        <a href="#" onClick={(e) => { e.preventDefault(); go('/analytics'); }} className={`mobile-nav-item${path.startsWith('/analytics') ? ' active' : ''}`}>
          <i className="ph ph-chart-line-up" /><span>Analytics</span>
        </a>
        <a href="#" onClick={(e) => { e.preventDefault(); go('/entregas'); }} className={`mobile-nav-item${path.startsWith('/entregas') ? ' active' : ''}`}>
          <i className="ph ph-kanban" /><span>Entregas</span>
        </a>
        <button className="mobile-nav-item" id="mobile-more-btn" onClick={() => setMoreOpen(true)}>
          <i className="ph ph-dots-three" /><span>Mais</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-more-overlay" id="mobile-more-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMoreOpen(false); }}>
          <div className="mobile-more-sheet">
            <div className="mobile-more-handle" />

            <div className="mobile-more-profile" id="mobile-profile">
              <div className="avatar" id="mobile-avatar">{initials}</div>
              <div className="mobile-more-profile-info">
                <div className="mobile-more-profile-name" id="mobile-user-name">{profile?.nome || 'Usuário'}</div>
                <div className="mobile-more-profile-plan">Plano Profissional</div>
              </div>
            </div>

            <div className="mobile-more-title">Navegação</div>
            <div className="mobile-more-grid">
              {[
                { route: '/leads', icon: 'ph-funnel', label: 'Leads' },
                { route: '/contratos', icon: 'ph-file-text', label: 'Contratos' },
                { route: '/calendario', icon: 'ph-calendar-blank', label: 'Calendário' },
                { route: '/equipe', icon: 'ph-user-circle-gear', label: 'Equipe' },
                { route: '/integracoes', icon: 'ph-plugs-connected', label: 'Integrações' },
                { route: '/financeiro', icon: 'ph-wallet', label: 'Financeiro' },
                { route: '/configuracao', icon: 'ph-gear', label: 'Configurações' },
              ].map(({ route, icon, label }) => (
                <a key={route} href="#" className="mobile-more-item" onClick={(e) => { e.preventDefault(); go(route); }}>
                  <i className={`ph ${icon}`} />{label}
                </a>
              ))}
            </div>

            <div className="mobile-more-divider" />

            <div className="mobile-more-grid" style={{ marginBottom: 0 }}>
              <button className="mobile-more-item mobile-more-action" id="mobile-theme-toggle" onClick={toggleTheme}>
                <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />Tema
              </button>
              <a href="#" className="mobile-more-item mobile-more-action" onClick={(e) => { e.preventDefault(); go('/politica-de-privacidade'); }}>
                <i className="ph ph-shield-check" />Privacidade
              </a>
            </div>

            <div className="mobile-more-divider" />

            <div className="mobile-more-grid" style={{ gridTemplateColumns: '1fr' }}>
              <button className="mobile-more-item danger" id="mobile-logout-btn" onClick={signOut}>
                <i className="ph ph-sign-out" />Sair da Conta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
