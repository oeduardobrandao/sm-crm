// =============================================
// Página: Equipe
// =============================================
import { getMembros, addMembro, updateMembro, removeMembro, formatBRL, getInitials, currentUserRole, type Membro } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm } from '../router';
import { openCSVSelector } from '../lib/csv';

export async function renderEquipe(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const membros = await getMembros();
    renderContent(container, membros, 'todos', 'nome');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}

function renderContent(container: HTMLElement, membros: Membro[], filter: string = 'todos', sort: string = 'nome'): void {
  const isAgent = currentUserRole === 'agent';
  const custoTotal = membros.reduce((s, m) => s + Number(m.custo_mensal || 0), 0);
  const tipoLabel = (t: string) => t === 'clt' ? 'CLT' : t === 'freelancer_mensal' ? 'Freelancer (Mensal)' : 'Freelancer (Demanda)';
  const tipoBadge = (t: string) => t === 'clt' ? 'success' : t === 'freelancer_mensal' ? 'warning' : 'neutral';

  const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
  const getAvatarColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  let filtered = membros;
  if (filter !== 'todos') {
    filtered = membros.filter(m => m.tipo === filter);
  }

  filtered.sort((a, b) => {
    if (sort === 'nome') return a.nome.localeCompare(b.nome);
    if (sort === 'custo_maior') return (Number(b.custo_mensal) || 0) - (Number(a.custo_mensal) || 0);
    if (sort === 'custo_menor') return (Number(a.custo_mensal) || 0) - (Number(b.custo_mensal) || 0);
    return 0;
  });

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Gestão da Equipe</h1>
        <p>${membros.length} membros${isAgent ? '' : ` • Custo total: ${formatBRL(custoTotal)}/mês`}</p>
      </div>
      ${isAgent ? '' : `<div class="header-actions">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <button class="btn-secondary" id="btn-import-csv"><i class="ph ph-file-csv"></i> Importar CSV</button>
          <span id="btn-info-csv" data-tooltip="Formato CSV: Clique para ver as colunas" data-tooltip-dir="bottom" style="display:flex; align-items:center; cursor:pointer;">
            <i class="ph ph-info icon-primary-hover" style="font-size:1.2rem;"></i>
          </span>
        </div>
        <button class="btn-primary" id="btn-add-membro"><i class="ph ph-plus"></i> Adicionar Membro</button>
      </div>`}
    </header>

    <div class="leads-toolbar animate-up">
      <div class="filter-bar" style="margin:0">
        <button class="filter-btn ${filter === 'todos' ? 'active' : ''}" data-filter="todos">Todos</button>
        <button class="filter-btn ${filter === 'clt' ? 'active' : ''}" data-filter="clt">CLT</button>
        <button class="filter-btn ${filter === 'freelancer_mensal' ? 'active' : ''}" data-filter="freelancer_mensal">Freelancer (Mensal)</button>
        <button class="filter-btn ${filter === 'freelancer_demanda' ? 'active' : ''}" data-filter="freelancer_demanda">Freelancer (Demanda)</button>
      </div>
      <select id="sort-select" class="filter-btn" style="max-width:240px; cursor:pointer;">
        <option value="nome" ${sort === 'nome' ? 'selected' : ''}>Ordenar por Nome</option>
        ${isAgent ? '' : `<option value="custo_maior" ${sort === 'custo_maior' ? 'selected' : ''}>Maior Custo</option>
        <option value="custo_menor" ${sort === 'custo_menor' ? 'selected' : ''}>Menor Custo</option>`}
      </select>
    </div>

    <div class="team-grid animate-up">
      ${filtered.length === 0 ? '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem">Nenhum membro encontrado.</div>' :
        filtered.map(m => `
          <div class="card team-card">
            <div style="display:flex;align-items:center;gap:0.75rem">
              <div class="avatar" style="width:48px;height:48px;font-size:1.1rem;background:${getAvatarColor(m.nome)};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.2)">${getInitials(m.nome)}</div>
              <div>
                <a href="#/membro/${m.id}" class="client-link"><h4 style="margin:0">${m.nome}</h4></a>
                <span style="font-size:0.8rem;color:var(--text-muted)">${m.cargo}</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="badge badge-${tipoBadge(m.tipo)}">${tipoLabel(m.tipo)}</span>
              ${isAgent ? '' : `<div style="display:flex;align-items:baseline;gap:0.15rem">${
                m.custo_mensal 
                  ? `<span style="font-size:0.75rem;color:var(--text-muted);font-weight:600">R$</span><span style="font-size:1.1rem;font-weight:700">${Number(m.custo_mensal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span><span style="font-size:0.75rem;color:var(--text-muted)">/mês</span>`
                  : `<span style="font-size:0.85rem;font-weight:600;color:var(--text-muted)">Sob demanda</span>`
              }</div>`}
            </div>
            ${isAgent ? '' : `<button class="btn-icon btn-edit" data-id="${m.id}" style="position:absolute;top:1rem;right:2.5rem;color:var(--text-muted);"><i class="ph ph-pencil-simple"></i></button>
            <button class="btn-icon btn-remove" data-id="${m.id}" style="position:absolute;top:1rem;right:1rem;color:var(--danger);"><i class="ph ph-trash"></i></button>`}
          </div>
        `).join('')}
    </div>
  `;

  // Filters
  container.querySelectorAll('button.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(container, membros, (btn as HTMLElement).dataset.filter || 'todos', sort);
    });
  });

  // Sort
  container.querySelector('#sort-select')?.addEventListener('change', (e) => {
    renderContent(container, membros, filter, (e.target as HTMLSelectElement).value);
  });

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
      <div class="form-row">
        <div class="form-group"><label>Dia de Pagamento (Data Base)</label>
        <input name="data_pagamento" type="number" min="1" max="31" class="form-input" placeholder="Ex: 5" value="${membro?.data_pagamento || ''}"></div>
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
          data_pagamento: parseInt(d.get('data_pagamento') as string) || undefined,
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
            <tr><td><code>nome</code></td><td style="color:var(--danger)">Sim</td><td>João Silva</td></tr>
            <tr><td><code>cargo</code></td><td>Não</td><td>Desenvolvedor</td></tr>
            <tr><td><code>tipo</code></td><td>Não</td><td>clt | freelancer_mensal | freelancer_demanda</td></tr>
            <tr><td><code>custo_mensal</code></td><td>Não</td><td>2000.00</td></tr>
            <tr><td><code>data_pagamento</code></td><td>Não</td><td>5</td></tr>
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:1rem">
        <i class="ph ph-info"></i> Deduplicação automática por <strong>nome</strong>.
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
      const existingNames = new Set(membros.map(m => m.nome.toLowerCase()));

      for (const row of rows) {
        const nome = (row.nome || '').trim();
        if (!nome) { failed++; continue; }

        if (existingNames.has(nome.toLowerCase())) {
          skipped++;
          continue;
        }

        try {
          await addMembro({
            nome: nome,
            cargo: row.cargo || '',
            tipo: (row.tipo?.toLowerCase() as any) || 'freelancer_demanda',
            custo_mensal: parseFloat(row.custo_mensal) || null,
            avatar_url: row.avatar_url || '',
            data_pagamento: parseInt(row.data_pagamento) || undefined
          });
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
        navigate('/equipe'); // Refresh list
      }, { submitText: 'Fechar', cancelText: '' });
    }, (err) => {
      showToast('Erro ao ler CSV: ' + err.message, 'error');
    });
  });

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
      openConfirm('Remover Membro', 'Remover este membro? Esta ação não pode ser desfeita.', async () => {
        try {
          await removeMembro(Number((btn as HTMLElement).dataset.id));
          showToast('Membro removido.');
          navigate('/equipe');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      }, true);
    });
  });
}
