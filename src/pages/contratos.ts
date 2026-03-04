// =============================================
// Página: Contratos
// =============================================
import { getContratos, addContrato, updateContrato, removeContrato, getClientes, formatBRL, formatDate, type Contrato } from '../store';
import { showToast, openModal, closeModal, navigate } from '../router';

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
      <button class="btn-primary" id="btn-add-contrato"><i class="fa-solid fa-plus"></i> Novo Contrato</button>
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
                <td>${c.cliente_nome}</td>
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

  container.querySelectorAll('.filter-btn').forEach(btn => {
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
      if (confirm('Remover este contrato? Esta ação não pode ser desfeita.')) {
        try {
          await removeContrato(Number((btn as HTMLElement).dataset.id));
          showToast('Contrato removido.');
          navigate('/contratos');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }
    });
  });
}
