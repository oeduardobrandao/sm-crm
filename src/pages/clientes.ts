// =============================================
// Página: Clientes
// =============================================
import { getClientes, addCliente, updateCliente, removeCliente, formatBRL, getInitials, type Cliente } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm, sanitizeUrl, escapeHTML } from '../router';
import { openCSVSelector } from '../lib/csv';
import { supabase } from '../lib/supabase';

// Map client_id -> profile_picture_url from instagram_accounts
let igAvatars: Map<number, string> = new Map();

async function loadIgAvatars(clientIds: number[]): Promise<void> {
  if (clientIds.length === 0) return;
  const { data } = await supabase
    .from('instagram_accounts')
    .select('client_id, profile_picture_url')
    .in('client_id', clientIds)
    .not('profile_picture_url', 'is', null);
  igAvatars = new Map((data || []).map((r: any) => [r.client_id, r.profile_picture_url]));
}

export async function renderClientes(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const clientes = await getClientes();
    await loadIgAvatars(clientes.filter(c => c.id).map(c => c.id!));
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
                  ${igAvatars.has(c.id!) ? `<img src="${escapeHTML(igAvatars.get(c.id!)!)}" alt="" class="avatar ig-avatar" data-bg="${c.cor}" data-initials="${escapeHTML(getInitials(c.nome))}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : `<div class="avatar" style="background:${c.cor}">${getInitials(c.nome)}</div>`}
                  <a href="#/cliente/${c.id}" class="client-link"><strong>${c.nome}</strong></a>
                   ${(() => { const notionUrl = sanitizeUrl(c.notion_page_url || ''); return notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" title="Abrir no Notion" class="notion-icon-link"><i class="ph ph-notion-logo"></i></a>` : ''; })()}
                </div></td>
                <td data-label="Plano">${c.plano}</td>
                <td data-label="Contato" class="td-contato">
                  ${c.email ? `<span class="contato-item">${c.email}</span>` : ''}
                  ${c.telefone ? `<span class="contato-item contato-phone">${c.telefone}</span>` : ''}
                </td>
                <td data-label="Valor Mensal">${formatBRL(Number(c.valor_mensal))}</td>
                <td data-label="Status"><span class="badge badge-${c.status === 'ativo' ? 'success' : c.status === 'pausado' ? 'warning' : 'neutral'}">${c.status}</span></td>
                <td data-label="Ações" class="td-acoes">
                  <button class="btn-icon btn-edit" data-id="${c.id}"><i class="ph ph-pencil-simple"></i></button>
                  <button class="btn-icon btn-remove" style="color:var(--danger)" data-id="${c.id}"><i class="ph ph-trash"></i></button>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // --- Instagram avatar fallback ---
  container.querySelectorAll<HTMLImageElement>('img.ig-avatar').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'avatar';
      fallback.style.background = img.dataset.bg || '';
      fallback.textContent = img.dataset.initials || '';
      img.replaceWith(fallback);
    });
  });

  // --- Filters ---
  container.querySelectorAll('button.filter-btn').forEach(btn => {
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

  // --- CSV Info modal ---
  container.querySelector('#btn-info-csv')?.addEventListener('click', () => {
    openModal('Formato do CSV', `
      <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem">
        O arquivo CSV deve ter a primeira linha com os <strong>nomes das colunas</strong> (cabeçalhos).
        Colunas reconhecidas:
      </p>
      <div class="csv-format-table">
        <table class="data-table" style="font-size:0.82rem">
          <thead><tr><th>Coluna</th><th>Obrigatório</th><th>Exemplo</th></tr></thead>
          <tbody>
            <tr><td><code>nome</code></td><td style="color:var(--danger)">Sim</td><td>Empresa ABC</td></tr>
            <tr><td><code>email</code></td><td>Não</td><td>contato@empresa.com</td></tr>
            <tr><td><code>telefone</code></td><td>Não</td><td>+55 11 98765-4321</td></tr>
            <tr><td><code>plano</code></td><td>Não</td><td>Plano Diamante</td></tr>
            <tr><td><code>valor_mensal</code></td><td>Não</td><td>1500.00</td></tr>
            <tr><td><code>status</code></td><td>Não</td><td>ativo | pausado | encerrado</td></tr>
            <tr><td><code>notion_page_url</code></td><td>Não</td><td>https://notion.so/...</td></tr>
            <tr><td><code>data_pagamento</code></td><td>Não</td><td>5</td></tr>
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:1rem">
        <i class="ph ph-info"></i> Deduplicação automática por <strong>e-mail</strong>, depois <strong>telefone</strong>, depois <strong>nome</strong>.
        Linhas duplicadas são ignoradas, não sobrescritas.
      </p>
    `, () => closeModal(), { submitText: 'Fechar', cancelText: '' });
  });

  // --- CSV Import with deduplication ---
  container.querySelector('#btn-import-csv')?.addEventListener('click', () => {
    openCSVSelector(async (rows) => {
      const total = rows.length;
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const failedNames: string[] = [];
      const colors = ['#e74c3c', '#8e44ad', '#27ae60', '#2980b9', '#d35400', '#16a085'];

      const existingEmails = new Set(clientes.filter(c => c.email).map(c => c.email.toLowerCase()));
      const existingPhones = new Set(clientes.filter(c => c.telefone).map(c => c.telefone.replace(/\\D/g, '')).filter(Boolean));
      const existingNames = new Set(clientes.map(c => c.nome.toLowerCase()));

      for (const row of rows) {
        const nome = (row.nome || '').trim();
        if (!nome) { failed++; continue; }

        const email = (row.email || '').trim();
        const telefone = (row.telefone || '').trim();
        const phoneNorm = telefone.replace(/\\D/g, '');

        const isDuplicate = 
          (email && existingEmails.has(email.toLowerCase())) ||
          (phoneNorm && existingPhones.has(phoneNorm)) ||
          (existingNames.has(nome.toLowerCase()));

        if (isDuplicate) {
          skipped++;
          continue;
        }

        try {
          await addCliente({
            nome: nome,
            email: email,
            telefone: telefone,
            plano: row.plano || '',
            valor_mensal: parseFloat(row.valor_mensal) || 0,
            status: (row.status?.toLowerCase() as any) || 'ativo',
            sigla: getInitials(nome),
            cor: colors[Math.floor(Math.random() * colors.length)],
            notion_page_url: row.notion_page_url || '',
            data_pagamento: parseInt(row.data_pagamento) || undefined
          });

          if (email) existingEmails.add(email.toLowerCase());
          if (phoneNorm) existingPhones.add(phoneNorm);
          existingNames.add(nome.toLowerCase());
          imported++;
        } catch (e) {
          failed++;
          failedNames.push(nome);
        }
      }

      openModal('Importação Concluída', `
        <div class="csv-import-result">
          <div class="csv-result-stat csv-result-ok">
            <i class="ph ph-check-circle"></i>
            <strong>${imported}</strong>
            <span>importados</span>
          </div>
          <div class="csv-result-stat csv-result-skip">
            <i class="ph ph-copy"></i>
            <strong>${skipped}</strong>
            <span>duplicatas ignoradas</span>
          </div>
          <div class="csv-result-stat csv-result-fail">
            <i class="ph ph-x-circle"></i>
            <strong>${failed}</strong>
            <span>com erro / sem nome</span>
          </div>
        </div>
        <p style="color:var(--text-muted);font-size:0.82rem;margin-top:1rem;text-align:center">
          ${total} linha${total !== 1 ? 's' : ''} processada${total !== 1 ? 's' : ''} no total.
        </p>
        ${failedNames.length ? `<p style="color:var(--danger);font-size:0.78rem;margin-top:0.5rem">Falhas: ${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? ` e mais ${failedNames.length - 5}` : ''}</p>` : ''}
      `, () => {
        closeModal();
        navigate('/clientes'); // Refresh list
      }, { submitText: 'Fechar', cancelText: '' });
    }, (err) => {
      showToast('Erro ao ler CSV: ' + err.message, 'error');
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
