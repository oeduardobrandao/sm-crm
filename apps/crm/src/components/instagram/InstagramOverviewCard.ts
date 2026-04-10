// =============================================
// Mesaas - Instagram Overview Card Component
// =============================================
import { syncInstagramData, disconnectInstagram } from '../../services/instagram';
import { showToast, openModal, closeModal, escapeHTML, sanitizeUrl } from '../../router';
import { formatDate } from '../../store';

export function renderInstagramOverviewCard(container: HTMLElement, clientId: number, account: any, onRefresh: () => void) {
  container.innerHTML = `
    <div class="card animate-up" style="position: relative; margin-bottom: 1.5rem; overflow: visible;">
      <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem;">
         <button id="btn-ig-sync" class="btn-icon" data-tooltip="Sincronizar Dados" data-tooltip-dir="bottom" style="color: var(--text-muted);"><i class="ph ph-arrows-clockwise"></i></button>
         <button id="btn-ig-disconnect" class="btn-icon" data-tooltip="Desconectar" data-tooltip-dir="bottom" style="color: var(--danger);"><i class="ph ph-plugs"></i></button>
      </div>

      <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem;">
         <img src="${account.profile_picture_url ? sanitizeUrl(account.profile_picture_url) : 'https://ui-avatars.com/api/?name=IG&background=random'}" alt="IG Profile" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #E1306C;" />
         <div>
            <h3 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-1">
                ${escapeHTML(account.username || 'Conta Instagram')}
                <i class="fa-brands fa-instagram" style="color: #E1306C; font-size: 1.2rem;"></i>
            </h3>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Atualizado em ${(account.last_synced_at || account.updated_at) ? formatDate((account.last_synced_at || account.updated_at).split('T')[0]) : 'agora'}</p>
         </div>
      </div>

      <div class="kpi-grid" style="margin-bottom: 1.5rem;">
         <div class="kpi-card">
            <span class="kpi-label">SEGUIDORES</span>
            <span class="kpi-value">${account.follower_count?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">SEGUINDO</span>
            <span class="kpi-value">${account.following_count?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">PUBLICAÇÕES</span>
            <span class="kpi-value">${account.media_count?.toLocaleString('pt-BR') || 0}</span>
         </div>
      </div>

      <h4 style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Métricas (Últimos 28 Dias)</h4>
      <div class="kpi-grid">
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-users"></i> Contas Alcançadas</span>
            <span class="kpi-value">${account.reach_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-eye"></i> Impressões</span>
            <span class="kpi-value">${account.impressions_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-user-focus"></i> Contas Engajadas</span>
            <span class="kpi-value">${account.profile_views_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-link"></i> Cliques no Link</span>
            <span class="kpi-value">${account.website_clicks_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
      </div>
    </div>
  `;

  // Bind Sync
  const btnSync = container.querySelector('#btn-ig-sync') as HTMLButtonElement;
  if (btnSync) {
      btnSync.addEventListener('click', async () => {
          try {
             btnSync.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
             btnSync.disabled = true;
             await syncInstagramData(clientId);
             showToast('Dados sincronizados com sucesso!');
             onRefresh();
          } catch (err: any) {
             btnSync.innerHTML = '<i class="ph ph-arrows-clockwise"></i>';
             btnSync.disabled = false;
             
             if (err.message === 'TOKEN_EXPIRED') {
                 showToast('Token expirado. Por favor, reconecte a conta.', 'error');
                 // Força desconexão local ou avisa usuário
             } else {
                 showToast('Erro na sincronização: ' + err.message, 'error');
             }
          }
      });
  }

  // Bind Disconnect
  const btnDisconnect = container.querySelector('#btn-ig-disconnect') as HTMLButtonElement;
  if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
          openModal(
            'Desconectar Instagram',
            `<p style="color:var(--text-muted);line-height:1.6;">Tem certeza que deseja desconectar <strong>@${escapeHTML(account.username || 'esta conta')}</strong> do Instagram?</p>
             <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">Os dados históricos serão removidos e a sincronização será interrompida.</p>`,
            async () => {
              closeModal();
              try {
                btnDisconnect.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
                btnDisconnect.disabled = true;
                await disconnectInstagram(clientId);
                showToast('Conta desconectada com sucesso.');
                onRefresh();
              } catch (err: any) {
                btnDisconnect.innerHTML = '<i class="ph ph-plugs"></i>';
                btnDisconnect.disabled = false;
                showToast('Erro ao desconectar: ' + err.message, 'error');
              }
            },
            { danger: true, submitText: 'Desconectar', cancelText: 'Cancelar' }
          );
      });
  }
}
