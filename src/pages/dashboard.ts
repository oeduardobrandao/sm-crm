// =============================================
// Página: Dashboard
// =============================================
import { getDashboardStats, formatBRL, getInitials } from '../store';

export async function renderDashboard(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const stats = await getDashboardStats();
    const { clientesAtivos, receitaMensal, despesaTotal, saldo, transacoes } = stats;

    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title">
          <h1>Painel de Controle</h1>
          <p>Visão geral do seu negócio.</p>
        </div>
      </header>

      <div class="kpi-grid animate-up">
        <div class="kpi-card card-dark">
          <span class="kpi-label" style="color: rgba(255,255,255,0.7)">RECEITAS MENSAIS</span>
          <span class="kpi-value" style="color: #ffffff">${formatBRL(receitaMensal)}</span>
          <span class="kpi-sub" style="color:var(--success)">↑ ${clientesAtivos.length} clientes ativos</span>
        </div>
        <div class="kpi-card card-blue">
          <span class="kpi-label" style="color: rgba(255,255,255,0.7)">DESPESAS MENSAIS</span>
          <span class="kpi-value" style="color: #ffffff">${formatBRL(despesaTotal)}</span>
          <span class="kpi-sub" style="color:rgba(255,255,255,0.8)">↓ ${transacoes.filter(t => t.tipo === 'saida').length} saídas registradas</span>
        </div>
        <div class="kpi-card card-yellow">
          <span class="kpi-label" style="color: var(--dark)">SALDO TOTAL</span>
          <span class="kpi-value" style="color: var(--dark)">${formatBRL(saldo)}</span>
          <span class="kpi-sub" style="color:var(--dark)">✓ Saldo ${saldo >= 0 ? 'positivo' : 'negativo'}</span>
        </div>
      </div>

      <div class="widgets-grid animate-up">
        <div class="card">
          <h3>Receita por Cliente</h3>
          <div class="client-list" style="margin-top:1rem">
            ${clientesAtivos.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum cliente ativo. Cadastre na aba Clientes.</p>' : clientesAtivos.map(c => `
              <div class="client-row">
                <div style="display:flex;align-items:center;gap:0.75rem">
                  <div class="avatar" style="background:${c.cor}">${getInitials(c.nome)}</div>
                  <div>
                    <strong>${c.nome}</strong>
                    <div style="font-size:0.75rem;color:var(--text-muted)">${c.plano}</div>
                  </div>
                </div>
                <span style="font-weight:600;color:var(--success)">${formatBRL(Number(c.valor_mensal))}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <h3>Movimentações Recentes</h3>
          <div class="client-list" style="margin-top:1rem">
            ${transacoes.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">Nenhuma movimentação registrada.</p>' : transacoes.slice(0, 5).map(t => `
              <div class="client-row">
                <div>
                  <strong>${t.descricao}</strong>
                  <div style="font-size:0.75rem;color:var(--text-muted)">${t.categoria}</div>
                </div>
                <span style="font-weight:600;color:${t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">
                  ${t.tipo === 'entrada' ? '+' : '-'} ${formatBRL(Number(t.valor))}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro ao carregar dashboard: ${message}</p></div>`;
  }
}
