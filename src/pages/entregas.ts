// =============================================
// Página: Entregas (Kanban Board)
// =============================================
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates,
  getWorkflowEtapas, addWorkflow, addWorkflowEtapa, addWorkflowTemplate,
  removeWorkflowTemplate, completeEtapa, revertEtapa, duplicateWorkflow, removeWorkflow,
  updateWorkflow, updateWorkflowEtapa, updateWorkflowTemplate,
  getDeadlineInfo, getInitials,
  type Workflow, type WorkflowEtapa, type WorkflowTemplate, type Cliente, type Membro
} from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm } from '../router';

// ---- Types ----
interface BoardData {
  workflows: Workflow[];
  etapasMap: Map<number, WorkflowEtapa[]>;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
}

interface BoardState {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

// ---- Avatar colors ----
const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

// ---- Main render ----
export async function renderEntregas(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;
  try {
    const [workflows, clientes, membros, templates] = await Promise.all([
      getWorkflows(),
      getClientes(),
      getMembros(),
      getWorkflowTemplates(),
    ]);

    // Fetch etapas for all active workflows
    const activeWorkflows = workflows.filter(w => w.status === 'ativo');
    const etapasMap = new Map<number, WorkflowEtapa[]>();
    await Promise.all(activeWorkflows.map(async w => {
      const etapas = await getWorkflowEtapas(w.id!);
      etapasMap.set(w.id!, etapas);
    }));

    const data: BoardData = { workflows, etapasMap, clientes, membros, templates };
    renderBoard(container, data, { filterCliente: null, filterMembro: null, filterStatus: 'todos' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${msg}</p></div>`;
  }
}

// ---- Board render ----
function renderBoard(container: HTMLElement, data: BoardData, state: BoardState): void {
  const { workflows, etapasMap, clientes, membros, templates } = data;
  const activeWorkflows = workflows.filter(w => w.status === 'ativo');

  // Build cards: one per active etapa
  let cards: BoardCard[] = [];
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    const activeEtapa = etapas.find(e => e.status === 'ativo');
    if (!activeEtapa) continue;

    const cliente = clientes.find(c => c.id === w.cliente_id);
    const membro = activeEtapa.responsavel_id ? membros.find(m => m.id === activeEtapa.responsavel_id) : undefined;
    const deadline = getDeadlineInfo(activeEtapa);

    cards.push({
      workflow: w,
      etapa: activeEtapa,
      cliente,
      membro,
      deadline,
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
    });
  }

  // Apply filters
  if (state.filterCliente) cards = cards.filter(c => c.workflow.cliente_id === state.filterCliente);
  if (state.filterMembro) cards = cards.filter(c => c.etapa.responsavel_id === state.filterMembro);
  if (state.filterStatus === 'atrasado') cards = cards.filter(c => c.deadline.estourado);
  else if (state.filterStatus === 'urgente') cards = cards.filter(c => c.deadline.urgente);
  else if (state.filterStatus === 'em_dia') cards = cards.filter(c => !c.deadline.estourado && !c.deadline.urgente);

  // Group workflows by their step sequence (each unique sequence gets its own row)
  interface BoardRow {
    key: string;
    label: string;
    stepNames: string[];
    columns: Map<string, BoardCard[]>;
  }

  const rowMap = new Map<string, BoardRow>();
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    const stepNames = etapas.sort((a, b) => a.ordem - b.ordem).map(e => e.nome);
    const key = stepNames.join(' → ');
    if (!rowMap.has(key)) {
      const tpl = w.template_id ? templates.find(t => t.id === w.template_id) : null;
      const label = tpl ? tpl.nome : key;
      const columns = new Map<string, BoardCard[]>();
      for (const name of stepNames) columns.set(name, []);
      rowMap.set(key, { key, label, stepNames, columns });
    }
  }

  // Place cards into their row's columns
  for (const card of cards) {
    const etapas = etapasMap.get(card.workflow.id!) || [];
    const stepNames = etapas.sort((a, b) => a.ordem - b.ordem).map(e => e.nome);
    const key = stepNames.join(' → ');
    const row = rowMap.get(key);
    if (row) {
      const col = row.columns.get(card.etapa.nome);
      if (col) col.push(card);
    }
  }

  const boardRows = [...rowMap.values()].filter(r => {
    // Only show rows that have cards after filtering
    for (const col of Array.from(r.columns.values())) if (col.length > 0) return true;
    return false;
  });

  // Count alerts
  const overdue = cards.filter(c => c.deadline.estourado).length;
  const urgent = cards.filter(c => c.deadline.urgente).length;

  // Distinct clients in active workflows
  const activeClientIds = new Set(activeWorkflows.map(w => w.cliente_id));
  const activeClients = clientes.filter(c => activeClientIds.has(c.id!));

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1><i class="ph ph-kanban" style="margin-right:0.5rem"></i>Entregas</h1>
        <p>${activeWorkflows.length} fluxos ativos${overdue ? ` • <span style="color:var(--danger);font-weight:600">${overdue} atrasado${overdue > 1 ? 's' : ''}</span>` : ''}${urgent ? ` • <span style="color:var(--warning);font-weight:600">${urgent} urgente${urgent > 1 ? 's' : ''}</span>` : ''}</p>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" id="btn-templates"><i class="ph ph-blueprint"></i> Templates</button>
        <button class="btn-primary" id="btn-new-workflow"><i class="ph ph-plus"></i> Novo Fluxo</button>
      </div>
    </header>

    <div class="leads-toolbar animate-up">
      <div class="filter-bar" style="margin:0">
        <button class="filter-btn ${state.filterStatus === 'todos' ? 'active' : ''}" data-fstatus="todos">Todos</button>
        <button class="filter-btn ${state.filterStatus === 'atrasado' ? 'active' : ''}" data-fstatus="atrasado">🔴 Atrasados</button>
        <button class="filter-btn ${state.filterStatus === 'urgente' ? 'active' : ''}" data-fstatus="urgente">🟡 Urgentes</button>
        <button class="filter-btn ${state.filterStatus === 'em_dia' ? 'active' : ''}" data-fstatus="em_dia">🟢 Em dia</button>
      </div>
      <div style="display:flex;gap:0.5rem">
        <select id="filter-cliente" class="filter-btn" style="max-width:200px;cursor:pointer">
          <option value="">Todos os clientes</option>
          ${activeClients.map(c => `<option value="${c.id}" ${state.filterCliente === c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
        </select>
        <select id="filter-membro" class="filter-btn" style="max-width:200px;cursor:pointer">
          <option value="">Todos os membros</option>
          ${membros.map(m => `<option value="${m.id}" ${state.filterMembro === m.id ? 'selected' : ''}>${m.nome}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="board-rows-wrapper animate-up">
      ${boardRows.length === 0 ? `
        <div class="card" style="text-align:center;padding:3rem;color:var(--text-muted);width:100%">
          <i class="ph ph-kanban" style="font-size:2.5rem;margin-bottom:1rem;display:block;opacity:0.3"></i>
          <p>Nenhum fluxo ativo. Crie um novo fluxo para começar!</p>
        </div>
      ` : boardRows.map(row => `
        ${boardRows.length > 1 ? `<div class="board-row-label">${row.label}</div>` : ''}
        <div class="board-container">
          ${[...row.columns.entries()].map(([stepName, stepCards]) => `
            <div class="board-column">
              <div class="board-column-header">
                <span class="board-column-title">${stepName}</span>
                <span class="board-column-count">${stepCards.length}</span>
              </div>
              <div class="board-column-body">
                ${stepCards.length === 0 ? '<div class="board-empty">Nenhuma entrega</div>' :
                  stepCards.map(card => {
                const dl = card.deadline;
                const deadlineClass = dl.estourado ? 'deadline-overdue' : dl.urgente ? 'deadline-warning' : dl.diasRestantes <= 3 ? 'deadline-caution' : 'deadline-ok';
                const deadlineText = dl.estourado ? `${Math.abs(dl.diasRestantes)}d atrasado` : dl.diasRestantes === 0 ? 'Vence hoje' : `${dl.diasRestantes}d restante${dl.diasRestantes > 1 ? 's' : ''}`;
                const progressPct = card.totalEtapas > 0 ? Math.round((card.etapaIdx / card.totalEtapas) * 100) : 0;
                return `
                <div class="board-card ${deadlineClass}" data-wid="${card.workflow.id}" data-eid="${card.etapa.id}">
                  <div class="board-card-top">
                    <span class="board-card-client" style="border-left:3px solid ${card.cliente?.cor || '#888'};padding-left:0.5rem">${card.cliente?.nome || '—'}</span>
                    ${card.workflow.recorrente ? '<i class="ph ph-arrows-clockwise" style="font-size:0.75rem;color:var(--text-muted)" title="Recorrente"></i>' : ''}
                  </div>
                  <div class="board-card-title">${card.workflow.titulo}</div>
                  <div class="board-card-meta">
                    <span class="board-card-deadline ${deadlineClass}"><i class="ph ph-clock"></i> ${deadlineText}</span>
                    <span class="board-card-prazo-type">${card.etapa.tipo_prazo === 'uteis' ? 'dias úteis' : 'dias corridos'}</span>
                  </div>
                  ${card.membro ? `
                  <div class="board-card-assignee">
                    <div class="avatar" style="width:22px;height:22px;font-size:0.6rem;background:${getAvatarColor(card.membro.nome)};color:#fff">${getInitials(card.membro.nome)}</div>
                    <span>${card.membro.nome}</span>
                  </div>` : ''}
                  <div class="board-card-progress">
                    <div class="board-progress-bar"><div class="board-progress-fill" style="width:${progressPct}%"></div></div>
                    <span class="board-progress-label">${card.etapaIdx + 1}/${card.totalEtapas}</span>
                  </div>
                  <div class="board-card-actions">
                    ${card.etapaIdx > 0 ? `<button class="btn-revert-etapa" data-wid="${card.workflow.id}" title="Voltar etapa"><i class="ph ph-arrow-left"></i> Voltar</button>` : ''}
                    <button class="btn-edit-workflow" data-wid="${card.workflow.id}" data-eid="${card.etapa.id}" title="Editar fluxo"><i class="ph ph-pencil-simple"></i> Editar</button>
                    <button class="btn-complete-etapa" data-wid="${card.workflow.id}" data-eid="${card.etapa.id}" title="Concluir etapa">
                      <i class="ph ph-check-circle"></i> Concluir
                    </button>
                  </div>
                </div>`;
              }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;

  // ---- Event Listeners ----

  // Filter status
  container.querySelectorAll('.filter-btn[data-fstatus]').forEach(btn => {
    btn.addEventListener('click', () => {
      renderBoard(container, data, { ...state, filterStatus: (btn as HTMLElement).dataset.fstatus as any });
    });
  });

  // Filter client
  container.querySelector('#filter-cliente')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    renderBoard(container, data, { ...state, filterCliente: val ? Number(val) : null });
  });

  // Filter member
  container.querySelector('#filter-membro')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    renderBoard(container, data, { ...state, filterMembro: val ? Number(val) : null });
  });

  // Complete etapa
  container.querySelectorAll('.btn-complete-etapa').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wid = Number((btn as HTMLElement).dataset.wid);
      const eid = Number((btn as HTMLElement).dataset.eid);
      try {
        const result = await completeEtapa(wid, eid);
        if (result.workflow.status === 'concluido') {
          showToast('Fluxo concluído! 🎉');
          // Check recurrence
          const wf = workflows.find(w => w.id === wid);
          if (wf?.recorrente) {
            openConfirm('Fluxo Recorrente', 'Este fluxo é recorrente. Deseja criar um novo ciclo com as mesmas etapas?', async () => {
              try {
                await duplicateWorkflow(wid);
                showToast('Novo ciclo criado!');
                navigate('/entregas');
              } catch { showToast('Erro ao duplicar fluxo.', 'error'); }
            });
          } else {
            navigate('/entregas');
          }
        } else {
          showToast('Etapa concluída! Próxima etapa ativada.');
          navigate('/entregas');
        }
      } catch (err) {
        showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
      }
    });
  });

  // Revert etapa (move back)
  container.querySelectorAll('.btn-revert-etapa').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wid = Number((btn as HTMLElement).dataset.wid);
      openConfirm('Voltar Etapa', 'Deseja mover este fluxo para a etapa anterior? A etapa atual será resetada.', async () => {
        try {
          await revertEtapa(wid);
          showToast('Etapa revertida com sucesso.');
          navigate('/entregas');
        } catch (err) {
          showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
        }
      });
    });
  });

  // Edit workflow
  container.querySelectorAll('.btn-edit-workflow').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wid = Number((btn as HTMLElement).dataset.wid);
      const eid = Number((btn as HTMLElement).dataset.eid);
      const card = cards.find(c => c.workflow.id === wid);
      if (card) openEditWorkflowModal(card, data);
    });
  });

  // New workflow
  container.querySelector('#btn-new-workflow')?.addEventListener('click', () => {
    openNewWorkflowModal(data);
  });

  // Templates
  container.querySelector('#btn-templates')?.addEventListener('click', () => {
    openTemplatesModal(data);
  });
}

// ---- Edit Workflow Modal ----
interface BoardCard {
  workflow: Workflow;
  etapa: WorkflowEtapa;
  cliente: Cliente | undefined;
  membro: Membro | undefined;
  deadline: ReturnType<typeof getDeadlineInfo>;
  totalEtapas: number;
  etapaIdx: number;
}

function openEditWorkflowModal(card: BoardCard, data: BoardData): void {
  const { clientes, membros } = data;
  const activeClientes = clientes.filter(c => c.status === 'ativo');
  const w = card.workflow;
  const e = card.etapa;

  openModal('Editar Fluxo', `
    <div class="form-row">
      <div class="form-group"><label>Título *</label>
        <input name="titulo" class="form-input" required value="${w.titulo}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cliente *</label>
        <select name="cliente_id" class="form-input" required>
          ${activeClientes.map(c => `<option value="${c.id}" ${c.id === w.cliente_id ? 'selected' : ''}>${c.nome}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="display:flex;flex-direction:row;align-items:center;gap:0.5rem">
      <input type="checkbox" name="recorrente" id="edit-recorrente" ${w.recorrente ? 'checked' : ''} style="width:auto;margin:0">
      <label for="edit-recorrente" style="margin:0;cursor:pointer;flex:1">Fluxo recorrente</label>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
    <h4 style="margin-bottom:0.75rem">Etapa Atual: ${e.nome}</h4>
    <div class="form-row">
      <div class="form-group"><label>Responsável</label>
        <select name="responsavel_id" class="form-input">
          <option value="">Sem responsável</option>
          ${membros.map(m => `<option value="${m.id}" ${e.responsavel_id === m.id ? 'selected' : ''}>${m.nome}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Prazo (dias)</label>
        <input name="prazo_dias" type="number" min="1" class="form-input" value="${e.prazo_dias}">
      </div>
      <div class="form-group"><label>Tipo de prazo</label>
        <select name="tipo_prazo" class="form-input">
          <option value="corridos" ${e.tipo_prazo === 'corridos' ? 'selected' : ''}>Dias corridos</option>
          <option value="uteis" ${e.tipo_prazo === 'uteis' ? 'selected' : ''}>Dias úteis</option>
        </select>
      </div>
    </div>
  `, async (form) => {
    const fd = new FormData(form);
    const titulo = (fd.get('titulo') as string || '').trim();
    const cliente_id = Number(fd.get('cliente_id'));
    if (!titulo || !cliente_id) { showToast('Título e cliente são obrigatórios.', 'error'); return; }

    try {
      await updateWorkflow(w.id!, {
        titulo,
        cliente_id,
        recorrente: !!fd.get('recorrente'),
      });
      await updateWorkflowEtapa(e.id!, {
        responsavel_id: fd.get('responsavel_id') ? Number(fd.get('responsavel_id')) : null,
        prazo_dias: Number(fd.get('prazo_dias')) || e.prazo_dias,
        tipo_prazo: (fd.get('tipo_prazo') as 'uteis' | 'corridos') || e.tipo_prazo,
      });
      showToast('Fluxo atualizado!');
      closeModal();
      navigate('/entregas');
    } catch (err) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
    }
  }, { submitText: 'Salvar' });

  // Add the "Delete Workflow" button dynamically
  setTimeout(() => {
    const actions = document.querySelector('#modal-form .modal-actions');
    if (actions) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-danger';
      delBtn.style.marginRight = 'auto'; // Push others to the right
      delBtn.innerHTML = '<i class="ph ph-trash"></i> Excluir';
      
      delBtn.addEventListener('click', () => {
        openConfirm('Excluir Fluxo', `Tem certeza que deseja excluir o fluxo <strong>"${w.titulo}"</strong>? Esta ação não pode ser desfeita.`, async () => {
          try {
            await removeWorkflow(w.id!);
            showToast('Fluxo excluído com sucesso.');
            closeModal();
            navigate('/entregas');
          } catch (err) {
            showToast('Erro ao excluir fluxo.', 'error');
          }
        }, true);
      });

      actions.prepend(delBtn);
    }
  }, 50);
}

// ---- New Workflow Modal ----
function openNewWorkflowModal(data: BoardData): void {
  const { clientes, membros, templates } = data;
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  openModal('Novo Fluxo de Entrega', `
    <div class="form-row">
      <div class="form-group"><label>Título *</label>
        <input name="titulo" class="form-input" required placeholder="Ex: Posts Instagram — Março 2026">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Cliente *</label>
        <select name="cliente_id" class="form-input" required>
          <option value="">Selecionar cliente...</option>
          ${activeClientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Template</label>
        <select name="template_id" class="form-input" id="wf-template-select">
          <option value="">Personalizado (sem template)</option>
          ${templates.map(t => `<option value="${t.id}">${t.nome} (${t.etapas.length} etapas)</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group" style="display:flex;flex-direction:row;align-items:center;gap:0.5rem;margin-top:0.5rem;">
      <input type="checkbox" name="recorrente" id="wf-recorrente" style="width:auto;margin:0">
      <label for="wf-recorrente" style="margin:0;cursor:pointer;flex:1">Fluxo recorrente (ao concluir, oferecer criar novo ciclo)</label>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
    <h4 style="margin-bottom:0.75rem">Etapas</h4>
    <div id="wf-etapas-list"></div>
    <button type="button" class="btn-secondary" id="btn-add-etapa" style="margin-top:0.5rem"><i class="ph ph-plus"></i> Adicionar Etapa</button>
  `, async (form) => {
    const fd = new FormData(form);
    const titulo = (fd.get('titulo') as string || '').trim();
    const cliente_id = Number(fd.get('cliente_id'));
    if (!titulo || !cliente_id) { showToast('Título e cliente são obrigatórios.', 'error'); return; }

    const etapaEls = form.querySelectorAll('.wf-etapa-row');
    if (etapaEls.length === 0) { showToast('Adicione pelo menos uma etapa.', 'error'); return; }

    try {
      const workflow = await addWorkflow({
        cliente_id,
        titulo,
        template_id: fd.get('template_id') ? Number(fd.get('template_id')) : null,
        status: 'ativo',
        etapa_atual: 0,
        recorrente: !!fd.get('recorrente'),
      });

      const now = new Date().toISOString();
      let i = 0;
      for (const row of etapaEls) {
        const nome = (row.querySelector('[name="etapa_nome"]') as HTMLInputElement)?.value?.trim();
        const prazo = Number((row.querySelector('[name="etapa_prazo"]') as HTMLInputElement)?.value) || 1;
        const tipoPrazo = (row.querySelector('[name="etapa_tipo_prazo"]') as HTMLSelectElement)?.value as 'uteis' | 'corridos';
        const responsavelId = Number((row.querySelector('[name="etapa_responsavel"]') as HTMLSelectElement)?.value) || null;
        if (!nome) continue;
        await addWorkflowEtapa({
          workflow_id: workflow.id!,
          ordem: i,
          nome,
          prazo_dias: prazo,
          tipo_prazo: tipoPrazo || 'corridos',
          responsavel_id: responsavelId,
          status: i === 0 ? 'ativo' : 'pendente',
          iniciado_em: i === 0 ? now : null,
          concluido_em: null,
        });
        i++;
      }

      showToast('Fluxo criado com sucesso!');
      closeModal();
      navigate('/entregas');
    } catch (err) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
    }
  }, { submitText: 'Criar Fluxo' });

  // Post-modal setup: etapa rows + template selection
  const etapasList = document.getElementById('wf-etapas-list');
  const templateSelect = document.getElementById('wf-template-select') as HTMLSelectElement;

  function addEtapaRow(nome = '', prazo = 3, tipoPrazo = 'corridos', responsavelId: number | null = null) {
    if (!etapasList) return;
    const row = document.createElement('div');
    row.className = 'wf-etapa-row';
    row.innerHTML = `
      <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;flex-wrap:wrap">
        <input name="etapa_nome" class="form-input" placeholder="Nome da etapa" value="${nome}" style="flex:2;min-width:140px" required>
        <input name="etapa_prazo" type="number" min="1" class="form-input" value="${prazo}" style="width:70px" title="Prazo em dias">
        <select name="etapa_tipo_prazo" class="form-input" style="width:120px">
          <option value="corridos" ${tipoPrazo === 'corridos' ? 'selected' : ''}>Corridos</option>
          <option value="uteis" ${tipoPrazo === 'uteis' ? 'selected' : ''}>Úteis</option>
        </select>
        <select name="etapa_responsavel" class="form-input" style="flex:1;min-width:130px">
          <option value="">Sem responsável</option>
          ${membros.map(m => `<option value="${m.id}" ${responsavelId === m.id ? 'selected' : ''}>${m.nome}</option>`).join('')}
        </select>
        <button type="button" class="btn-icon btn-remove-etapa" style="color:var(--danger)"><i class="ph ph-trash"></i></button>
      </div>
    `;
    row.querySelector('.btn-remove-etapa')?.addEventListener('click', () => row.remove());
    etapasList.appendChild(row);
  }

  document.getElementById('btn-add-etapa')?.addEventListener('click', () => addEtapaRow());

  templateSelect?.addEventListener('change', () => {
    if (!etapasList) return;
    const tid = Number(templateSelect.value);
    if (!tid) return;
    const tpl = templates.find(t => t.id === tid);
    if (!tpl) return;
    etapasList.innerHTML = '';
    tpl.etapas.forEach(e => addEtapaRow(e.nome, e.prazo_dias, e.tipo_prazo, e.responsavel_id || null));
  });

  // Start with one blank row
  addEtapaRow();
}

// ---- Templates Modal ----
function openTemplatesModal(data: BoardData): void {
  const { templates, membros } = data;

  let body = `<div style="margin-bottom:1rem">`;
  if (templates.length === 0) {
    body += `<p style="color:var(--text-muted)">Nenhum template salvo. Crie um abaixo.</p>`;
  } else {
    body += templates.map(t => `
      <div class="card" style="margin-bottom:0.75rem;padding:1rem;position:relative">
        <strong>${t.nome}</strong>
        <p style="font-size:0.82rem;color:var(--text-muted);margin-top:0.25rem">${t.etapas.length} etapa${t.etapas.length !== 1 ? 's' : ''}: ${t.etapas.map(e => e.nome).join(' → ')}</p>
        <button type="button" class="btn-icon btn-edit-tpl" data-id="${t.id}" style="position:absolute;top:0.75rem;right:2.5rem;color:var(--text-muted)" title="Editar"><i class="ph ph-pencil-simple"></i></button>
        <button type="button" class="btn-icon btn-del-tpl" data-id="${t.id}" style="position:absolute;top:0.75rem;right:0.75rem;color:var(--danger)" title="Excluir"><i class="ph ph-trash"></i></button>
      </div>
    `).join('');
  }
  body += `</div>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
    <h4 style="margin-bottom:0.75rem">Novo Template</h4>
    <div class="form-group"><label>Nome</label>
      <input name="tpl_nome" class="form-input" placeholder="Ex: Fluxo Padrão de Post">
    </div>
    <div id="tpl-etapas-list"></div>
    <button type="button" class="btn-secondary" id="btn-tpl-add-etapa" style="margin-top:0.5rem"><i class="ph ph-plus"></i> Adicionar Etapa</button>
  `;

  openModal('Gerenciar Templates', body, async (form) => {
    const fd = new FormData(form);
    const nome = (fd.get('tpl_nome') as string || '').trim();
    if (!nome) { showToast('Nome do template é obrigatório.', 'error'); return; }

    const rows = form.querySelectorAll('.tpl-etapa-row');
    if (rows.length === 0) { showToast('Adicione pelo menos uma etapa.', 'error'); return; }

    const etapas = Array.from(rows).map(row => ({
      nome: (row.querySelector('[name="tpl_e_nome"]') as HTMLInputElement)?.value?.trim() || '',
      prazo_dias: Number((row.querySelector('[name="tpl_e_prazo"]') as HTMLInputElement)?.value) || 1,
      tipo_prazo: ((row.querySelector('[name="tpl_e_tipo"]') as HTMLSelectElement)?.value || 'corridos') as 'uteis' | 'corridos',
      responsavel_id: Number((row.querySelector('[name="tpl_e_resp"]') as HTMLSelectElement)?.value) || null,
    })).filter(e => e.nome);

    if (etapas.length === 0) { showToast('Etapas precisam ter nomes.', 'error'); return; }

    try {
      await addWorkflowTemplate({ nome, etapas });
      showToast('Template criado!');
      closeModal();
      navigate('/entregas');
    } catch (err) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
    }
  }, { submitText: 'Salvar Template' });

  // Delete template buttons
  document.querySelectorAll('.btn-del-tpl').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      openConfirm('Excluir Template', 'Remover este template? Fluxos existentes não serão afetados.', async () => {
        try {
          await removeWorkflowTemplate(id);
          showToast('Template excluído.');
          closeModal();
          navigate('/entregas');
        } catch { showToast('Erro ao excluir.', 'error'); }
      }, true);
    });
  });

  // Edit template buttons
  document.querySelectorAll('.btn-edit-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const tpl = templates.find(t => t.id === id);
      if (tpl) openEditTemplateModal(tpl, data);
    });
  });

  // Add etapa rows for template
  const tplList = document.getElementById('tpl-etapas-list');
  function addTplEtapaRow() {
    if (!tplList) return;
    const row = document.createElement('div');
    row.className = 'tpl-etapa-row';
    row.innerHTML = `
      <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;flex-wrap:wrap">
        <input name="tpl_e_nome" class="form-input" placeholder="Nome" style="flex:2;min-width:120px">
        <input name="tpl_e_prazo" type="number" min="1" value="3" class="form-input" style="width:70px" title="Prazo (dias)">
        <select name="tpl_e_tipo" class="form-input" style="width:110px">
          <option value="corridos">Corridos</option>
          <option value="uteis">Úteis</option>
        </select>
        <select name="tpl_e_resp" class="form-input" style="flex:1;min-width:120px">
          <option value="">Sem responsável</option>
          ${membros.map(m => `<option value="${m.id}">${m.nome}</option>`).join('')}
        </select>
        <button type="button" class="btn-icon" onclick="this.closest('.tpl-etapa-row').remove()" style="color:var(--danger)"><i class="ph ph-trash"></i></button>
      </div>
    `;
    tplList.appendChild(row);
  }

  document.getElementById('btn-tpl-add-etapa')?.addEventListener('click', addTplEtapaRow);
  addTplEtapaRow();
}

// ---- Edit Template Modal ----
function openEditTemplateModal(template: WorkflowTemplate, data: BoardData): void {
  const { membros } = data;

  const body = `
    <div class="form-group"><label>Nome</label>
      <input name="edit_tpl_nome" class="form-input" required value="${template.nome}">
    </div>
    <div id="edit-tpl-etapas-list"></div>
    <button type="button" class="btn-secondary" id="btn-edit-tpl-add-etapa" style="margin-top:0.5rem">
      <i class="ph ph-plus"></i> Adicionar Etapa
    </button>
  `;

  openModal(`Editar Template: ${template.nome}`, body, async (form) => {
    const fd = new FormData(form);
    const nome = (fd.get('edit_tpl_nome') as string || '').trim();
    if (!nome) { showToast('Nome do template é obrigatório.', 'error'); return; }

    const rows = form.querySelectorAll('.edit-tpl-etapa-row');
    if (rows.length === 0) { showToast('Adicione pelo menos uma etapa.', 'error'); return; }

    const etapas = Array.from(rows).map(row => ({
      nome: (row.querySelector('[name="edit_tpl_e_nome"]') as HTMLInputElement)?.value?.trim() || '',
      prazo_dias: Number((row.querySelector('[name="edit_tpl_e_prazo"]') as HTMLInputElement)?.value) || 1,
      tipo_prazo: ((row.querySelector('[name="edit_tpl_e_tipo"]') as HTMLSelectElement)?.value || 'corridos') as 'uteis' | 'corridos',
      responsavel_id: Number((row.querySelector('[name="edit_tpl_e_resp"]') as HTMLSelectElement)?.value) || null,
    })).filter(e => e.nome);

    if (etapas.length === 0) { showToast('Etapas precisam ter nomes.', 'error'); return; }

    try {
      await updateWorkflowTemplate(template.id!, { nome, etapas });
      showToast('Template atualizado!');
      closeModal();
      navigate('/entregas');
    } catch (err) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
    }
  }, { submitText: 'Salvar' });

  function addEditTplEtapaRow(formCtx: HTMLElement, etapa?: { nome: string; prazo_dias: number; tipo_prazo: string; responsavel_id?: number | null }) {
    const tplList = formCtx.querySelector('#edit-tpl-etapas-list');
    if (!tplList) return;
    const isNew = !etapa;
    const nome = etapa?.nome || '';
    const prazo = etapa?.prazo_dias || 3;
    const tipo = etapa?.tipo_prazo || 'corridos';
    const respId = etapa?.responsavel_id || null;

    const row = document.createElement('div');
    row.className = 'edit-tpl-etapa-row tpl-etapa-row';
    row.innerHTML = `
      <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;flex-wrap:wrap">
        <input name="edit_tpl_e_nome" class="form-input" placeholder="Nome" style="flex:2;min-width:120px" value="${nome}">
        <input name="edit_tpl_e_prazo" type="number" min="1" value="${prazo}" class="form-input" style="width:70px" title="Prazo (dias)">
        <select name="edit_tpl_e_tipo" class="form-input" style="width:110px">
          <option value="corridos" ${tipo === 'corridos' ? 'selected' : ''}>Corridos</option>
          <option value="uteis" ${tipo === 'uteis' ? 'selected' : ''}>Úteis</option>
        </select>
        <select name="edit_tpl_e_resp" class="form-input" style="flex:1;min-width:120px">
          <option value="">Sem responsável</option>
          ${membros.map(m => `<option value="${m.id}" ${respId === m.id ? 'selected' : ''}>${m.nome}</option>`).join('')}
        </select>
        <button type="button" class="btn-icon" onclick="this.closest('.edit-tpl-etapa-row').remove()" style="color:var(--danger)"><i class="ph ph-trash"></i></button>
      </div>
    `;
    tplList.appendChild(row);
  }

  // Need to get the specific form created by openModal, because multiple might exist
  // We can just rely on the latest modal overlay.
  const overlays = document.querySelectorAll('#modal-overlay');
  const currentOverlay = overlays[overlays.length - 1];
  const formCtx = currentOverlay.querySelector('#modal-form') as HTMLElement;

  formCtx.querySelector('#btn-edit-tpl-add-etapa')?.addEventListener('click', () => addEditTplEtapaRow(formCtx));
  
  if (template.etapas && template.etapas.length > 0) {
    template.etapas.forEach(e => addEditTplEtapaRow(formCtx, e));
  } else {
    addEditTplEtapaRow(formCtx);
  }
}
