// =============================================
// Página: Clientes
// =============================================
import { getClientes, addCliente, updateCliente, removeCliente, formatBRL, getInitials, type Cliente } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm, sanitizeUrl } from '../router';
import { openCSVSelector } from '../lib/csv';

export async function renderClientes(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const clientes = await getClientes();
    renderContent(container, clientes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}

function renderContent(container: HTMLElement, clientes: Cliente[], filter = 'todos'): void {
  const filtered = filter === 'todos' ? clientes : clientes.filter(c => c.status === filter);
  const ativos = clientes.filter(c => c.status === 'ativo').length;

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Gestão de Clientes</h1>
        <p>${clientes.length} clientes cadastrados • ${ativos} ativos</p>
      </div>
      <div class="header-actions">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <button class="btn-secondary" id="btn-import-csv"><i class="ph ph-file-csv"></i> Importar CSV</button>
          <span id="btn-info-csv" data-tooltip="Formato CSV: Clique para ver as colunas" data-tooltip-dir="bottom" style="display:flex; align-items:center; cursor:pointer;">
            <i class="ph ph-info icon-primary-hover" style="font-size:1.2rem;"></i>
          </span>
        </div>
        <button class="btn-primary" id="btn-add-cliente"><i class="ph ph-plus"></i> Novo Cliente</button>
      </div>
    </header>

    <div class="filter-bar animate-up">
      ${['todos', 'ativo', 'pausado', 'encerrado'].map(f =>
        `<button class="filter-btn ${f === filter ? 'active' : ''}" data-filter="${f}">${f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}</button>`
      ).join('')}
    </div>

    <div class="card animate-up">
      <table class="data-table">
        <thead><tr>
          <th>Cliente / Empresa</th>
          <th>Plano</th>
          <th>Contato</th>
          <th>Valor Mensal</th>
          <th>Status</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">Nenhum cliente encontrado.</td></tr>' :
            filtered.map(c => `
              <tr>
                <td data-label="Cliente / Empresa"><div style="display:flex;align-items:center;gap:0.75rem">
                  <div class="avatar" style="background:${c.cor}">${getInitials(c.nome)}</div>
                  <a href="#/cliente/${c.id}" class="client-link"><strong>${c.nome}</strong></a>
                   ${(() => { const notionUrl = sanitizeUrl(c.notion_page_url || ''); return notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" title="Abrir no Notion" class="notion-icon-link"><i class="ph ph-notion-logo"></i></a>` : ''; })()}
                </div></td>
                <td data-label="Plano">${c.plano}</td>
                <td data-label="Contato">${c.email}<br><span style="font-size:0.75rem;color:var(--text-muted)">${c.telefone}</span></td>
                <td data-label="Valor Mensal">${formatBRL(Number(c.valor_mensal))}</td>
                <td data-label="Status"><span class="badge badge-${c.status === 'ativo' ? 'success' : c.status === 'pausado' ? 'warning' : 'neutral'}">${c.status}</span></td>
                <td data-label="Ações" style="text-align: right;">
                  <button class="btn-icon btn-edit" data-id="${c.id}"><i class="ph ph-pencil-simple"></i></button>
                  <button class="btn-icon btn-remove" style="color:var(--danger)" data-id="${c.id}"><i class="ph ph-trash"></i></button>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // --- Filters ---
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(container, clientes, (btn as HTMLElement).dataset.filter || 'todos');
    });
  });

  // --- Modal Form Helper ---
  const openClienteModal = (cliente?: Cliente) => {
    const isEditing = !!cliente;
    openModal(isEditing ? 'Editar Cliente' : 'Novo Cliente', `
      <div class="form-row">
        <div class="form-group"><label>Nome da Empresa</label>
        <input name="nome" class="form-input" required value="${cliente?.nome || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>E-mail</label>
        <input name="email" type="email" class="form-input" value="${cliente?.email || ''}"></div>
        <div class="form-group"><label>Telefone</label>
        <input name="telefone" class="form-input" value="${cliente?.telefone || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Plano / Serviço</label>
        <input name="plano" class="form-input" value="${cliente?.plano || ''}"></div>
        <div class="form-group"><label>Valor Mensal</label>
        <input name="valor_mensal" type="number" step="0.01" class="form-input" value="${cliente?.valor_mensal || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>URL da Página Notion (Opcional)</label>
        <input name="notion_page_url" type="url" class="form-input" placeholder="https://notion.so/..." value="${cliente?.notion_page_url || ''}"></div>
        <div class="form-group"><label>Dia de Pagamento (Data Base)</label>
        <input name="data_pagamento" type="number" min="1" max="31" class="form-input" placeholder="Ex: 5" value="${cliente?.data_pagamento || ''}"></div>
      </div>
      ${isEditing ? `
      <div class="form-row">
        <div class="form-group"><label>Status</label>
          <select name="status" class="form-input">
            <option value="ativo" ${cliente.status === 'ativo' ? 'selected' : ''}>Ativo</option>
            <option value="pausado" ${cliente.status === 'pausado' ? 'selected' : ''}>Pausado</option>
            <option value="encerrado" ${cliente.status === 'encerrado' ? 'selected' : ''}>Encerrado</option>
          </select>
        </div>
      </div>` : ''}
    `, async (form) => {
      const d = new FormData(form);
      const nome = d.get('nome') as string;
      if (!nome) { showToast('Nome é obrigatório.', 'error'); return; }

      try {
        const payload: any = {
          nome,
          email: d.get('email') as string || '',
          telefone: d.get('telefone') as string || '',
          plano: d.get('plano') as string || '',
          valor_mensal: parseFloat(d.get('valor_mensal') as string) || 0,
          notion_page_url: d.get('notion_page_url') as string || '',
          data_pagamento: parseInt(d.get('data_pagamento') as string) || undefined,
        };
        
        if (isEditing) {
          payload.status = d.get('status') as string;
          await updateCliente(cliente.id!, payload);
          showToast(`Cliente '${nome}' atualizado!`);
        } else {
          const colors = ['#e74c3c', '#8e44ad', '#27ae60', '#2980b9', '#d35400', '#16a085'];
          payload.sigla = getInitials(nome);
          payload.cor = colors[Math.floor(Math.random() * colors.length)];
          payload.status = 'ativo';
          await addCliente(payload);
          showToast(`Cliente '${nome}' adicionado!`);
        }
        
        closeModal();
        navigate('/clientes');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro';
        showToast('Erro: ' + message, 'error');
      }
    });
  };

  // --- Add ---
  container.querySelector('#btn-add-cliente')?.addEventListener('click', () => {
    openClienteModal();
  });

  // --- Info CSV ---
  container.querySelector('#btn-info-csv')?.addEventListener('click', () => {
    openModal('Formato Esperado do CSV', `
      <div style="color:var(--text-muted); line-height:1.6; font-size:0.95rem;">
        <p>A primeira linha do arquivo (cabeçalho) deve conter <strong>exatamente</strong> as colunas abaixo:</p>
        <ul style="margin: 1rem 1.5rem; background: var(--surface-hover); padding: 1rem 2rem; border-radius: 8px;">
          <li><code style="color:var(--primary-color);">nome</code>: Nome da empresa (Obrigatório)</li>
          <li><code style="color:var(--primary-color);">email</code>: E-mail de contato</li>
          <li><code style="color:var(--primary-color);">telefone</code>: Número de telefone</li>
          <li><code style="color:var(--primary-color);">plano</code>: Texto ou Nome do Plano</li>
          <li><code style="color:var(--primary-color);">valor_mensal</code>: Numeral (ex: 1500.00)</li>
          <li><code style="color:var(--primary-color);">status</code>: <span style="font-size:0.8rem">ativo | pausado | encerrado</span></li>
          <li><code style="color:var(--primary-color);">notion_page_url</code>: Link (Opcional)</li>
          <li><code style="color:var(--primary-color);">data_pagamento</code>: Dia do Mês (Numeral 1 a 31)</li>
        </ul>
        <p style="font-size:0.8rem; margin-top:0.5rem;"><i class="ph ph-warning-circle"></i> O separador do CSV deve ser a vírgula (<code>,</code>).</p>
      </div>
    `, undefined, { hideSubmit: true });
  });

  // --- Import CSV ---
  container.querySelector('#btn-import-csv')?.addEventListener('click', () => {
    openCSVSelector(async (rows) => {
      showToast(`Processando ${rows.length} clientes...`, 'info');
      let successCount = 0;
      
      const colors = ['#e74c3c', '#8e44ad', '#27ae60', '#2980b9', '#d35400', '#16a085'];
      
      for (const row of rows) {
        if (!row.nome) continue;
        try {
          await addCliente({
            nome: row.nome,
            email: row.email || '',
            telefone: row.telefone || '',
            plano: row.plano || '',
            valor_mensal: parseFloat(row.valor_mensal) || 0,
            status: (row.status?.toLowerCase() as any) || 'ativo',
            sigla: getInitials(row.nome),
            cor: colors[Math.floor(Math.random() * colors.length)],
            notion_page_url: row.notion_page_url || '',
            data_pagamento: parseInt(row.data_pagamento) || undefined
          });
          successCount++;
        } catch (e) {
          console.warn('Erro ao importar linha:', row, e);
        }
      }
      
      showToast(`${successCount} clientes importados com sucesso!`, 'success');
      navigate('/clientes'); // Refresh list
    }, (err) => {
      showToast('Erro no CSV: ' + err.message, 'error');
    });
  });

  // --- Edit ---
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const cliente = clientes.find(c => c.id === id);
      if (cliente) openClienteModal(cliente);
    });
  });

  // --- Remove ---
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      openConfirm('Remover Cliente', 'Remover este cliente? Esta ação não pode ser desfeita.', async () => {
        try {
          await removeCliente(Number((btn as HTMLElement).dataset.id));
          showToast('Cliente removido.');
          navigate('/clientes');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }, true);
    });
  });
}
