// =============================================
// CRM Fluxo - Hash Router (com Auth Guard)
// =============================================
import { getCurrentUser, getCurrentProfile, updateSidebarUI } from './lib/supabase';

// ===== Security Utilities =====
export function escapeHTML(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Only allow http/https URLs. Returns empty string for anything else (e.g. javascript:). */
export function sanitizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

export type RouteHandler = (container: HTMLElement, param?: string) => void | Promise<void>;

interface Route {
  path: string;
  handler: RouteHandler;
  public?: boolean;
}

const routes: Route[] = [];
let appContainer: HTMLElement | null = null;

export function registerRoute(path: string, handler: RouteHandler, isPublic = false): void {
  routes.push({ path, handler, public: isPublic });
}

export function navigate(path: string): void {
  const targetHash = path.startsWith('#') ? path : '#' + path;
  if (window.location.hash === targetHash) {
    handleRoute(); // Force reload if staying on the same view
  } else {
    window.location.hash = targetHash;
  }
}

export async function initRouter(containerId: string): Promise<void> {
  appContainer = document.getElementById(containerId);
  window.addEventListener('hashchange', () => handleRoute());
  window.addEventListener('pageshow', (e) => { if (e.persisted) handleRoute(); });

  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
  } else {
    await handleRoute();
  }
}

async function handleRoute(): Promise<void> {
  if (!appContainer) return;

  const hash = window.location.hash || '#/dashboard';
  const path = hash.replace('#', '').split('?')[0];

  // Find route — exact match first, then parameterized prefix match
  let route = routes.find(r => r.path === path);
  let routeParam: string | undefined;

  if (!route) {
    // Try prefix match for parameterized routes like /cliente/123
    for (const r of routes) {
      if (path.startsWith(r.path + '/')) {
        route = r;
        routeParam = path.slice(r.path.length + 1);
        break;
      }
    }
  }

  // Auth guard: check if user is logged in for protected routes
  if (!route?.public) {
    try {
      const user = await getCurrentUser();
      if (!user) {
        window.location.hash = '#/login';
        return;
      }
      // Restore sidebar for authenticated pages
      const { restoreSidebar } = await import('./pages/login');
      restoreSidebar();

      // Hydrate sidebar with user profile (no circular import!)
      try {
        const profile = await getCurrentProfile();
        updateSidebarUI(profile);
        
        const { initStoreRole, currentUserRole } = await import('./store');
        await initStoreRole();
        if (currentUserRole === 'agent') {
          document.body.classList.add('role-agent');
        } else {
          document.body.classList.remove('role-agent');
        }
      } catch { /* non-blocking */ }
    } catch {
      window.location.hash = '#/login';
      return;
    }
  }

  // Update sidebar active state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('data-route') === path) {
      link.classList.add('active');
    }
  });

  // Transition
  appContainer.style.opacity = '0';
  appContainer.style.transform = 'translateY(12px)';

  setTimeout(async () => {
    if (!appContainer) return;

    if (route) {
      await route.handler(appContainer, routeParam);
    } else {
      appContainer.innerHTML = `
        <header class="header">
          <div class="header-title">
            <h1>Página não encontrada</h1>
            <p>A rota &ldquo;${escapeHTML(path)}&rdquo; não existe.</p>
          </div>
        </header>
      `;
    }

    appContainer.style.opacity = '1';
    appContainer.style.transform = 'translateY(0)';
  }, 180);
}

// ----- UI Helpers -----

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-info-circle';
  const iconEl = document.createElement('i');
  iconEl.className = `fa-solid ${icon}`;
  toast.appendChild(iconEl);
  toast.appendChild(document.createTextNode(' ' + message));
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export interface ModalOptions {
  hideSubmit?: boolean;
  submitText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function openModal(title: string, bodyHTML: string, onSubmit?: (form: HTMLFormElement) => void, options?: ModalOptions): void {
  closeModal();

  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  
  const submitBtnClass = options?.danger ? 'btn-danger' : 'btn-primary';
  const submitText = options?.submitText || 'Salvar';
  const cancelText = options?.cancelText || (options?.hideSubmit ? 'Entendi' : 'Cancelar');

  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>${title}</h3>
        <button type="button" class="modal-close" id="modal-close-btn"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <form id="modal-form" class="modal-body">
        ${bodyHTML}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="modal-cancel-btn">${cancelText}</button>
          ${!options?.hideSubmit ? ('<button type="submit" class="' + submitBtnClass + '">' + submitText + '</button>') : ''}
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('modal-visible'));

  overlay.querySelector('#modal-close-btn')?.addEventListener('click', closeModal);
  overlay.querySelector('#modal-cancel-btn')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  if (onSubmit) {
    const form = overlay.querySelector('#modal-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit(form);
    });
  }
}

export function openConfirm(title: string, message: string, onConfirm: () => void, isDanger = false): void {
  openModal(title, `<div style="font-size: 1rem; color: var(--text-main); line-height: 1.5; margin-bottom: 0.5rem;">${message}</div>`, () => {
    onConfirm();
    closeModal();
  }, {
    submitText: 'Confirmar',
    cancelText: 'Cancelar',
    danger: isDanger
  });
}

export function closeModal(): void {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('modal-visible');
    setTimeout(() => overlay.remove(), 200);
  }
}
