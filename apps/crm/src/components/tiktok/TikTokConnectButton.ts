// =============================================
// Mesaas - TikTok Connect Button Component
// =============================================
import { getTikTokAuthUrl } from '../../services/tiktok';
import { escapeHTML } from '../../router';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';

function t(key: string, opts?: Record<string, string>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

export function renderTikTokConnectButton(container: HTMLElement, clientId: number) {
  // Translation values are from static JSON files (safe), but escapeHTML
  // is applied per project security rules for any innerHTML interpolation.
  container.innerHTML = `
    <div class="card animate-up" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; text-align: center; border: 1px dashed var(--border-color); background: var(--surface-hover);">
      <div style="font-size: 3rem; color: var(--text-muted); margin-bottom: 1rem;"><i class="fa-brands fa-tiktok"></i></div>
      <h3 class="text-xl font-bold tracking-tight mb-2 text-foreground">${escapeHTML(t('tiktok.connectTitle'))}</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 400px;">
        ${escapeHTML(t('tiktok.connectDescription'))}
      </p>
      <button id="btn-tt-connect" class="btn-primary" style="background: #000000; color: white; border: none;">
        <i class="fa-brands fa-tiktok"></i> ${escapeHTML(t('tiktok.connectButton'))}
      </button>
    </div>
  `;

  const btn = container.querySelector('#btn-tt-connect') as HTMLButtonElement;
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHTML(t('tiktok.connecting'))}`;
        btn.disabled = true;
        const url = await getTikTokAuthUrl(clientId);
        window.location.href = url;
      } catch (err: any) {
        btn.innerHTML = `<i class="fa-brands fa-tiktok"></i> ${escapeHTML(t('tiktok.connectButton'))}`;
        btn.disabled = false;
        toast.error(t('tiktok.connectError', { error: err.message }));
      }
    });
  }
}
