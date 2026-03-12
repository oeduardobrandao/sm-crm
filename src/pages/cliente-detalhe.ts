// =============================================
// Página: Detalhe do Cliente
// =============================================
import { getClientes, getTransacoes, getContratos, formatBRL, formatDate, getInitials, updateCliente, getWorkflowsByCliente, getWorkflowEtapas, getDeadlineInfo, getMembros, completeEtapa, duplicateWorkflow, type Cliente, type Workflow, type WorkflowEtapa, type Membro } from '../store';
import { showToast, navigate, openModal, closeModal, sanitizeUrl, escapeHTML, openConfirm } from '../router';
import { getInstagramSummary, getInstagramPosts, syncInstagramData } from '../services/instagram';
import { renderInstagramConnectButton } from '../components/instagram/InstagramConnectButton';
import { renderInstagramOverviewCard } from '../components/instagram/InstagramOverviewCard';
import { renderInstagramFollowerChart } from '../components/instagram/InstagramFollowerChart';
import { renderInstagramPostsTable } from '../components/instagram/InstagramPostsTable';

export async function renderClienteDetalhe(container: HTMLElement, param?: string): Promise<void> {
  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title" style="display:flex;align-items:center;gap:1.25rem">
        <div class="skeleton skeleton-circle" style="width:56px;height:56px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-heading" style="width:180px"></div>
          <div class="skeleton skeleton-text-sm" style="width:120px"></div>
        </div>
      </div>
    </header>
    <div class="card animate-up" style="margin-bottom:1.5rem">
      <div style="display:flex;align-items:center;gap:1.5rem;margin-bottom:1.5rem">
        <div class="skeleton skeleton-circle" style="width:80px;height:80px;flex-shrink:0"></div>
        <div style="flex:1"><div class="skeleton skeleton-heading" style="width:160px"></div><div class="skeleton skeleton-text-sm" style="width:200px"></div></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
        <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
        <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
      </div>
    </div>
    <div class="kpi-grid animate-up" style="margin-bottom:2rem">
      <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:40%"></div></div>
      <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:40%"></div></div>
      <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:40%"></div></div>
    </div>
    <div class="card animate-up" style="margin-bottom:2rem">
      <div class="skeleton skeleton-heading" style="width:140px;margin-bottom:1.25rem"></div>
      <div class="skeleton skeleton-text" style="width:90%"></div>
      <div class="skeleton skeleton-text" style="width:75%"></div>
      <div class="skeleton skeleton-text" style="width:60%"></div>
    </div>
  `;

  if (!param) {
    navigate('/clientes');
    return;
  }

  const clienteId = parseInt(param, 10);
  if (isNaN(clienteId) || clienteId <= 0) {
    navigate('/clientes');
    return;
  }

  // Check URL params for IG Auth redirects (params are inside the hash fragment)
  const hashQuery = window.location.hash.split('?')[1];
  const urlParams = new URLSearchParams(hashQuery || '');
  if (urlParams.get('ig_error') === 'no_business_account') {
     setTimeout(() => showToast('A conta do Facebook não possui um Instagram Business/Creator associado. Converta a conta primeiro.', 'error'), 500);
     window.history.replaceState({}, document.title, window.location.pathname + window.location.hash.split('?')[0]);
  }

  try {
    const [clientes, transacoes, contratos, igSummary, clienteWorkflows, membros] = await Promise.all([
      getClientes(),
      getTransacoes(),
      getContratos(),
      getInstagramSummary(clienteId).catch(() => null),
      getWorkflowsByCliente(clienteId),
      getMembros(),
    ]);

    const cliente = clientes.find((c: Cliente) => c.id === clienteId);
    if (!cliente) {
      container.innerHTML = `
        <header class="header animate-up">
          <div class="header-title">
            <h1>Cliente não encontrado</h1>
            <p>O cliente solicitado não existe ou foi removido.</p>
          </div>
          <button class="btn-secondary" onclick="window.location.hash='#/clientes'"><i class="ph ph-arrow-left"></i> Voltar</button>
        </header>`;
      return;
    }

    const clienteTransacoes = transacoes.filter(t => t.cliente_id === clienteId);
    const clienteContratos = contratos.filter(c => c.cliente_id === clienteId);

    const totalRecebido = clienteTransacoes
      .filter(t => t.tipo === 'entrada' && t.status === 'pago')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const totalPendente = clienteTransacoes
      .filter(t => t.tipo === 'entrada' && t.status === 'agendado')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title" style="display:flex;align-items:center;gap:1.25rem">
          <div class="avatar" style="background:${cliente.cor};width:56px;height:56px;font-size:1.3rem">${getInitials(cliente.nome)}</div>
          <div>
            <h1 style="margin-bottom:0.25rem">${cliente.nome}</h1>
            <p style="display:flex;align-items:center;gap:0.75rem">
              ${cliente.plano ? `<span>${cliente.plano}</span>` : ''}
              <span class="badge badge-${cliente.status === 'ativo' ? 'success' : cliente.status === 'pausado' ? 'warning' : 'neutral'}">${cliente.status}</span>
            </p>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button class="btn-secondary" id="btn-back"><i class="ph ph-arrow-left"></i> Voltar</button>
          <button class="btn-primary" id="btn-edit-cliente"><i class="ph ph-pencil-simple"></i> Editar</button>
        </div>
      </header>

      <!-- Instagram Integration Region -->
      <div id="ig-container" class="animate-up" style="margin-bottom: 2rem;"></div>

      <!-- Fluxos de Entrega -->
      <div id="wf-section" class="wf-progress-section animate-up"></div>


      <!-- KPI Cards -->
      <div class="kpi-grid animate-up" style="margin-bottom:2rem">
        <div class="kpi-card">
          <span class="kpi-label">VALOR MENSAL</span>
          <span class="kpi-value">${formatBRL(Number(cliente.valor_mensal))}</span>
          <span class="kpi-sub" style="color:var(--primary-color)">Contrato ativo</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">TOTAL RECEBIDO</span>
          <span class="kpi-value">${formatBRL(totalRecebido)}</span>
          <span class="kpi-sub" style="color:var(--success)">↑ ${clienteTransacoes.filter(t => t.tipo === 'entrada' && t.status === 'pago').length} entradas pagas</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">PENDENTE</span>
          <span class="kpi-value">${formatBRL(totalPendente)}</span>
          <span class="kpi-sub" style="color:var(--warning)">◉ ${clienteTransacoes.filter(t => t.status === 'agendado').length} agendadas</span>
        </div>
      </div>

      <!-- Info Card -->
      <div class="card animate-up" style="margin-bottom:2rem">
        <h3 style="margin-bottom:1.25rem"><i class="ph ph-identification-card" style="margin-right:0.5rem;color:var(--primary-color)"></i> Informações</h3>
        <div class="client-info-grid">
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-envelope"></i> E-mail</span>
            <span class="client-info-value">${cliente.email || '—'}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-phone"></i> Telefone</span>
            <span class="client-info-value">${cliente.telefone || '—'}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-calendar-blank"></i> Dia de Pagamento</span>
            <span class="client-info-value">${cliente.data_pagamento ? 'Dia ' + cliente.data_pagamento : '—'}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-notebook"></i> Notion</span>
            <span class="client-info-value">${(() => { const notionUrl = sanitizeUrl(cliente.notion_page_url || ''); return notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-color)">Abrir página <i class="ph ph-arrow-square-out"></i></a>` : '—'; })()}</span>
          </div>
        </div>
      </div>

      <!-- Contratos -->
      <div class="card animate-up" style="margin-bottom:2rem">
        <h3 style="margin-bottom:1.25rem"><i class="ph ph-file-text" style="margin-right:0.5rem;color:var(--primary-color)"></i> Contratos (${clienteContratos.length})</h3>
        ${clienteContratos.length === 0 ? '<p style="color:var(--text-muted);font-size:0.9rem">Nenhum contrato vinculado a este cliente.</p>' : `
        <table class="data-table">
          <thead><tr><th>Contrato</th><th>Período</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            ${clienteContratos.map(c => `
              <tr>
                <td data-label="Contrato"><strong>${c.titulo}</strong></td>
                <td data-label="Período">${formatDate(c.data_inicio)} → ${formatDate(c.data_fim)}</td>
                <td data-label="Valor">${formatBRL(Number(c.valor_total))}</td>
                <td data-label="Status"><span class="badge badge-${c.status === 'vigente' ? 'success' : c.status === 'a_assinar' ? 'warning' : 'neutral'}">${c.status === 'a_assinar' ? 'A Assinar' : c.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>

      <!-- Transações -->
      <div class="card animate-up">
        <h3 style="margin-bottom:1.25rem"><i class="ph ph-currency-circle-dollar" style="margin-right:0.5rem;color:var(--primary-color)"></i> Movimentações (${clienteTransacoes.length})</h3>
        ${clienteTransacoes.length === 0 ? '<p style="color:var(--text-muted);font-size:0.9rem">Nenhuma movimentação vinculada a este cliente.</p>' : `
        <table class="data-table">
          <thead><tr><th>Descrição</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            ${clienteTransacoes.map(t => `
              <tr>
                <td data-label="Descrição"><strong>${t.descricao}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">${t.categoria}</span></td>
                <td data-label="Data">${formatDate(t.data)}</td>
                <td data-label="Valor" style="color:${t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">${t.tipo === 'entrada' ? '+' : '-'} ${formatBRL(Number(t.valor))}</td>
                <td data-label="Status"><span class="badge badge-${t.status === 'pago' ? 'success' : 'warning'}">${t.status === 'pago' ? 'Pago' : 'Agendado'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
    `;

    // Instagram Integration Render
    const igContainer = container.querySelector('#ig-container') as HTMLElement;
    if (igContainer) {
      if (igSummary) {
         // Auto-sync on first connection (no data yet)
         if (!igSummary.account.last_synced_at) {
           igContainer.innerHTML = `
             <div class="card animate-up" style="margin-bottom:1.5rem;">
               <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;color:var(--text-muted);font-size:0.9rem;">
                 <i class="ph ph-spinner ph-spin" style="font-size:1.1rem;color:#E1306C"></i>
                 Sincronizando dados do Instagram pela primeira vez...
               </div>
               <div style="display:flex;align-items:center;gap:1.5rem;margin-bottom:1.5rem">
                 <div class="skeleton skeleton-circle" style="width:80px;height:80px;flex-shrink:0"></div>
                 <div style="flex:1"><div class="skeleton skeleton-heading" style="width:160px"></div><div class="skeleton skeleton-text-sm" style="width:200px"></div></div>
               </div>
               <div class="kpi-grid" style="margin-bottom:1.5rem">
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:60%"></div><div class="skeleton skeleton-heading" style="width:50%"></div></div>
               </div>
               <div class="kpi-grid">
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:45%"></div></div>
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:45%"></div></div>
                 <div class="kpi-card"><div class="skeleton skeleton-text-sm" style="width:70%"></div><div class="skeleton skeleton-heading" style="width:45%"></div></div>
               </div>
             </div>`;
           try {
             await syncInstagramData(clienteId);
             renderClienteDetalhe(container, param);
           } catch (syncErr: any) {
             igContainer.innerHTML = `
               <div class="card animate-up" style="margin-bottom:1.5rem;">
                 <div style="display:flex;align-items:center;gap:0.75rem;color:var(--text-muted);font-size:0.9rem;">
                   <i class="ph ph-warning" style="font-size:1.1rem;color:#E1306C"></i>
                   Erro ao sincronizar dados do Instagram. <a href="#" onclick="location.reload();return false;">Tentar novamente</a>
                 </div>
               </div>`;
           }
           return;
         }

         // Render Connected UI
         const summaryWrapper = document.createElement('div');
         renderInstagramOverviewCard(summaryWrapper, clienteId, igSummary.account, () => {
             // onRefresh -> reload page
             renderClienteDetalhe(container, param);
         });
         igContainer.appendChild(summaryWrapper);
         
         const chartWrapper = document.createElement('div');
         renderInstagramFollowerChart(chartWrapper, igSummary.history);
         igContainer.appendChild(chartWrapper);


         const postsWrapper = document.createElement('div');
         renderInstagramPostsTable(postsWrapper, clienteId);
         igContainer.appendChild(postsWrapper);

         // Analytics link
         const analyticsLink = document.createElement('div');
         analyticsLink.style.cssText = 'text-align:center;margin-top:1rem;margin-bottom:0.5rem';
         analyticsLink.innerHTML = `<a href="#/analytics-conta/${clienteId}" class="btn-primary" style="display:inline-flex;align-items:center;gap:0.5rem"><i class="ph ph-chart-line-up"></i> Ver Analytics Completo</a>`;
         igContainer.appendChild(analyticsLink);
      } else {
         // Render Unconnected UI
         renderInstagramConnectButton(igContainer, clienteId);
      }
    }

    // ---- Workflow Section ----
    const wfSection = container.querySelector('#wf-section') as HTMLElement;
    if (wfSection && clienteWorkflows.length > 0) {
      const activeWfs = clienteWorkflows.filter(w => w.status === 'ativo');
      const doneWfs = clienteWorkflows.filter(w => w.status === 'concluido');

      // Fetch etapas for active workflows
      const wfEtapasMap = new Map<number, WorkflowEtapa[]>();
      await Promise.all(activeWfs.map(async w => {
        const etapas = await getWorkflowEtapas(w.id!);
        wfEtapasMap.set(w.id!, etapas);
      }));

      let html = `<div class="card"><h3 style="margin-bottom:1.25rem"><i class="ph ph-kanban" style="margin-right:0.5rem;color:var(--primary-color)"></i> Fluxos de Entrega (${activeWfs.length} ativo${activeWfs.length !== 1 ? 's' : ''}${doneWfs.length ? `, ${doneWfs.length} concluído${doneWfs.length !== 1 ? 's' : ''}` : ''})</h3>`;

      if (activeWfs.length === 0) {
        html += `<p style="color:var(--text-muted);font-size:0.9rem">Nenhum fluxo ativo para este cliente.</p>`;
      } else {
        for (const wf of activeWfs) {
          const etapas = wfEtapasMap.get(wf.id!) || [];
          const activeEtapa = etapas.find(e => e.status === 'ativo');
          const dl = activeEtapa ? getDeadlineInfo(activeEtapa) : null;
          const resp = activeEtapa?.responsavel_id ? membros.find(m => m.id === activeEtapa.responsavel_id) : null;
          const dlClass = dl?.estourado ? 'color:var(--danger)' : dl?.urgente ? 'color:var(--warning)' : 'color:var(--primary-color)';
          const dlText = dl ? (dl.estourado ? `${Math.abs(dl.diasRestantes)}d atrasado` : dl.diasRestantes === 0 ? 'Vence hoje' : `${dl.diasRestantes}d restantes`) : '';

          html += `
          <div class="wf-flow-card">
            <div class="wf-flow-header">
              <span class="wf-flow-title">${wf.titulo} ${wf.recorrente ? '<i class="ph ph-arrows-clockwise" style="font-size:0.75rem;color:var(--text-muted)" title="Recorrente"></i>' : ''}</span>
              ${activeEtapa ? `<button class="filter-btn wf-complete-btn" data-wid="${wf.id}" data-eid="${activeEtapa.id}" style="width:auto"><i class="ph ph-check-circle"></i> Concluir</button>` : ''}
            </div>
            <div class="wf-steps-row">
              ${etapas.map(e => `<div class="wf-step-pill ${e.status === 'concluido' ? 'done' : e.status === 'ativo' ? 'active' : ''}" title="${e.nome}"></div>`).join('')}
            </div>
            <div class="wf-step-info">
              ${activeEtapa ? `<span><strong>${activeEtapa.nome}</strong></span>` : '<span>Concluído</span>'}
              ${dlText ? `<span style="${dlClass};font-weight:600"><i class="ph ph-clock"></i> ${dlText}</span>` : ''}
              ${resp ? `<span><i class="ph ph-user"></i> ${resp.nome}</span>` : ''}
            </div>
          </div>`;
        }
      }

      html += `<div style="margin-top:0.75rem"><a href="#/entregas" style="font-size:0.85rem;color:var(--primary-color)"><i class="ph ph-arrow-right"></i> Ver todos os fluxos</a></div></div>`;
      wfSection.innerHTML = html;

      // Complete etapa buttons
      wfSection.querySelectorAll('.wf-complete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const wid = Number((btn as HTMLElement).dataset.wid);
          const eid = Number((btn as HTMLElement).dataset.eid);
          try {
            const result = await completeEtapa(wid, eid);
            if (result.workflow.status === 'concluido') {
              showToast('Fluxo concluído! 🎉');
              const wf = clienteWorkflows.find(w => w.id === wid);
              if (wf?.recorrente) {
                openConfirm('Fluxo Recorrente', 'Criar um novo ciclo com as mesmas etapas?', async () => {
                  try {
                    await duplicateWorkflow(wid);
                    showToast('Novo ciclo criado!');
                    navigate('/cliente/' + clienteId);
                  } catch { showToast('Erro ao duplicar.', 'error'); }
                });
              } else {
                navigate('/cliente/' + clienteId);
              }
            } else {
              showToast('Etapa concluída!');
              navigate('/cliente/' + clienteId);
            }
          } catch (err) {
            showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
          }
        });
      });
    }

    // Back button
    container.querySelector('#btn-back')?.addEventListener('click', () => {
      navigate('/clientes');
    });

    // Edit button
    container.querySelector('#btn-edit-cliente')?.addEventListener('click', () => {
      openModal('Editar Cliente', `
        <div class="form-row">
          <div class="form-group"><label>Nome da Empresa</label>
          <input name="nome" class="form-input" required value="${escapeHTML(cliente.nome)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>E-mail</label>
          <input name="email" type="email" class="form-input" value="${escapeHTML(cliente.email || '')}"></div>
          <div class="form-group"><label>Telefone</label>
          <input name="telefone" class="form-input" value="${escapeHTML(cliente.telefone || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Plano / Serviço</label>
          <input name="plano" class="form-input" value="${escapeHTML(cliente.plano || '')}"></div>
          <div class="form-group"><label>Valor Mensal</label>
          <input name="valor_mensal" type="number" step="0.01" class="form-input" value="${escapeHTML(String(cliente.valor_mensal || ''))}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>URL da Página Notion (Opcional)</label>
          <input name="notion_page_url" type="url" class="form-input" placeholder="https://notion.so/..." value="${escapeHTML(cliente.notion_page_url || '')}"></div>
          <div class="form-group"><label>Dia de Pagamento (Data Base)</label>
          <input name="data_pagamento" type="number" min="1" max="31" class="form-input" placeholder="Ex: 5" value="${escapeHTML(String(cliente.data_pagamento || ''))}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Status</label>
            <select name="status" class="form-input">
              <option value="ativo" ${cliente.status === 'ativo' ? 'selected' : ''}>Ativo</option>
              <option value="pausado" ${cliente.status === 'pausado' ? 'selected' : ''}>Pausado</option>
              <option value="encerrado" ${cliente.status === 'encerrado' ? 'selected' : ''}>Encerrado</option>
            </select>
          </div>
          <div class="form-group"><label>Especialidade</label>
          <input name="especialidade" class="form-input" placeholder="Ex: Dermatologia, Cardiologia" value="${escapeHTML(cliente.especialidade || '')}"></div>
        </div>
      `, async (form) => {
        const d = new FormData(form);
        const nome = d.get('nome') as string;
        if (!nome) { showToast('Nome é obrigatório.', 'error'); return; }

        try {
          await updateCliente(cliente.id!, {
            nome,
            email: d.get('email') as string || '',
            telefone: d.get('telefone') as string || '',
            plano: d.get('plano') as string || '',
            valor_mensal: parseFloat(d.get('valor_mensal') as string) || 0,
            notion_page_url: d.get('notion_page_url') as string || '',
            data_pagamento: parseInt(d.get('data_pagamento') as string) || undefined,
            status: d.get('status') as 'ativo' | 'pausado' | 'encerrado',
            especialidade: d.get('especialidade') as string || '',
          });
          showToast(`Cliente '${nome}' atualizado!`);
          closeModal();
          navigate('/cliente/' + clienteId);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      });
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${escapeHTML(message)}</p></div>`;
  }
}
