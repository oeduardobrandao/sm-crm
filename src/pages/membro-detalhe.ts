// =============================================
// Página: Detalhe do Membro
// =============================================
import { getMembros, getTransacoes, formatBRL, formatDate, getInitials, updateMembro, type Membro } from '../store';
import { showToast, navigate, openModal, closeModal } from '../router';

export async function renderMembroDetalhe(container: HTMLElement, param?: string): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  if (!param) {
    navigate('/equipe');
    return;
  }

  const membroId = Number(param);

  try {
    const [membros, transacoes] = await Promise.all([
      getMembros(),
      getTransacoes()
    ]);

    const membro = membros.find(m => m.id === membroId);
    if (!membro) {
      container.innerHTML = `
        <header class="header animate-up">
          <div class="header-title">
            <h1>Membro não encontrado</h1>
            <p>O membro solicitado não existe ou foi removido.</p>
          </div>
          <button class="btn-secondary" onclick="window.location.hash='#/equipe'"><i class="ph ph-arrow-left"></i> Voltar</button>
        </header>`;
      return;
    }

    const tipoLabel = (t: string) => t === 'clt' ? 'CLT' : t === 'freelancer_mensal' ? 'Freelancer (Mensal)' : 'Freelancer (Demanda)';
    const tipoBadge = (t: string) => t === 'clt' ? 'success' : t === 'freelancer_mensal' ? 'warning' : 'neutral';

    // Find transactions related to this member by matching description pattern
    const membroTransacoes = transacoes.filter(t =>
      t.descricao?.includes(membro.nome) || t.referencia_agendamento?.includes(`membro_${membro.id}`)
    );

    const totalPago = membroTransacoes
      .filter(t => t.status === 'pago')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const totalPendente = membroTransacoes
      .filter(t => t.status === 'agendado')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title" style="display:flex;align-items:center;gap:1.25rem">
          <div class="avatar" style="width:56px;height:56px;font-size:1.3rem">${getInitials(membro.nome)}</div>
          <div>
            <h1 style="margin-bottom:0.25rem">${membro.nome}</h1>
            <p style="display:flex;align-items:center;gap:0.75rem">
              ${membro.cargo ? `<span>${membro.cargo}</span>` : ''}
              <span class="badge badge-${tipoBadge(membro.tipo)}">${tipoLabel(membro.tipo)}</span>
            </p>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button class="btn-secondary" id="btn-back"><i class="ph ph-arrow-left"></i> Voltar</button>
          <button class="btn-primary" id="btn-edit-membro"><i class="ph ph-pencil-simple"></i> Editar</button>
        </div>
      </header>

      <!-- KPI Cards -->
      <div class="kpi-grid animate-up" style="margin-bottom:2rem">
        <div class="kpi-card">
          <span class="kpi-label">CUSTO MENSAL</span>
          <span class="kpi-value">${membro.custo_mensal ? formatBRL(Number(membro.custo_mensal)) : 'Sob demanda'}</span>
          <span class="kpi-sub" style="color:var(--primary-color)">${tipoLabel(membro.tipo)}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">TOTAL PAGO</span>
          <span class="kpi-value">${formatBRL(totalPago)}</span>
          <span class="kpi-sub" style="color:var(--danger)">↓ ${membroTransacoes.filter(t => t.status === 'pago').length} pagamentos</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">PENDENTE</span>
          <span class="kpi-value">${formatBRL(totalPendente)}</span>
          <span class="kpi-sub" style="color:var(--warning)">◉ ${membroTransacoes.filter(t => t.status === 'agendado').length} agendados</span>
        </div>
      </div>

      <!-- Info Card -->
      <div class="card animate-up" style="margin-bottom:2rem">
        <h3 style="margin-bottom:1.25rem"><i class="ph ph-identification-card" style="margin-right:0.5rem;color:var(--primary-color)"></i> Informações</h3>
        <div class="client-info-grid">
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-briefcase"></i> Cargo</span>
            <span class="client-info-value">${membro.cargo || '—'}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-tag"></i> Tipo</span>
            <span class="client-info-value">${tipoLabel(membro.tipo)}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-calendar-blank"></i> Dia de Pagamento</span>
            <span class="client-info-value">${membro.data_pagamento ? 'Dia ' + membro.data_pagamento : '—'}</span>
          </div>
          <div class="client-info-item">
            <span class="client-info-label"><i class="ph ph-money"></i> Custo Mensal</span>
            <span class="client-info-value">${membro.custo_mensal ? formatBRL(Number(membro.custo_mensal)) : 'Sob demanda'}</span>
          </div>
        </div>
      </div>

      <!-- Transações -->
      <div class="card animate-up">
        <h3 style="margin-bottom:1.25rem"><i class="ph ph-currency-circle-dollar" style="margin-right:0.5rem;color:var(--primary-color)"></i> Pagamentos Relacionados (${membroTransacoes.length})</h3>
        ${membroTransacoes.length === 0 ? '<p style="color:var(--text-muted);font-size:0.9rem">Nenhum pagamento relacionado a este membro.</p>' : `
        <table class="data-table">
          <thead><tr><th>Descrição</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            ${membroTransacoes.map(t => `
              <tr>
                <td data-label="Descrição"><strong>${t.descricao}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">${t.categoria}</span></td>
                <td data-label="Data">${formatDate(t.data)}</td>
                <td data-label="Valor" style="color:var(--danger)">- ${formatBRL(Number(t.valor))}</td>
                <td data-label="Status"><span class="badge badge-${t.status === 'pago' ? 'success' : 'warning'}">${t.status === 'pago' ? 'Pago' : 'Agendado'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
    `;

    // Back button
    container.querySelector('#btn-back')?.addEventListener('click', () => {
      window.history.back();
    });

    // Edit button
    container.querySelector('#btn-edit-membro')?.addEventListener('click', () => {
      openModal('Editar Membro', `
        <div class="form-row">
          <div class="form-group"><label>Nome</label>
          <input name="nome" class="form-input" required value="${membro.nome}"></div>
          <div class="form-group"><label>Cargo</label>
          <input name="cargo" class="form-input" value="${membro.cargo || ''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tipo</label>
            <select name="tipo" class="form-input">
              <option value="freelancer_mensal" ${membro.tipo === 'freelancer_mensal' ? 'selected' : ''}>Freelancer (Mensal)</option>
              <option value="clt" ${membro.tipo === 'clt' ? 'selected' : ''}>CLT</option>
              <option value="freelancer_demanda" ${membro.tipo === 'freelancer_demanda' ? 'selected' : ''}>Freelancer (Demanda)</option>
            </select>
          </div>
          <div class="form-group"><label>Custo Mensal</label>
          <input name="custo_mensal" type="number" step="0.01" class="form-input" value="${membro.custo_mensal || ''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Dia de Pagamento (Data Base)</label>
          <input name="data_pagamento" type="number" min="1" max="31" class="form-input" placeholder="Ex: 5" value="${membro.data_pagamento || ''}"></div>
        </div>
      `, async (form) => {
        const d = new FormData(form);
        try {
          await updateMembro(membro.id!, {
            nome: d.get('nome') as string,
            cargo: d.get('cargo') as string || '',
            tipo: d.get('tipo') as 'clt' | 'freelancer_mensal' | 'freelancer_demanda',
            custo_mensal: parseFloat(d.get('custo_mensal') as string) || null,
            avatar_url: membro.avatar_url || '',
            data_pagamento: parseInt(d.get('data_pagamento') as string) || undefined,
          });
          showToast('Membro atualizado!');
          closeModal();
          navigate('/membro/' + membroId);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro';
          showToast('Erro: ' + message, 'error');
        }
      });
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}
