// =============================================
// Página: Equipe
// =============================================
import { getMembros, addMembro, updateMembro, removeMembro, formatBRL, getInitials, type Membro } from '../store';
import { showToast, openModal, closeModal, navigate } from '../router';

export async function renderEquipe(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const membros = await getMembros();
    renderContent(container, membros);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}

function renderContent(container: HTMLElement, membros: Membro[]): void {
  const custoTotal = membros.reduce((s, m) => s + Number(m.custo_mensal || 0), 0);
  const tipoLabel = (t: string) => t === 'clt' ? 'CLT' : t === 'freelancer_mensal' ? 'Freelancer (Mensal)' : 'Freelancer (Demanda)';
  const tipoBadge = (t: string) => t === 'clt' ? 'success' : t === 'freelancer_mensal' ? 'warning' : 'neutral';

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Gestão da Equipe</h1>
        <p>${membros.length} membros • Custo total: ${formatBRL(custoTotal)}/mês</p>
      </div>
      <button class="btn-primary" id="btn-add-membro"><i class="fa-solid fa-plus"></i> Adicionar Membro</button>
    </header>

    <div class="team-grid animate-up">
      ${membros.length === 0 ? '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem">Nenhum membro cadastrado.</div>' :
        membros.map(m => `
          <div class="card team-card">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
              <div class="avatar" style="width:48px;height:48px;font-size:1.1rem">${getInitials(m.nome)}</div>
              <div>
                <h4 style="margin:0">${m.nome}</h4>
                <span style="font-size:0.8rem;color:var(--text-muted)">${m.cargo}</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="badge badge-${tipoBadge(m.tipo)}">${tipoLabel(m.tipo)}</span>
              <strong>${m.custo_mensal ? formatBRL(Number(m.custo_mensal)) + '/mês' : 'Sob demanda'}</strong>
            </div>
            <button class="btn-icon btn-edit" data-id="${m.id}" style="position:absolute;top:0.75rem;right:2.5rem"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon btn-remove" data-id="${m.id}" style="position:absolute;top:0.75rem;right:0.75rem;color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
          </div>
        `).join('')}
    </div>
  `;

  const openMembroModal = (membro?: Membro) => {
    const isEditing = !!membro;
    openModal(isEditing ? 'Editar Membro' : 'Adicionar Membro', `
      <div class="form-row">
        <div class="form-group"><label>Nome</label>
        <input name="nome" class="form-input" required value="${membro?.nome || ''}"></div>
        <div class="form-group"><label>Cargo</label>
        <input name="cargo" class="form-input" value="${membro?.cargo || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Tipo</label>
          <select name="tipo" class="form-input">
            <option value="freelancer_mensal" ${membro?.tipo === 'freelancer_mensal' ? 'selected' : ''}>Freelancer (Mensal)</option>
            <option value="clt" ${membro?.tipo === 'clt' ? 'selected' : ''}>CLT</option>
            <option value="freelancer_demanda" ${membro?.tipo === 'freelancer_demanda' ? 'selected' : ''}>Freelancer (Demanda)</option>
          </select>
        </div>
        <div class="form-group"><label>Custo Mensal</label>
        <input name="custo_mensal" type="number" step="0.01" class="form-input" value="${membro?.custo_mensal || ''}"></div>
      </div>
    `, async (form) => {
      const d = new FormData(form);
      try {
        const payload = {
          nome: d.get('nome') as string,
          cargo: d.get('cargo') as string || '',
          tipo: d.get('tipo') as 'clt' | 'freelancer_mensal' | 'freelancer_demanda',
          custo_mensal: parseFloat(d.get('custo_mensal') as string) || null,
          avatar_url: membro?.avatar_url || '',
        };

        if (isEditing && membro?.id) {
          await updateMembro(membro.id, payload);
          showToast('Membro atualizado!');
        } else {
          await addMembro(payload);
          showToast('Membro adicionado!');
        }
        
        closeModal();
        navigate('/equipe');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro';
        showToast('Erro: ' + message, 'error');
      }
    });
  };

  container.querySelector('#btn-add-membro')?.addEventListener('click', () => openMembroModal());

  // Edit events
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const membro = membros.find(m => m.id === id);
      if (membro) openMembroModal(membro);
    });
  });

  // Remove events
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover este membro? Esta ação não pode ser desfeita.')) {
        try {
          await removeMembro(Number((btn as HTMLElement).dataset.id));
          showToast('Membro removido.');
          navigate('/equipe');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }
    });
  });
}
