// =============================================
// Página: Leads
// =============================================
import { getLeads, addLead, updateLead, removeLead, type Lead } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm, sanitizeUrl } from '../router';
import { openCSVSelector } from '../lib/csv';

const STATUS_CYCLE: Lead['status'][] = ['novo', 'contatado', 'qualificado', 'perdido', 'convertido'];
const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  qualificado: 'Qualificado',
  perdido: 'Perdido',
  convertido: 'Convertido',
};
const STATUS_BADGE: Record<string, string> = {
  novo: 'badge-info',
  contatado: 'badge-warning',
  qualificado: 'badge-success',
  perdido: 'badge-neutral',
  convertido: 'badge-primary',
};

const FATURAMENTO_OPTIONS = [
  'Até R$ 5.000/mês',
  'De R$ 5.000 a R$ 10.000/mês',
  'De R$ 10.000 a R$ 20.000/mês',
  'De R$ 20.000 a R$ 50.000/mês',
  'Acima de R$ 50.000/mês',
];

const CANAL_OPTIONS = ['Instagram', 'Facebook', 'Google Ads', 'Indicação', 'Site', 'WhatsApp', 'Typeform', 'Outro'];

const PAGE_SIZE = 10;

// ---------- Instagram URL parser ----------
function parseInstagram(input: string): string {
  const url = sanitizeUrl(input.trim());
  if (url) {
    const m = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
    if (m) return '@' + m[1];
  }
  const clean = input.trim().replace(/^@+/, '');
  if (/^[a-zA-Z0-9_.]+$/.test(clean) && clean.length > 0) return '@' + clean;
  return input.trim();
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ---------- Main render ----------
export async function renderLeads(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;
  try {
    const leads = await getLeads();
    renderContent(container, leads);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro ao carregar leads: ${msg}</p></div>`;
  }
}

// ---------- State ----------
interface State {
  filter: string;
  sort: { col: string; dir: 'asc' | 'desc' };
  page: number;
  expandedIds: Set<number>;
  search: string;
}

function renderContent(container: HTMLElement, allLeads: Lead[], state?: State): void {
  const s: State = state ?? { filter: 'todos', sort: { col: 'created_at', dir: 'desc' }, page: 1, expandedIds: new Set(), search: '' };

  // --- Search ---
  let leads = s.search
    ? allLeads.filter(l =>
        [l.nome, l.email, l.instagram, l.especialidade, l.canal, l.tags].some(
          v => v?.toLowerCase().includes(s.search.toLowerCase())
        )
      )
    : [...allLeads];

  // --- Filter ---
  if (s.filter !== 'todos') leads = leads.filter(l => l.status === s.filter);

  // --- Sort ---
  leads.sort((a, b) => {
    let va: any = (a as any)[s.sort.col] ?? '';
    let vb: any = (b as any)[s.sort.col] ?? '';
    if (s.sort.col === 'created_at') { va = new Date(va).getTime(); vb = new Date(vb).getTime(); }
    if (va < vb) return s.sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return s.sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  // --- Paginate ---
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const page = Math.min(s.page, totalPages);
  const paginated = leads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const sortIcon = (col: string) => s.sort.col === col
    ? `<i class="ph ph-caret-${s.sort.dir === 'asc' ? 'up' : 'down'}" style="margin-left:4px;font-size:0.75rem"></i>`
    : `<i class="ph ph-caret-up-down" style="margin-left:4px;font-size:0.75rem;opacity:0.35"></i>`;

  const filters = ['todos', 'novo', 'contatado', 'qualificado', 'perdido', 'convertido'];

  // --- Save Search Focus State ---
  const activeSearchInput = container.querySelector('#leads-search') as HTMLInputElement | null;
  const isSearchFocused = document.activeElement === activeSearchInput;
  const cursorStart = activeSearchInput?.selectionStart ?? 0;
  const cursorEnd = activeSearchInput?.selectionEnd ?? 0;

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Leads</h1>
        <p>${allLeads.length} leads • ${allLeads.filter(l => l.status === 'novo').length} novos</p>
      </div>
      <div class="header-actions">
        <div style="display:flex;align-items:center;gap:0.5rem">
          <button class="btn-secondary" id="btn-import-csv" title="Importar leads via CSV">
            <i class="ph ph-file-csv"></i> Importar CSV
          </button>
          <span id="btn-info-csv" data-tooltip="Ver formato esperado do CSV" data-tooltip-dir="bottom" style="display:flex;align-items:center;cursor:pointer">
            <i class="ph ph-info icon-primary-hover" style="font-size:1.2rem"></i>
          </span>
        </div>
        <button class="btn-secondary" id="btn-ig-lead" title="Adicionar via Instagram">
          <i class="ph ph-instagram-logo"></i> Via Instagram
        </button>
        <button class="btn-primary" id="btn-add-lead">
          <i class="ph ph-plus"></i> Novo Lead
        </button>
      </div>
    </header>

    <!-- Search + Filters -->
    <div class="leads-toolbar animate-up">
      <input class="filter-btn leads-search" id="leads-search" placeholder="🔍 Buscar por nome, e-mail, instagram..." value="${s.search}" style="max-width:340px">
      <div class="filter-bar" style="margin:0">
        ${filters.map(f =>
          `<button class="filter-btn ${f === s.filter ? 'active' : ''}" data-filter="${f}">${f === 'todos' ? 'Todos' : STATUS_LABELS[f]}</button>`
        ).join('')}
      </div>
    </div>

    <div class="card animate-up" style="padding:0;overflow:hidden">
      <table class="data-table leads-table">
        <thead>
          <tr>
            <th class="sortable" data-sort="nome">Lead ${sortIcon('nome')}</th>
            <th>Contato</th>
            <th class="sortable" data-sort="especialidade">Especialidade ${sortIcon('especialidade')}</th>
            <th class="sortable" data-sort="faturamento">Faturamento ${sortIcon('faturamento')}</th>
            <th class="sortable" data-sort="status">Status ${sortIcon('status')}</th>
            <th class="sortable" data-sort="created_at">Data ${sortIcon('created_at')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${paginated.length === 0
            ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:3rem">
                ${s.search ? 'Nenhum resultado para sua busca.' : s.filter !== 'todos' ? 'Nenhum lead com esse status.' : 'Nenhum lead ainda. Adicione o primeiro!'}
               </td></tr>`
            : paginated.map(l => {
                const isExpanded = s.expandedIds.has(l.id!);
                const igHandle = l.instagram || '';
                const igUrl = igHandle.startsWith('@')
                  ? `https://instagram.com/${igHandle.slice(1)}`
                  : sanitizeUrl(igHandle);
                const tagsList = l.tags ? l.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                return `
                  <tr class="lead-row">
                    <td data-label="Lead">
                      <div style="display:flex;flex-direction:column;gap:2px">
                        <strong>${l.nome}</strong>
                        ${l.origem !== 'manual' ? `<span class="lead-origin-tag lead-origin-${l.origem}">${l.origem === 'typeform' ? 'Typeform' : 'Instagram'}</span>` : ''}
                        ${tagsList.length ? `<div class="lead-tags-row">${tagsList.map(t => `<span class="lead-tag">${t}</span>`).join('')}</div>` : ''}
                      </div>
                    </td>
                    <td data-label="Contato" style="font-size:0.82rem;line-height:1.7">
                      ${l.email ? `<div><i class="ph ph-envelope" style="margin-right:3px"></i>${l.email}</div>` : ''}
                      ${l.telefone ? `<div><i class="ph ph-phone" style="margin-right:3px"></i>${l.telefone}</div>` : ''}
                      ${igHandle && igUrl ? `<div><a href="${igUrl}" target="_blank" rel="noopener noreferrer" class="ig-link"><i class="ph ph-instagram-logo"></i> ${igHandle}</a></div>` : igHandle ? `<div>${igHandle}</div>` : ''}
                      ${!l.email && !l.telefone && !igHandle ? '—' : ''}
                    </td>
                    <td data-label="Especialidade" style="font-size:0.88rem">${l.especialidade || '—'}</td>
                    <td data-label="Faturamento" style="font-size:0.82rem;white-space:nowrap">${l.faturamento ? `<span class="lead-fat-badge">${l.faturamento}</span>` : '—'}</td>
                    <td data-label="Status">
                      <button class="badge ${STATUS_BADGE[l.status] || 'badge-neutral'} status-dropdown-btn" data-id="${l.id}" data-status="${l.status}" title="Alterar status">${STATUS_LABELS[l.status] || l.status} <i class="ph ph-caret-down" style="margin-left:4px"></i></button>
                    </td>
                    <td data-label="Data" style="white-space:nowrap;font-size:0.85rem">${formatDate(l.created_at)}</td>
                    <td style="text-align:right;white-space:nowrap">
                      ${l.notas || l.objetivo ? `<button class="btn-icon notes-toggle-btn" data-id="${l.id}" title="${isExpanded ? 'Recolher' : 'Ver notas/objetivo'}"><i class="ph ph-${isExpanded ? 'caret-up' : 'notepad'}"></i></button>` : ''}
                      <button class="btn-icon btn-edit" data-id="${l.id}"><i class="ph ph-pencil-simple"></i></button>
                      <button class="btn-icon btn-remove" data-id="${l.id}" style="color:var(--danger)"><i class="ph ph-trash"></i></button>
                    </td>
                  </tr>
                  ${(l.notas || l.objetivo) && isExpanded ? `
                  <tr class="notes-expanded-row">
                    <td colspan="7">
                      <div class="lead-notes-expanded">
                        ${l.objetivo ? `<div style="margin-bottom:0.4rem"><strong style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--primary-color)">Objetivo:</strong> ${l.objetivo}</div>` : ''}
                        ${l.notas ? `<div><strong style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">Notas:</strong> ${l.notas}</div>` : ''}
                      </div>
                    </td>
                  </tr>` : ''}
                `;
              }).join('')}
        </tbody>
      </table>
    </div>

    ${totalPages > 1 ? `
    <div class="leads-pagination animate-up">
      <button class="btn-secondary" id="btn-prev-page" ${page <= 1 ? 'disabled' : ''}>
        <i class="ph ph-caret-left"></i>
      </button>
      <span style="font-size:0.9rem;color:var(--text-muted)">Página ${page} de ${totalPages}</span>
      <button class="btn-secondary" id="btn-next-page" ${page >= totalPages ? 'disabled' : ''}>
        <i class="ph ph-caret-right"></i>
      </button>
    </div>` : ''}
  `;

  // --- Restore Search Focus State ---
  if (isSearchFocused) {
    const newSearchInput = container.querySelector('#leads-search') as HTMLInputElement | null;
    if (newSearchInput) {
      newSearchInput.focus();
      try { newSearchInput.setSelectionRange(cursorStart, cursorEnd); } catch (e) {}
    }
  }

  // ---- Event listeners ----

  // Search
  const searchInput = container.querySelector('#leads-search') as HTMLInputElement;
  let searchTimeout: ReturnType<typeof setTimeout>;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderContent(container, allLeads, { ...s, search: searchInput.value, page: 1 });
    }, 250);
  });

  // Filter buttons
  container.querySelectorAll('button.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(container, allLeads, { ...s, filter: (btn as HTMLElement).dataset.filter || 'todos', page: 1 });
    });
  });

  // Sort headers
  container.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort!;
      const dir = s.sort.col === col && s.sort.dir === 'asc' ? 'desc' : 'asc';
      renderContent(container, allLeads, { ...s, sort: { col, dir }, page: 1 });
    });
  });

  // Pagination
  container.querySelector('#btn-prev-page')?.addEventListener('click', () =>
    renderContent(container, allLeads, { ...s, page: page - 1 }));
  container.querySelector('#btn-next-page')?.addEventListener('click', () =>
    renderContent(container, allLeads, { ...s, page: page + 1 }));

  // Notes expand
  container.querySelectorAll('.notes-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const newExpanded = new Set(s.expandedIds);
      if (newExpanded.has(id)) newExpanded.delete(id); else newExpanded.add(id);
      renderContent(container, allLeads, { ...s, expandedIds: newExpanded });
    });
  });

  // Status Dropdown Menu
  container.querySelectorAll('.status-dropdown-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number((btn as HTMLElement).dataset.id);
      const cur = (btn as HTMLElement).dataset.status as Lead['status'];
      
      // Remove any existing dropdowns
      document.querySelectorAll('.status-dropdown-menu').forEach(el => el.remove());
      
      const menu = document.createElement('div');
      menu.className = 'status-dropdown-menu';
      
      STATUS_CYCLE.forEach(next => {
        const item = document.createElement('button');
        item.className = `status-dropdown-item ${next === cur ? 'active' : ''}`;
        item.innerHTML = `<span>${STATUS_LABELS[next]}</span> ${next === cur ? '<i class="ph ph-check"></i>' : ''}`;
        item.addEventListener('click', async () => {
          if (next === cur) return;
          menu.remove();
          try {
            await updateLead(id, { status: next });
            showToast(`Status → ${STATUS_LABELS[next]}`, 'success');
            renderContent(container, allLeads.map(l => l.id === id ? { ...l, status: next } : l), s);
          } catch (err) {
            showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
          }
        });
        menu.appendChild(item);
      });

      // Position it right below the button
      const rect = btn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${rect.left}px`;
      document.body.appendChild(menu);

      // Close if clicking outside
      const closeMenu = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      
      // setTimeout to avoid immediate trigger the document click
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });
  });

  // Via Instagram button
  container.querySelector('#btn-ig-lead')?.addEventListener('click', () => {
    openModal('Adicionar via Instagram', `
      <div class="form-group">
        <label>Cole a URL ou @username do Instagram</label>
        <input name="ig_input" class="form-input" placeholder="https://instagram.com/usuario ou @usuario" autofocus>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.4rem">
          <i class="ph ph-info"></i> O @handle será preenchido automaticamente no formulário.
        </p>
      </div>
    `, (form) => {
      const raw = (new FormData(form).get('ig_input') as string || '').trim();
      const ig = parseInstagram(raw);
      closeModal();
      openLeadModal(undefined, { instagram: ig, origem: 'instagram' }, allLeads, container, s);
    }, { submitText: 'Continuar →' });
  });

  // Add Lead
  container.querySelector('#btn-add-lead')?.addEventListener('click', () => {
    openLeadModal(undefined, {}, allLeads, container, s);
  });

  // Edit Lead
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const lead = allLeads.find(l => l.id === id);
      if (lead) openLeadModal(lead, {}, allLeads, container, s);
    });
  });

  // Remove Lead
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      openConfirm('Remover Lead', 'Remover este lead permanentemente?', async () => {
        try {
          await removeLead(id);
          showToast('Lead removido.');
          renderContent(container, allLeads.filter(l => l.id !== id), { ...s, page: 1 });
        } catch (err) {
          showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro'), 'error');
        }
      }, true);
    });
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
            <tr><td><code>nome</code></td><td style="color:var(--danger)">Sim</td><td>Dra. Ana Clara</td></tr>
            <tr><td><code>email</code></td><td>Não</td><td>ana@clinica.com</td></tr>
            <tr><td><code>telefone</code></td><td>Não</td><td>+55 11 98765-4321</td></tr>
            <tr><td><code>instagram</code></td><td>Não</td><td>@draanaclara</td></tr>
            <tr><td><code>especialidade</code></td><td>Não</td><td>Ginecologia</td></tr>
            <tr><td><code>faturamento</code></td><td>Não</td><td>De R$ 10.000 a R$ 20.000/mês</td></tr>
            <tr><td><code>objetivo</code></td><td>Não</td><td>Captar mais pacientes</td></tr>
            <tr><td><code>canal</code></td><td>Não</td><td>Instagram</td></tr>
            <tr><td><code>tags</code></td><td>Não</td><td>nutrição, sp</td></tr>
            <tr><td><code>notas</code></td><td>Não</td><td>Lead quente</td></tr>
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:1rem">
        <i class="ph ph-info"></i> Deduplicação automática por <strong>e-mail</strong>, depois <strong>instagram</strong>, depois <strong>telefone</strong>.
        Linhas duplicadas são ignoradas, não sobrescritas.
      </p>
    `, () => closeModal(), { submitText: 'Fechar', cancelText: '' });
  });

  // --- CSV Import with deduplication ---
  container.querySelector('#btn-import-csv')?.addEventListener('click', () => {
    openCSVSelector(
      async (rows) => {
        await importLeadsFromCSV(rows, allLeads, container, s);
      },
      (err) => showToast('Erro ao ler CSV: ' + err.message, 'error')
    );
  });
}

// ---------- CSV Import with deduplication ----------
function normalizePhone(p: string): string {
  return p.replace(/\D/g, '');
}

function normalizeIg(ig: string): string {
  return ig.toLowerCase().replace(/^@+/, '');
}

export async function importLeadsFromCSV(
  rows: Record<string, string>[],
  existingLeads: Lead[],
  container: HTMLElement,
  state: State
): Promise<void> {
  const total   = rows.length;
  let imported  = 0;
  let skipped   = 0;
  let failed    = 0;
  const failedNames: string[] = [];
  const newLeads: Lead[]      = [];

  // Build dedup lookup sets from existing leads
  const existingEmails = new Set(
    existingLeads.filter(l => l.email).map(l => l.email.toLowerCase())
  );
  const existingIg = new Set(
    existingLeads.filter(l => l.instagram).map(l => normalizeIg(l.instagram))
  );
  const existingPhones = new Set(
    existingLeads.filter(l => l.telefone)
      .map(l => normalizePhone(l.telefone))
      .filter(Boolean)
  );

  for (const row of rows) {
    const nome = (row['nome'] || row['name'] || '').trim();
    if (!nome) { failed++; continue; }

    const email     = (row['email'] || '').trim();
    const instagram = row['instagram'] ? parseInstagram(row['instagram']) : '';
    const telefone  = (row['telefone'] || row['phone'] || '').trim();

    // Deduplication check (email -> instagram -> telefone)
    const phoneNorm = normalizePhone(telefone);
    const isDuplicate =
      (email     && existingEmails.has(email.toLowerCase()))  ||
      (instagram && existingIg.has(normalizeIg(instagram)))   ||
      (phoneNorm && existingPhones.has(phoneNorm));

    if (isDuplicate) { skipped++; continue; }

    try {
      const payload = {
        nome,
        email,
        telefone,
        instagram,
        canal:         (row['canal']         || '').trim(),
        especialidade: (row['especialidade'] || '').trim(),
        faturamento:   (row['faturamento']   || '').trim(),
        objetivo:      (row['objetivo']      || '').trim(),
        tags:          (row['tags']          || '').trim(),
        notas:         (row['notas']         || row['notes'] || '').trim(),
        origem: 'manual' as const,
        status: 'novo' as const,
      };

      const created = await addLead(payload);
      newLeads.push(created);
      imported++;

      // Update sets so intra-batch duplicates are also caught
      if (email)     existingEmails.add(email.toLowerCase());
      if (instagram) existingIg.add(normalizeIg(instagram));
      if (phoneNorm) existingPhones.add(phoneNorm);
    } catch {
      failed++;
      failedNames.push(nome);
    }
  }

  // Render everything to reflect the new state immediately!
  renderContent(container, [...newLeads, ...existingLeads], state);

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
  `, () => closeModal(), { submitText: 'Fechar', cancelText: '' });
}

