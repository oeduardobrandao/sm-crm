// =============================================
// Página: Integrações
// =============================================
import { getIntegrationsMeta, getIntegracoesStatus, toggleIntegracao, getClientes } from '../store';
import { showToast, navigate } from '../router';

export async function renderIntegracoes(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const [meta, statuses, clientes] = await Promise.all([
      getIntegrationsMeta(),
      getIntegracoesStatus(),
      getClientes()
    ]);

    const statusMap: Record<string, string> = {};
    statuses.forEach(s => { statusMap[s.integracao_id] = s.status; });

    const notionConnected = statusMap['notion'] === 'conectado';
    const notionClientes = clientes.filter(c => c.notion_page_url);

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
            <div class="card integration-card" style="display:flex;flex-direction:column;justify-content:space-between;min-height:180px">
              <div style="display:flex;align-items:flex-start;gap:1.25rem;margin-bottom:1.5rem">
                <div style="width:56px;height:56px;border-radius:16px;background:${connected ? 'rgba(22, 163, 74, 0.2)' : 'var(--surface-hover)'};display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:${connected ? '#22c55e' : 'var(--text-muted)'}">
                  <i class="${int.icon}"></i>
                </div>
                <div>
                  <h3 style="margin:0;font-size:1.1rem;color:var(--text-main);margin-bottom:0.25rem">${int.label}</h3>
                  <p style="font-size:0.85rem;color:var(--text-muted);line-height:1.4">${int.desc}</p>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto">
                <span class="badge badge-${connected ? 'success' : 'neutral'}">${connected ? 'Conectado' : 'Desconectado'}</span>
                <button class="btn-secondary btn-toggle-int" data-id="${int.integracao_id}" data-status="${status}" style="${connected ? 'color:var(--danger);border-color:var(--danger)' : 'color:var(--primary-color);border-color:var(--primary-color)'}">
                  ${connected ? '<i class="fa-solid fa-link-slash"></i> Desconectar' : '<i class="fa-solid fa-link"></i> Conectar'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      ${notionConnected ? `
        <div class="card animate-up" style="margin-top:2rem">
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
            <div style="width:40px;height:40px;border-radius:10px;background:var(--surface-hover);display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--text-main)">
              <i class="fa-solid fa-book"></i>
            </div>
            <div>
              <h3 style="margin:0">Acesso Rápido - Notion</h3>
              <p style="font-size:0.85rem;color:var(--text-muted);margin-top:0.2rem">Páginas de clientes vinculadas ao Notion.</p>
            </div>
          </div>
          
          <div class="client-list">
            ${notionClientes.length === 0 ? `
              <div style="padding:2rem;text-align:center;color:var(--text-muted);background:var(--surface-main);border-radius:12px;border:1px dashed var(--border-color)">
                <i class="fa-solid fa-circle-info" style="font-size:1.5rem;margin-bottom:0.5rem;color:var(--text-light)"></i>
                <p>Nenhum cliente possui uma página do Notion vinculada.</p>
                <p style="font-size:0.8rem;margin-top:0.25rem">Edite um cliente na aba <strong>Clientes</strong> e adicione a URL da página.</p>
              </div>
            ` : notionClientes.map(c => `
              <div class="client-row" style="background:var(--surface-main);padding:1rem 1.25rem;border-radius:12px;margin-bottom:0.5rem;border:1px solid var(--border-color)">
                <div style="display:flex;align-items:center;gap:1rem">
                  <div class="avatar" style="background:${c.cor};width:32px;height:32px;font-size:0.8rem">${c.sigla}</div>
                  <div>
                    <strong style="display:block;color:var(--text-main);font-size:0.95rem">${c.nome}</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted)">${c.plano || 'Sem plano definido'}</span>
                  </div>
                </div>
                <a href="${c.notion_page_url}" target="_blank" class="btn-primary" style="text-decoration:none;padding:0.5rem 1rem;font-size:0.8rem">
                  Abrir Página <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.75rem"></i>
                </a>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
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
