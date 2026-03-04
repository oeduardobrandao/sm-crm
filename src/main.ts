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
import { signOut } from './lib/supabase';

// Register public routes
registerRoute('/login', renderLogin, true);

// Register protected routes
registerRoute('/dashboard', renderDashboard);
registerRoute('/clientes', renderClientes);
registerRoute('/financeiro', renderFinanceiro);
registerRoute('/contratos', renderContratos);
registerRoute('/equipe', renderEquipe);
registerRoute('/integracoes', renderIntegracoes);
registerRoute('/configuracao', renderConfiguracao);

// Sidebar click -> navigate
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const route = link.getAttribute('data-route');
    if (route) {
      window.location.hash = route;
    }
  });
});

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
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      }
      window.location.hash = '#/login';
      window.location.reload();
    }
  });
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
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      }
      window.location.hash = '#/login';
      window.location.reload();
    }
  });
}

// Sync active state for both mobile nav & desktop sidebar on route change
function syncActiveNav() {
  const hash = window.location.hash.replace('#', '') || '/dashboard';

  // Desktop sidebar
  document.querySelectorAll('.sidebar .nav-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-route') === hash);
  });

  // Mobile bottom nav
  document.querySelectorAll('.mobile-nav-item[data-route]').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-route') === hash);
  });

  // Mobile "more" sheet items
  document.querySelectorAll('.mobile-more-item[data-route]').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-route') === hash);
  });

  // If the active route is one of the "more" items, highlight "Mais" button
  const moreRoutes = ['/equipe', '/integracoes', '/configuracao'];
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

// Initial sync
syncActiveNav();

console.log('CRM Fluxo v3: Auth + Router inicializado.');
