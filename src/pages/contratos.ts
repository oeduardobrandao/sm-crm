// =============================================
// Página: Contratos
// =============================================
import { getContratos, addContrato, updateContrato, removeContrato, getClientes, formatBRL, formatDate, type Contrato } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm } from '../router';
import { openCSVSelector } from '../lib/csv';

export async function renderContratos(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const [contratos, clientes] = await Promise.all([getContratos(), getClientes()]);
    renderContent(container, contratos, clientes, 'todos');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}

function renderContent(container: HTMLElement, contratos: Contrato[], clientes: { id?: number; nome: string }[], filter: string): void {
  const filtered = filter === 'todos' ? contratos : contratos.filter(c => c.status === filter);

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Gestão de Contratos</h1>
        <p>${contratos.length} contratos registrados</p>
      </div>
      <div class="header-actions">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <button class="btn-secondary" id="btn-import-csv"><i class="ph ph-file-csv"></i> Importar CSV</button>
          <span id="btn-info-csv" data-tooltip="Formato CSV: Clique para ver as colunas" data-tooltip-dir="bottom" style="display:flex; align-items:center; cursor:pointer;">
            <i class="ph ph-info" style="color:var(--primary-color); font-size:1.2rem; transition: color 0.2s;" onmouseover="this.style.color='var(--primary-hover)'" onmouseout="this.style.color='var(--primary-color)'"></i>
          </span>
        </div>
        <button class="btn-primary" id="btn-add-contrato"><i class="ph ph-plus"></i> Novo Contrato</button>
      </div>
    </header>

    <div class="filter-bar animate-up">
      ${['todos', 'vigente', 'a_assinar', 'encerrado'].map(f =>
        `<button class="filter-btn ${f === filter ? 'active' : ''}" data-filter="${f}">${f === 'todos' ? 'Todos' : f === 'vigente' ? 'Vigentes' : f === 'a_assinar' ? 'A Assinar' : 'Encerrados'}</button>`
      ).join('')}
    </div>

    <div class="card animate-up">
      <table class="data-table">
        <thead><tr><th>Contrato</th><th>Cliente</th><th>Período</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${filtered.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">Nenhum contrato.</td></tr>' :
            filtered.map(c => `
              <tr>
                <td><strong>${c.titulo}</strong></td>
                <td data-label="Cliente">${c.cliente_id ? `<a href="#/cliente/${c.cliente_id}" class="client-link">${c.cliente_nome}</a>` : c.cliente_nome}</td>
                <td>${formatDate(c.data_inicio)} → ${formatDate(c.data_fim)}</td>
                <td>${formatBRL(Number(c.valor_total))}</td>
                <td><span class="badge badge-${c.status === 'vigente' ? 'success' : c.status === 'a_assinar' ? 'warning' : 'neutral'}">${c.status === 'a_assinar' ? 'A Assinar' : c.status}</span></td>
                <td style="text-align: right;">
                  <button class="btn-icon btn-edit" data-id="${c.id}"><i class="fa-solid fa-pen"></i></button>
                  <button class="btn-icon btn-remove" style="color:var(--danger)" data-id="${c.id}"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('button.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(container, contratos, clientes, (btn as HTMLElement).dataset.filter || 'todos');
    });
  });

  const openContratoModal = (contrato?: Contrato) => {
    const isEditing = !!contrato;
    openModal(isEditing ? 'Editar Contrato' : 'Novo Contrato', `
      <div class="form-row">
        <div class="form-group"><label>Título</label>
        <input name="titulo" class="form-input" required value="${contrato?.titulo || ''}"></div>
        <div class="form-group"><label>Cliente</label>
          <select name="cliente_id" class="form-input">
            <option value="">Selecione...</option>
            ${clientes.map(c => `<option value="${c.id}" ${contrato?.cliente_id === c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Data Início</label>
        <input name="data_inicio" type="date" class="form-input" required value="${contrato?.data_inicio || ''}"></div>
        <div class="form-group"><label>Data Fim</label>
        <input name="data_fim" type="date" class="form-input" required value="${contrato?.data_fim || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Valor Total</label>
        <input name="valor_total" type="number" step="0.01" class="form-input" value="${contrato?.valor_total || ''}"></div>
        <div class="form-group"><label>Status</label>
          <select name="status" class="form-input">
            <option value="a_assinar" ${contrato?.status === 'a_assinar' ? 'selected' : ''}>A Assinar</option>
            <option value="vigente" ${contrato?.status === 'vigente' ? 'selected' : ''}>Vigente</option>
            <option value="encerrado" ${contrato?.status === 'encerrado' ? 'selected' : ''}>Encerrado</option>
          </select>
        </div>
      </div>
    `, async (form) => {
      const d = new FormData(form);
      const clienteId = d.get('cliente_id') as string;
      const cliente = clientes.find(c => String(c.id) === clienteId);
      try {
        const payload = {
          titulo: d.get('titulo') as string,
          cliente_id: clienteId ? Number(clienteId) : null,
          cliente_nome: cliente?.nome || '',
          data_inicio: d.get('data_inicio') as string,
          data_fim: d.get('data_fim') as string,
          valor_total: parseFloat(d.get('valor_total') as string) || 0,
          status: d.get('status') as 'vigente' | 'a_assinar' | 'encerrado',
        };

        if (isEditing && contrato?.id) {
          await updateContrato(contrato.id, payload);
          showToast('Contrato atualizado!');
        } else {
          await addContrato(payload);
          showToast('Contrato criado!');
        }
        closeModal();
        navigate('/contratos');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro';
        showToast('Erro: ' + message, 'error');
      }
    });
  };

  container.querySelector('#btn-add-contrato')?.addEventListener('click', () => openContratoModal());

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
            <tr><td><code>titulo</code></td><td style="color:var(--danger)">Sim</td><td>Projeto X</td></tr>
            <tr><td><code>cliente_id</code></td><td>Não</td><td>123</td></tr>
            <tr><td><code>data_inicio</code></td><td>Não</td><td>2024-01-01</td></tr>
            <tr><td><code>data_fim</code></td><td>Não</td><td>2024-12-31</td></tr>
            <tr><td><code>valor_total</code></td><td>Não</td><td>12000.00</td></tr>
            <tr><td><code>status</code></td><td>Não</td><td>vigente | a_assinar | encerrado</td></tr>
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:1rem">
        <i class="ph ph-info"></i> Deduplicação automática por <strong>título e cliente_id</strong>.
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
      const existingContracts = new Set(contratos.map(c => `${c.titulo.toLowerCase()}_${c.cliente_id}`));

      for (const row of rows) {
        const titulo = (row.titulo || '').trim();
        if (!titulo) { failed++; continue; }

        const clienteId = row.cliente_id ? Number(row.cliente_id) : null;
        const dedupKey = `${titulo.toLowerCase()}_${clienteId}`;

        if (existingContracts.has(dedupKey)) {
          skipped++;
          continue;
        }

        try {
          const cliente = clientes.find(c => c.id === clienteId);
          
          await addContrato({
            titulo: titulo,
            cliente_id: clienteId,
            cliente_nome: cliente?.nome || row.cliente_nome || '',
            data_inicio: row.data_inicio || new Date().toISOString().split('T')[0],
            data_fim: row.data_fim || new Date().toISOString().split('T')[0],
            valor_total: parseFloat(row.valor_total) || 0,
            status: (row.status?.toLowerCase() as any) || 'vigente',
          });
          
          existingContracts.add(dedupKey);
          imported++;
        } catch (e) {
          failed++;
          failedNames.push(titulo);
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
            <span>com erro / sem título</span>
          </div>
        </div>
        <p style="color:var(--text-muted);font-size:0.82rem;margin-top:1rem;text-align:center">
          ${total} linha${total !== 1 ? 's' : ''} processada${total !== 1 ? 's' : ''} no total.
        </p>
        ${failedNames.length ? `<p style="color:var(--danger);font-size:0.78rem;margin-top:0.5rem">Falhas: ${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? ` e mais ${failedNames.length - 5}` : ''}</p>` : ''}
      `, () => {
        closeModal();
        navigate('/contratos'); // Refresh list
      }, { submitText: 'Fechar', cancelText: '' });
    }, (err) => {
      showToast('Erro ao ler CSV: ' + err.message, 'error');
    });
  });

  // Edit events
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const contrato = contratos.find(c => c.id === id);
      if (contrato) openContratoModal(contrato);
    });
  });

  // Remove events
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      openConfirm('Remover Contrato', 'Remover este contrato? Esta ação não pode ser desfeita.', async () => {
        try {
          await removeContrato(Number((btn as HTMLElement).dataset.id));
          showToast('Contrato removido.');
          navigate('/contratos');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }, true);
    });
  });
}
