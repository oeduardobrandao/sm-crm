// =============================================
// Página: Clientes
// =============================================
import { getClientes, addCliente, updateCliente, removeCliente, formatBRL, getInitials, type Cliente } from '../store';
import { showToast, openModal, closeModal, navigate } from '../router';

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
      <button class="btn-primary" id="btn-add-cliente"><i class="fa-solid fa-plus"></i> Novo Cliente</button>
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
                <td><div style="display:flex;align-items:center;gap:0.75rem">
                  <div class="avatar" style="background:${c.cor}">${getInitials(c.nome)}</div>
                  <strong>${c.nome}</strong>
                </div></td>
                <td>${c.plano}</td>
                <td>${c.email}<br><span style="font-size:0.75rem;color:var(--text-muted)">${c.telefone}</span></td>
                <td>${formatBRL(Number(c.valor_mensal))}</td>
                <td><span class="badge badge-${c.status === 'ativo' ? 'success' : c.status === 'pausado' ? 'warning' : 'neutral'}">${c.status}</span></td>
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
      const id = Number((btn as HTMLElement).dataset.id);
      if (confirm('Remover este cliente? Esta ação não pode ser desfeita.')) {
        try {
          await removeCliente(id);
          showToast('Cliente removido.');
          navigate('/clientes');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }
    });
  });
}