// ---------- Lead modal ----------
function openLeadModal(
  lead: Lead | undefined,
  prefill: Partial<Lead>,
  allLeads: Lead[],
  container: HTMLElement,
  state: State
): void {
  const isEditing = !!lead;
  const v = (field: keyof Lead) => ((lead?.[field] ?? prefill[field] ?? '') as string);

  openModal(isEditing ? 'Editar Lead' : 'Novo Lead', `
    <div class="form-row">
      <div class="form-group"><label>Nome *</label>
        <input name="nome" class="form-input" required value="${v('nome')}" autofocus>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>E-mail</label>
        <input name="email" type="email" class="form-input" value="${v('email')}">
      </div>
      <div class="form-group"><label>Telefone</label>
        <input name="telefone" class="form-input" placeholder="+55 (11) 99999-9999" value="${v('telefone')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label><i class="ph ph-instagram-logo"></i> Instagram</label>
        <input name="instagram" class="form-input" placeholder="@usuario" value="${v('instagram')}">
      </div>
      <div class="form-group"><label>Canal de Aquisição</label>
        <input name="canal" class="form-input" list="canal-options" placeholder="Instagram, Indicação..." value="${v('canal')}">
        <datalist id="canal-options">${CANAL_OPTIONS.map(c => `<option value="${c}">`).join('')}</datalist>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Especialidade</label>
        <input name="especialidade" class="form-input" placeholder="Ex: Ginecologia, Odontologia..." value="${v('especialidade')}">
      </div>
      <div class="form-group"><label>Faturamento Mensal</label>
        <select name="faturamento" class="form-input">
          <option value="">Selecionar...</option>
          ${FATURAMENTO_OPTIONS.map(f => `<option value="${f}" ${v('faturamento') === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group"><label>Objetivo</label>
      <input name="objetivo" class="form-input" placeholder="Ex: Captar mais pacientes, aumentar faturamento..." value="${v('objetivo')}">
    </div>
    <div class="form-group"><label>Tags <span style="font-size:0.75rem;color:var(--text-muted)">(separadas por vírgula)</span></label>
      <input name="tags" class="form-input" placeholder="nutrição, cirurgia, sp..." value="${v('tags')}">
    </div>
    ${isEditing ? `
    <div class="form-row">
      <div class="form-group"><label>Status</label>
        <select name="status" class="form-input">
          ${STATUS_CYCLE.map(st => `<option value="${st}" ${lead?.status === st ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
        </select>
      </div>
    </div>` : ''}
    <div class="form-group"><label>Notas</label>
      <textarea name="notas" class="form-input" rows="3" placeholder="Observações adicionais...">${v('notas')}</textarea>
    </div>
  `, async (form) => {
    const d = new FormData(form);
    const nome = (d.get('nome') as string || '').trim();
    if (!nome) { showToast('Nome é obrigatório.', 'error'); return; }

    const igRaw = d.get('instagram') as string;
    const ig = igRaw ? parseInstagram(igRaw) : '';

    const payload = {
      nome,
      email:         d.get('email') as string || '',
      telefone:      d.get('telefone') as string || '',
      instagram:     ig,
      canal:         d.get('canal') as string || '',
      especialidade: d.get('especialidade') as string || '',
      faturamento:   d.get('faturamento') as string || '',
      objetivo:      d.get('objetivo') as string || '',
      tags:          d.get('tags') as string || '',
      notas:         d.get('notas') as string || '',
      origem:        lead?.origem ?? prefill.origem ?? 'manual' as Lead['origem'],
      status:        (isEditing ? (d.get('status') as Lead['status']) : 'novo') as Lead['status'],
    };

    try {
      if (isEditing && lead!.id) {
        const updated = await updateLead(lead!.id, payload);
        showToast(`Lead '${nome}' atualizado!`);
        closeModal();
        renderContent(container, allLeads.map(l => l.id === lead!.id ? updated : l), state);
      } else {
        const created = await addLead(payload);
        showToast(`Lead '${nome}' adicionado!`);
        closeModal();
        renderContent(container, [created, ...allLeads], state);
      }
    } catch (err) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Erro ao salvar'), 'error');
    }
  }, { submitText: isEditing ? 'Salvar' : 'Adicionar Lead' });
}
