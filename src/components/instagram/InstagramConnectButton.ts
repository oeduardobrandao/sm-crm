// =============================================
// CRM Fluxo - Instagram Connect Button Component
// =============================================
import { getInstagramAuthUrl } from '../../services/instagram';
import { showToast } from '../../router';

export function renderInstagramConnectButton(container: HTMLElement, clientId: number) {
  container.innerHTML = `
    <div class="card animate-up" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; text-align: center; border: 1px dashed var(--border-color); background: var(--surface-hover);">
      <div style="font-size: 3rem; color: var(--text-muted); margin-bottom: 1rem;"><i class="fa-brands fa-instagram"></i></div>
      <h3 style="margin-bottom: 0.5rem;">Conectar Instagram</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 400px;">
        Conecte a conta Business do Instagram deste cliente para visualizar métricas, crescimento de seguidores e performance de posts diretamente no CRM.
      </p>
      <button id="btn-ig-connect" class="btn-primary" style="background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); color: white; border: none;">
        <i class="fa-brands fa-instagram"></i> Conectar com o Instagram
      </button>
    </div>
  `;

  const btn = container.querySelector('#btn-ig-connect') as HTMLButtonElement;
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Conectando...';
        btn.disabled = true;
        const url = await getInstagramAuthUrl(clientId);
        window.location.href = url;
      } catch (err: any) {
        btn.innerHTML = '<i class="fa-brands fa-instagram"></i> Conectar com o Facebook';
        btn.disabled = false;
        showToast('Erro ao iniciar conexão: ' + err.message, 'error');
      }
    });
  }
}
