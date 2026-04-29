// =============================================
// Mesaas - Instagram Connect Button Component
// =============================================
import { getInstagramAuthUrl } from '../../services/instagram';
import { showToast, escapeHTML } from '../../router';
import { i18n } from '@mesaas/i18n';

function t(key: string, opts?: Record<string, string>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

export function renderInstagramConnectButton(container: HTMLElement, clientId: number) {
  // Translation values are from static JSON files (safe), but escapeHTML
  // is applied per project security rules for any innerHTML interpolation.
  container.innerHTML = `
    <div class="card animate-up" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; text-align: center; border: 1px dashed var(--border-color); background: var(--surface-hover);">
      <div style="font-size: 3rem; color: var(--text-muted); margin-bottom: 1rem;"><i class="fa-brands fa-instagram"></i></div>
      <h3 class="text-xl font-bold tracking-tight mb-2 text-foreground">${escapeHTML(t('instagram.connectTitle'))}</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 400px;">
        ${escapeHTML(t('instagram.connectDescription'))}
      </p>
      <button id="btn-ig-connect" class="btn-primary" style="background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); color: white; border: none;">
        <i class="fa-brands fa-instagram"></i> ${escapeHTML(t('instagram.connectButton'))}
      </button>
    </div>
  `;

  const btn = container.querySelector('#btn-ig-connect') as HTMLButtonElement;
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHTML(t('instagram.connecting'))}`;
        btn.disabled = true;
        const url = await getInstagramAuthUrl(clientId);
        window.location.href = url;
      } catch (err: any) {
        btn.innerHTML = `<i class="fa-brands fa-instagram"></i> ${escapeHTML(t('instagram.connectFallback'))}`;
        btn.disabled = false;
        showToast(t('instagram.connectError', { error: err.message }), 'error');
      }
    });
  }
}
