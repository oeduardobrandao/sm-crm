// =============================================
// Página: Integrações
// =============================================
import { getIntegrationsMeta, getIntegracoesStatus, toggleIntegracao } from '../store';
import { showToast, navigate } from '../router';

export async function renderIntegracoes(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const meta = getIntegrationsMeta();
    const statuses = await getIntegracoesStatus();

    const statusMap: Record<string, string> = {};
    statuses.forEach(s => { statusMap[s.integracao_id] = s.status; });

    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title">
          <h1>Integrações</h1>
          <p>Conecte ferramentas externas ao CRM.</p>
        </div>
      </header>

      <div class="integrations-grid animate-up">
        ${meta.map(int => {
          const status = statusMap[int.integracao_id] || 'desconectado';
          const connected = status === 'conectado';
          return `
            <div class="card integration-card">
              <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
                <div style="width:48px;height:48px;border-radius:12px;background:${connected ? '#dcfce7' : '#f1f5f9'};display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:${connected ? '#16a34a' : '#64748b'}">
                  <i class="${int.icon}"></i>
                </div>
                <div>
                  <h4 style="margin:0">${int.label}</h4>
                  <span style="font-size:0.8rem;color:var(--text-muted)">${int.desc}</span>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="badge badge-${connected ? 'success' : 'neutral'}">${connected ? 'Conectado' : 'Desconectado'}</span>
                <button class="btn-integration btn-toggle-int" data-id="${int.integracao_id}" data-status="${status}">
                  ${connected ? '<i class="fa-solid fa-link-slash"></i> Desconectar' : '<i class="fa-solid fa-link"></i> Conectar'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-toggle-int').forEach(btn => {
      btn.addEventListener('click', async () => {
        const intId = (btn as HTMLElement).dataset.id!;
        const currentStatus = (btn as HTMLElement).dataset.status!;
        const newStatus = currentStatus === 'conectado' ? 'desconectado' : 'conectado';

        try {
          await toggleIntegracao(intId, newStatus as 'conectado' | 'desconectado');
          showToast(newStatus === 'conectado' ? 'Integração conectada!' : 'Integração desconectada.', newStatus === 'conectado' ? 'success' : 'info');
          navigate('/integracoes');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      });
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}
