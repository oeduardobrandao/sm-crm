// =============================================
// CRM Fluxo - Bootstrap (com Auth)
// =============================================
import { registerRoute, initRouter } from './router';
import { renderDashboard } from './pages/dashboard';
import { renderClientes } from './pages/clientes';
import { renderFinanceiro } from './pages/financeiro';
import { renderContratos } from './pages/contratos';
import { renderEquipe } from './pages/equipe';
import { renderIntegracoes } from './pages/integracoes';
import { renderLogin } from './pages/login';
import { renderConfiguracao } from './pages/configuracao';
import { renderCalendario } from './pages/calendario';
import { renderClienteDetalhe } from './pages/cliente-detalhe';
import { renderMembroDetalhe } from './pages/membro-detalhe';
import { renderLeads } from './pages/leads';
import { renderPoliticaPrivacidade } from './pages/politica-privacidade';
import { renderAnalytics } from './pages/analytics';
import { renderAnalyticsConta } from './pages/analytics-conta';
import { signOut } from './lib/supabase';
import { initSidebar } from './sidebar';

// Register public routes
registerRoute('/login', renderLogin, true);
registerRoute('/politica-de-privacidade', renderPoliticaPrivacidade, true);

// Register protected routes
registerRoute('/dashboard', renderDashboard);
registerRoute('/clientes', renderClientes);
registerRoute('/financeiro', renderFinanceiro);
registerRoute('/contratos', renderContratos);
registerRoute('/equipe', renderEquipe);
registerRoute('/integracoes', renderIntegracoes);
registerRoute('/configuracao', renderConfiguracao);
registerRoute('/calendario', renderCalendario);
registerRoute('/cliente', renderClienteDetalhe);
registerRoute('/membro', renderMembroDetalhe);
registerRoute('/leads', renderLeads);
registerRoute('/analytics', renderAnalytics);
registerRoute('/analytics-conta', renderAnalyticsConta);

// Setup User Dropdown Logic
const userMenuBtn = document.getElementById('user-menu-btn');
const userDropdown = document.getElementById('user-dropdown');
const btnLogoutFlutuante = document.getElementById('btn-logout-flutuante');

if (userMenuBtn && userDropdown) {
  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!userMenuBtn.contains(e.target as Node)) {
      userDropdown.classList.add('hidden');
    }
  });
}

if (btnLogoutFlutuante) {
  btnLogoutFlutuante.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      btnLogoutFlutuante.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saindo...';
      await Promise.race([
        signOut(),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
    } catch (err) {
      console.error('Erro ao sair:', err);
    } finally {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      window.location.hash = '#/login';
      window.location.reload();
    }
  });
}

// ===== Dark Mode Toggle =====
const themeToggleBtn = document.getElementById('theme-toggle');
const mobileThemeToggleBtn = document.getElementById('mobile-theme-toggle');

const updateThemeIcons = (isDark: boolean) => {
  const moonIcon = '<i class="ph ph-moon"></i>';
  const sunIcon = '<i class="ph ph-sun" style="color: #eab308"></i>';
  
  if (themeToggleBtn) {
    themeToggleBtn.innerHTML = isDark ? sunIcon : moonIcon;
  }
  
  if (mobileThemeToggleBtn) {
    mobileThemeToggleBtn.innerHTML = isDark 
      ? sunIcon + '\nTema Claro' 
      : moonIcon + '\nTema Escuro';
  }
};

// Set initial icon
updateThemeIcons(document.documentElement.getAttribute('data-theme') === 'dark');

const handleThemeToggle = () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
    updateThemeIcons(false);
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
    updateThemeIcons(true);
  }
};

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', handleThemeToggle);
}

if (mobileThemeToggleBtn) {
  mobileThemeToggleBtn.addEventListener('click', handleThemeToggle);
}

// NOTE: Sidebar profile is hydrated by router.ts handleRoute() on each navigation.
// No onAuthStateChange listener here to avoid race conditions and circular deps.

// ===== Mobile Navigation =====
const mobileMoreBtn = document.getElementById('mobile-more-btn');
const mobileMoreOverlay = document.getElementById('mobile-more-overlay');
const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

// Toggle "More" overlay
if (mobileMoreBtn && mobileMoreOverlay) {
  mobileMoreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    mobileMoreOverlay.classList.add('visible');
  });

  // Close when tapping backdrop
  mobileMoreOverlay.addEventListener('click', (e) => {
    if (e.target === mobileMoreOverlay) {
      mobileMoreOverlay.classList.remove('visible');
    }
  });

  // Close "More" when clicking a nav item inside the sheet
  mobileMoreOverlay.querySelectorAll('.mobile-more-item[data-route]').forEach(item => {
    item.addEventListener('click', () => {
      mobileMoreOverlay.classList.remove('visible');
    });
  });
}

// Mobile logout
if (mobileLogoutBtn) {
  mobileLogoutBtn.addEventListener('click', async () => {
    try {
      mobileLogoutBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saindo...';
      await Promise.race([
        signOut(),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
    } catch (err) {
      console.error('Erro ao sair:', err);
    } finally {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      window.location.hash = '#/login';
      window.location.reload();
    }
  });
}

// Sync active state for mobile nav on route change
function syncActiveNav() {
  const hash = window.location.hash.replace('#', '') || '/dashboard';

  // Mobile bottom nav
  document.querySelectorAll('.mobile-nav-item[data-route]').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-route') === hash);
  });

  // Mobile "more" sheet items
  document.querySelectorAll('.mobile-more-item[data-route]').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-route') === hash);
  });

  // If the active route is one of the "more" items, highlight "Mais" button
  const moreRoutes = ['/equipe', '/integracoes', '/analytics', '/configuracao'];
  const moreBtn = document.getElementById('mobile-more-btn');
  if (moreBtn) {
    moreBtn.classList.toggle('active', moreRoutes.includes(hash));
  }

  // Hide mobile nav & more overlay on login page
  const mobileNav = document.getElementById('mobile-nav');
  if (mobileNav) {
    mobileNav.style.display = hash === '/login' ? 'none' : '';
  }
  if (mobileMoreOverlay && hash === '/login') {
    mobileMoreOverlay.classList.remove('visible');
  }
}

window.addEventListener('hashchange', syncActiveNav);

// Initialize router
initRouter('app');

// Initialize desktop sidebar
initSidebar();

// Initial sync for mobile
syncActiveNav();

// Application initialized
