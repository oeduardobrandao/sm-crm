// =============================================
// CRM Fluxo - Instagram Overview Card Component
// =============================================
import { syncInstagramData, disconnectInstagram } from '../../services/instagram';
import { showToast } from '../../router';
import { formatDate } from '../../store';

export function renderInstagramOverviewCard(container: HTMLElement, clientId: number, account: any, onRefresh: () => void) {
  container.innerHTML = `
    <div class="card animate-up" style="position: relative;">
      <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem;">
         <button id="btn-ig-sync" class="btn-icon" data-tooltip="Sincronizar Dados" style="color: var(--text-muted);"><i class="ph ph-arrows-clockwise"></i></button>
         <button id="btn-ig-disconnect" class="btn-icon" data-tooltip="Desconectar" style="color: var(--danger);"><i class="ph ph-plugs"></i></button>
      </div>
      
      <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
         <img src="${account.profile_picture_url || 'https://ui-avatars.com/api/?name=IG&background=random'}" alt="IG Profile" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border-color);" />
         <div>
            <h3 style="display: flex; align-items: center; gap: 0.5rem;">
                ${account.username || 'Conta Instagram'} 
                <i class="fa-brands fa-instagram" style="color: #E1306C; font-size: 1.2rem;"></i>
            </h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Atualizado em ${formatDate(account.last_synced_at || account.updated_at)}</p>
         </div>
      </div>

      <div class="kpi-grid">
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

      <h4 style="margin-bottom: 1rem; margin-top: 1rem; font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase;">Métricas (Últimos 28 Dias)</h4>
      <div class="client-info-grid">
         <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-users"></i> Contas Alcançadas</span>
            <span class="client-info-value">${account.reach_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-eye"></i> Impressões</span>
            <span class="client-info-value">${account.impressions_28d?.toLocaleString('pt-BR') || 0}</span>
         </div>
         <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-user-focus"></i> Visitas ao Perfil</span>
            <span class="client-info-value">${account.profile_views_28d?.toLocaleString('pt-BR') || 0}</span>
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
      btnDisconnect.addEventListener('click', async () => {
          if (!confirm('Tem certeza que deseja desconectar esta conta do Instagram? Os dados históricos serão mantidos, mas a sincronização será interrompida.')) {
              return;
          }
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
      });
  }
}
