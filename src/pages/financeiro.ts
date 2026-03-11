// =============================================
// Página: Financeiro
// =============================================
import { getClientes, getTransacoes, getMembros, projetarAgendamentos, addTransacao, updateTransacao, removeTransacao, formatBRL, formatDate, type Transacao } from '../store';
import { showToast, openModal, closeModal, navigate, openConfirm } from '../router';

export async function renderFinanceiro(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const [clientes, membros, transacoesFisicas] = await Promise.all([getClientes(), getMembros(), getTransacoes()]);

    // Projeção On-The-Fly: Agendamentos Virtuais do mês atual
    const transacoes = projetarAgendamentos(transacoesFisicas, clientes, membros)
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    const clientesAtivos = clientes.filter(c => c.status === 'ativo');
    const aReceber = transacoes.filter(t => t.tipo === 'entrada').reduce((s, t) => s + Number(t.valor), 0);
    const saidas = transacoes.filter(t => t.tipo === 'saida');
    const aPagar = saidas.reduce((s, t) => s + Number(t.valor), 0);

    renderContent(container, transacoes, 'todas', aReceber, aPagar, clientesAtivos.length, saidas.length);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro: ${message}</p></div>`;
  }
}

function renderContent(
  container: HTMLElement, transacoes: Transacao[], filter: string,
  aReceber: number, aPagar: number, nClientes: number, nSaidas: number
): void {
  const filtered = filter === 'todas' ? transacoes : transacoes.filter(t => t.tipo === (filter === 'entradas' ? 'entrada' : 'saida'));

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Controle Financeiro</h1>
        <p>Visão detalhada do fluxo de caixa.</p>
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn-primary" id="btn-add-entrada"><i class="fa-solid fa-arrow-down"></i> Registrar Entrada</button>
        <button class="btn-secondary" id="btn-add-saida"><i class="fa-solid fa-arrow-up"></i> Registrar Saída</button>
      </div>
    </header>

    <div class="kpi-grid animate-up">
      <div class="kpi-card">
        <span class="kpi-label">A RECEBER (MÊS)</span>
        <span class="kpi-value">${formatBRL(aReceber)}</span>
        <span class="kpi-sub" style="color:var(--success)">↑ ${nClientes} clientes ativos</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">A PAGAR (MÊS)</span>
        <span class="kpi-value">${formatBRL(aPagar)}</span>
        <span class="kpi-sub" style="color:var(--danger)">↓ ${nSaidas} saídas</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">SALDO</span>
        <span class="kpi-value">${formatBRL(aReceber - aPagar)}</span>
        <span class="kpi-sub" style="color:var(--primary-color)">■ Contratos + transações</span>
      </div>
    </div>

    <div class="filter-bar animate-up">
      ${['todas', 'entradas', 'saidas'].map(f =>
        `<button class="filter-btn ${f === filter ? 'active' : ''}" data-filter="${f}">${f === 'todas' ? 'Todas' : f === 'entradas' ? 'Entradas' : 'Saídas'}</button>`
      ).join('')}
    </div>

    <div class="card animate-up">
      <h3 style="margin-bottom:1rem">Movimentações (${filtered.length})</h3>
      <table class="data-table">
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${filtered.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem">Nenhuma movimentação.</td></tr>' :
            filtered.map(t => `
              <tr>
                <td data-label="Data">${formatDate(t.data)}</td>
                <td data-label="Descrição"><strong>${t.descricao}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">${t.detalhe || ''}</span></td>
                <td data-label="Categoria">${t.categoria}</td>
                <td data-label="Valor" style="font-weight:600;color:${t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">
                  ${t.tipo === 'entrada' ? '+' : '-'} ${formatBRL(Number(t.valor))}
                </td>
                <td data-label="Status">
                  <span class="badge ${t.status === 'agendado' ? 'badge-warning' : 'badge-success'}">
                    ${t.status === 'agendado' ? 'Agendado' : 'Pago'}
                  </span>
                </td>
                <td data-label="Ações" style="text-align: right; display:flex; gap: 0.5rem; justify-content: flex-end;">
                  ${t.status === 'agendado' ? `<button class="btn-icon btn-confirm" data-idref="${t.referencia_agendamento}" title="Confirmar Pagamento"><i class="ph ph-check-circle" style="color:var(--success); font-size:1.2rem"></i></button>` : ''}
                  ${t.status === 'pago' ? `<button class="btn-icon btn-edit" data-id="${t.id}"><i class="ph ph-pencil-simple"></i></button>
                  <button class="btn-icon btn-remove" style="color:var(--danger)" data-id="${t.id}"><i class="ph ph-trash"></i></button>` : ''}
                </td>
              </tr>
           `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Filters
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(container, transacoes, (btn as HTMLElement).dataset.filter || 'todas', aReceber, aPagar, nClientes, nSaidas);
    });
  });

  // Modal Helper (Add or Edit)
  const openTransacaoModal = (tipo: 'entrada' | 'saida', transacao?: Transacao) => {
    const actionLabel = transacao ? 'Editar' : 'Registrar';
    const tNome = tipo === 'entrada' ? 'Entrada' : 'Saída';
    
    openModal(`${actionLabel} ${tNome}`, `
      <div class="form-row">
        <div class="form-group"><label>Descrição</label>
        <input name="descricao" class="form-input" required value="${transacao?.descricao || ''}"></div>
        <div class="form-group"><label>Valor (R$)</label>
        <input name="valor" type="number" step="0.01" class="form-input" required value="${transacao?.valor || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Categoria</label>
        <input name="categoria" class="form-input" placeholder="ex: Mensalidade, Software" value="${transacao?.categoria || ''}"></div>
        <div class="form-group"><label>Data</label>
        <input name="data" type="date" class="form-input" value="${transacao?.data || new Date().toISOString().split('T')[0]}"></div>
      </div>
    `, async (form) => {
      const d = new FormData(form);
      try {
        const payload = {
          descricao: d.get('descricao') as string,
          detalhe: '',
          categoria: d.get('categoria') as string || '',
          valor: parseFloat(d.get('valor') as string) || 0,
          data: d.get('data') as string || new Date().toISOString().split('T')[0]
        };
        
        if (transacao?.id) {
          await updateTransacao(transacao.id, payload);
          showToast(`${tNome} atualizada!`);
        } else {
          await addTransacao({ ...payload, tipo });
          showToast(`${tNome} registrada!`);
        }
        
        closeModal();
        navigate('/financeiro');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro';
        showToast('Erro: ' + message, 'error');
      }
    });
  };

  container.querySelector('#btn-add-entrada')?.addEventListener('click', () => openTransacaoModal('entrada'));
  container.querySelector('#btn-add-saida')?.addEventListener('click', () => openTransacaoModal('saida'));
  
  // --- Confirmar Agendamento ---
  container.querySelectorAll('.btn-confirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idRef = (btn as HTMLElement).dataset.idref;
      const transacaoVirtual = transacoes.find(t => t.referencia_agendamento === idRef);
      if (!transacaoVirtual) return;

      openConfirm('Confirmar Transação', `Confirmar recebimento/pagamento de ${transacaoVirtual.descricao} (${formatBRL(Number(transacaoVirtual.valor))})?`, async () => {
        try {
          // Remove ID virtual and set status
          const payload = {
            descricao: transacaoVirtual.descricao,
            detalhe: transacaoVirtual.detalhe,
            categoria: transacaoVirtual.categoria,
            data: transacaoVirtual.data,
            valor: transacaoVirtual.valor,
            tipo: transacaoVirtual.tipo,
            status: 'pago' as const,
            referencia_agendamento: transacaoVirtual.referencia_agendamento
          };
          await addTransacao(payload);
          showToast('Pagamento confirmado com sucesso!', 'success');
          navigate('/financeiro');
        } catch (err: unknown) {
          showToast('Erro ao confirmar: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
        }
      });
    });
  });

  // --- Edit ---
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number((btn as HTMLElement).dataset.id);
      const transacao = transacoes.find(t => t.id === id);
      if (transacao) openTransacaoModal(transacao.tipo, transacao);
    });
  });

  // --- Remove ---
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number((btn as HTMLElement).dataset.id);
      openConfirm('Remover Movimentação', 'Remover esta movimentação? Esta ação não pode ser desfeita.', async () => {
        try {
          await removeTransacao(id);
          showToast('Movimentação removida.');
          navigate('/financeiro');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erro ao remover';
          showToast(message, 'error');
        }
      }, true);
    });
  });
}
