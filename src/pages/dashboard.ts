// =============================================
// Página: Dashboard (Hub)
// =============================================
import { getDashboardStats, getLeads, getContratos, getMembros, getClientes,
         formatBRL, formatDate, getInitials, getWorkflows, currentUserRole } from '../store';
import type { Lead, Contrato, Membro, Cliente, Workflow } from '../store';
import { getPortfolioSummary } from '../services/analytics';
import type { PortfolioSummary } from '../services/analytics';
import { escapeHTML } from '../router';

// Safe extractor for Promise.allSettled results
function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === 'fulfilled' ? r.value : fallback;
}

// Status label map for leads
const leadStatusLabel: Record<string, string> = {
  novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado',
  perdido: 'Perdido', convertido: 'Convertido',
};

const leadStatusColor: Record<string, string> = {
  novo: 'var(--primary-color)', contatado: 'var(--teal)',
  qualificado: 'var(--success)', perdido: 'var(--danger)', convertido: 'var(--pink)',
};

export async function renderDashboard(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh">
    <i class="ph ph-circle-notch" style="font-size:1.5rem;color:var(--primary-color);animation:spin 1s linear infinite"></i>
  </div>`;

  try {
    // Parallel data fetching — each section renders independently
    const [statsR, leadsR, contratosR, membrosR, clientesR, portfolioR, workflowsR] =
      await Promise.allSettled([
        getDashboardStats(),
        getLeads(),
        getContratos(),
        getMembros(),
        getClientes(),
        getPortfolioSummary(),
        getWorkflows(),
      ]);

    const stats = settled(statsR, { clientes: [] as Cliente[], clientesAtivos: [] as Cliente[], receitaMensal: 0, despesaTotal: 0, saldo: 0, transacoes: [] as any[] });
    const leads = settled(leadsR, [] as Lead[]);
    const contratos = settled(contratosR, [] as Contrato[]);
    const membros = settled(membrosR, [] as Membro[]);
    const clientes = settled(clientesR, [] as Cliente[]);
    const portfolio = settled(portfolioR, null as PortfolioSummary | null);
    const workflows = settled(workflowsR, [] as Workflow[]);

    const { clientesAtivos, receitaMensal, despesaTotal, saldo, transacoes } = stats;
    const isAgent = currentUserRole === 'agent';

    // Computed values
    const contratosVigentes = contratos.filter(c => c.status === 'vigente');
    const contratosAssinar = contratos.filter(c => c.status === 'a_assinar');
    const valorContratos = contratosVigentes.reduce((s, c) => s + Number(c.valor_total), 0);
    const workflowsAtivos = workflows.filter(w => w.status === 'ativo');

    // Note: all interpolated values come from Supabase DB data and are escaped via escapeHTML where needed.
    // No raw user input is interpolated into innerHTML here — formatBRL returns safe numeric strings.
    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title" style="display:flex;align-items:center;gap:0.75rem">
          <img src="/mesaas-logo-horiz-dark-bg.svg" alt="Mesaas" class="dashboard-logo logo-light" />
          <img src="/mesaas-logo-horiz-light-bg.svg" alt="Mesaas" class="dashboard-logo logo-dark" />
          <div>
            <h1>Painel de Controle</h1>
            <p>Visão geral do seu negócio.</p>
          </div>
        </div>
      </header>

      <!-- KPI Row -->
      <div class="kpi-grid animate-up">
        ${isAgent ? '' : `
        <div class="kpi-card card-dark">
          <span class="kpi-label" style="color:rgba(255,255,255,0.7)">RECEITAS MENSAIS</span>
          <span class="kpi-value" style="color:#fff">${formatBRL(receitaMensal)}</span>
          <span class="kpi-sub" style="color:var(--success)">↑ ${clientesAtivos.length} clientes ativos</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">DESPESAS MENSAIS</span>
          <span class="kpi-value">${formatBRL(despesaTotal)}</span>
          <span class="kpi-sub" style="color:var(--danger)">↓ ${transacoes.filter(t => t.tipo === 'saida').length} saídas</span>
        </div>
        <div class="kpi-card ${saldo >= 0 ? 'card-yellow' : 'card-dark'}">
          <span class="kpi-label" ${saldo < 0 ? 'style="color:rgba(255,255,255,0.7)"' : ''}>SALDO</span>
          <span class="kpi-value" ${saldo < 0 ? 'style="color:var(--danger)"' : ''}>${formatBRL(saldo)}</span>
          <span class="kpi-sub">${saldo >= 0 ? '✓ Positivo' : '✗ Negativo'}</span>
        </div>
        `}
        <div class="kpi-card">
          <span class="kpi-label">CLIENTES ATIVOS</span>
          <span class="kpi-value">${clientesAtivos.length} <span style="font-size:0.9rem;font-weight:400;color:var(--text-muted)">/ ${clientes.length}</span></span>
          <span class="kpi-sub" style="color:var(--text-muted)">${clientes.filter(c => c.status === 'pausado').length} pausados</span>
        </div>
        ${isAgent ? '' : `
        <div class="kpi-card">
          <span class="kpi-label">CONTRATOS VIGENTES</span>
          <span class="kpi-value">${contratosVigentes.length}</span>
          <span class="kpi-sub" style="color:var(--success)">${formatBRL(valorContratos)} em valor</span>
        </div>
        `}
      </div>

      <!-- Hub Grid -->
      <div class="dashboard-hub animate-up">
        ${renderLeadsCard(leads)}
        ${isAgent ? '' : renderFinanceiroCard(transacoes, clientesAtivos, membros)}
        ${renderAnalyticsCard(portfolio)}
        ${isAgent ? '' : renderContratosCard(contratos, contratosVigentes, contratosAssinar)}
        ${renderEntregasCard(workflowsAtivos, clientes)}
        ${renderEquipeCard(membros)}
        ${renderCalendarioCard(clientesAtivos, membros)}
      </div>
    `;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro ao carregar dashboard: ${escapeHTML(message)}</p></div>`;
  }
}

// ---- Hub Card Helpers ----

function cardHeader(icon: string, title: string): string {
  return `<div class="dashboard-hub-card-header">
    <h3><i class="ph ph-${icon}"></i> ${title}</h3>
    <i class="ph ph-arrow-right"></i>
  </div>`;
}

function emptyState(msg: string): string {
  return `<p style="color:var(--text-muted);font-size:0.85rem">${msg}</p>`;
}

function miniKpi(value: string, label: string): string {
  return `<div class="dashboard-mini-kpi">
    <div class="value">${value}</div>
    <div class="label">${label}</div>
  </div>`;
}

// ---- Section Renderers ----

function renderLeadsCard(leads: Lead[]): string {
  const novo = leads.filter(l => l.status === 'novo').length;
  const contatado = leads.filter(l => l.status === 'contatado').length;
  const qualificado = leads.filter(l => l.status === 'qualificado').length;
  const latest = [...leads].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 3);

  const content = leads.length === 0
    ? emptyState('Nenhum lead cadastrado.')
    : `
      <div class="dashboard-mini-kpis">
        ${miniKpi(String(novo), 'Novos')}
        ${miniKpi(String(contatado), 'Contatados')}
        ${miniKpi(String(qualificado), 'Qualificados')}
      </div>
      <div class="dashboard-hub-list">
        ${latest.map(l => `
          <div class="dashboard-hub-row">
            <div>
              <strong>${escapeHTML(l.nome)}</strong>
              <span class="badge" style="background:${leadStatusColor[l.status] || 'var(--text-muted)'};color:#fff;font-size:0.6rem;margin-left:0.5rem">${leadStatusLabel[l.status] || l.status}</span>
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted)">${l.created_at ? formatDate(l.created_at) : ''}</span>
          </div>
        `).join('')}
      </div>`;

  return `<a href="#/leads" class="card dashboard-hub-card">${cardHeader('funnel', 'Leads')}${content}</a>`;
}

function renderFinanceiroCard(transacoes: any[], clientesAtivos: Cliente[], membros: Membro[]): string {
  // Compute A receber / A pagar from actual transactions
  const entradas = transacoes.filter(t => t.tipo === 'entrada');
  const saidas = transacoes.filter(t => t.tipo === 'saida');
  const aReceber = entradas.reduce((s, t) => s + Number(t.valor), 0);
  const aPagar = saidas.reduce((s, t) => s + Number(t.valor), 0);

  // Recent transactions (last 4)
  const recent = [...transacoes]
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
    .slice(0, 4);

  const content = transacoes.length === 0
    ? emptyState('Nenhuma movimentação registrada.')
    : `
      <div class="dashboard-mini-kpis">
        ${miniKpi(formatBRL(aReceber), 'A receber')}
        ${miniKpi(formatBRL(aPagar), 'A pagar')}
      </div>
      <div class="dashboard-hub-list">
        ${recent.map(t => `
          <div class="dashboard-hub-row">
            <div>
              <strong>${escapeHTML(t.descricao)}</strong>
              <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.35rem">${escapeHTML(t.categoria || '')}</span>
            </div>
            <span style="font-weight:600;color:${t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">
              ${t.tipo === 'entrada' ? '+' : '-'} ${formatBRL(Number(t.valor))}
            </span>
          </div>
        `).join('')}
      </div>`;

  return `<a href="#/financeiro" class="card dashboard-hub-card">${cardHeader('wallet', 'Financeiro')}${content}</a>`;
}

function renderAnalyticsCard(portfolio: PortfolioSummary | null): string {
  if (!portfolio || portfolio.summary.connected === 0) {
    return `<a href="#/analytics" class="card dashboard-hub-card">
      ${cardHeader('chart-line-up', 'Instagram Analytics')}
      ${emptyState('Conecte contas Instagram para ver métricas.')}
    </a>`;
  }

  const { accounts, summary } = portfolio;
  const totalFollowers = accounts.reduce((s, a) => s + (a.follower_count || 0), 0);
  const avgEngagement = accounts.length > 0
    ? accounts.reduce((s, a) => s + (a.engagement_rate_avg || 0), 0) / accounts.length
    : 0;

  const best = summary.bestByEngagement;

  return `<a href="#/analytics" class="card dashboard-hub-card">
    ${cardHeader('chart-line-up', 'Instagram Analytics')}
    <div class="dashboard-mini-kpis">
      ${miniKpi(String(summary.connected), 'Contas')}
      ${miniKpi(totalFollowers.toLocaleString('pt-BR'), 'Seguidores')}
      ${miniKpi(avgEngagement.toFixed(1) + '%', 'Engajamento')}
    </div>
    ${best ? `
      <div class="dashboard-hub-row" style="margin-top:0.25rem">
        <div style="display:flex;align-items:center;gap:0.5rem">
          <i class="ph ph-trophy" style="color:var(--primary-color)"></i>
          <strong>${escapeHTML(best.client_name)}</strong>
        </div>
        <span class="badge badge-success" style="font-size:0.7rem">${best.engagement_rate_avg.toFixed(1)}%</span>
      </div>
    ` : ''}
    ${summary.growing > 0 ? `<div style="margin-top:0.5rem"><span class="badge" style="background:var(--success);color:#fff;font-size:0.65rem">↑ ${summary.growing} crescendo</span></div>` : ''}
  </a>`;
}

function renderContratosCard(contratos: Contrato[], vigentes: Contrato[], assinar: Contrato[]): string {
  if (contratos.length === 0) {
    return `<a href="#/contratos" class="card dashboard-hub-card">${cardHeader('file-text', 'Contratos')}${emptyState('Nenhum contrato cadastrado.')}</a>`;
  }

  // Find contracts expiring within 30 days
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 86400000);
  const expiring = vigentes
    .filter(c => {
      const end = new Date(c.data_fim);
      return end >= now && end <= in30d;
    })
    .sort((a, b) => a.data_fim.localeCompare(b.data_fim))
    .slice(0, 3);

  return `<a href="#/contratos" class="card dashboard-hub-card">
    ${cardHeader('file-text', 'Contratos')}
    <div class="dashboard-mini-kpis">
      ${miniKpi(String(vigentes.length), 'Vigentes')}
      ${miniKpi(String(assinar.length), 'A assinar')}
      ${miniKpi(String(expiring.length), 'Vencem em 30d')}
    </div>
    ${expiring.length > 0 ? `
      <div class="dashboard-hub-list">
        ${expiring.map(c => {
          const days = Math.ceil((new Date(c.data_fim).getTime() - now.getTime()) / 86400000);
          return `<div class="dashboard-hub-row">
            <div>
              <strong>${escapeHTML(c.titulo)}</strong>
              <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.35rem">${escapeHTML(c.cliente_nome || '')}</span>
            </div>
            <span class="badge" style="background:${days <= 7 ? 'var(--danger)' : 'var(--warning)'};color:#fff;font-size:0.65rem">${days}d restantes</span>
          </div>`;
        }).join('')}
      </div>
    ` : `<p style="font-size:0.8rem;color:var(--text-muted)">Nenhum contrato vencendo em breve.</p>`}
  </a>`;
}

function renderEquipeCard(membros: Membro[]): string {
  if (membros.length === 0) {
    return `<a href="#/equipe" class="card dashboard-hub-card">${cardHeader('user-circle-gear', 'Equipe')}${emptyState('Nenhum membro cadastrado.')}</a>`;
  }

  const custoTotal = membros.reduce((s, m) => s + Number(m.custo_mensal || 0), 0);
  const clt = membros.filter(m => m.tipo === 'clt').length;
  const freeMensal = membros.filter(m => m.tipo === 'freelancer_mensal').length;
  const freeDemanda = membros.filter(m => m.tipo === 'freelancer_demanda').length;
  const isAgent = currentUserRole === 'agent';

  return `<a href="#/equipe" class="card dashboard-hub-card">
    ${cardHeader('user-circle-gear', 'Equipe')}
    <div class="dashboard-mini-kpis">
      ${miniKpi(String(membros.length), 'Membros')}
      ${isAgent ? '' : miniKpi(formatBRL(custoTotal), 'Custo mensal')}
    </div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
      ${clt > 0 ? `<span class="badge" style="background:var(--teal);color:#fff;font-size:0.65rem">${clt} CLT</span>` : ''}
      ${freeMensal > 0 ? `<span class="badge" style="background:var(--primary-color);color:var(--dark);font-size:0.65rem">${freeMensal} Freelancer Mensal</span>` : ''}
      ${freeDemanda > 0 ? `<span class="badge" style="background:var(--text-muted);color:#fff;font-size:0.65rem">${freeDemanda} Freelancer Demanda</span>` : ''}
    </div>
  </a>`;
}

function renderCalendarioCard(clientesAtivos: Cliente[], membros: Membro[]): string {
  const isAgent = currentUserRole === 'agent';
  const now = new Date();
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Build upcoming payment events for the rest of this month
  type PaymentEvent = { name: string; day: number; amount: number; tipo: 'entrada' | 'saida' };
  const events: PaymentEvent[] = [];

  for (const c of clientesAtivos) {
    if (c.data_pagamento && c.data_pagamento >= today && c.data_pagamento <= daysInMonth) {
      events.push({ name: c.nome, day: c.data_pagamento, amount: Number(c.valor_mensal), tipo: 'entrada' });
    }
  }
  for (const m of membros) {
    if (m.data_pagamento && m.data_pagamento >= today && m.data_pagamento <= daysInMonth) {
      events.push({ name: m.nome, day: m.data_pagamento, amount: Number(m.custo_mensal || 0), tipo: 'saida' });
    }
  }

  events.sort((a, b) => a.day - b.day);
  const upcoming = events.slice(0, 4);

  const content = upcoming.length === 0
    ? emptyState('Nenhum pagamento previsto este mês.')
    : `<div class="dashboard-hub-list">
        ${upcoming.map(e => `
          <div class="dashboard-hub-row">
            <div style="display:flex;align-items:center;gap:0.5rem">
              <span style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);min-width:28px">dia ${e.day}</span>
              <strong>${escapeHTML(e.name)}</strong>
            </div>
            ${isAgent ? '' : `<span style="font-weight:600;color:${e.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">
              ${e.tipo === 'entrada' ? '+' : '-'} ${formatBRL(e.amount)}
            </span>`}
          </div>
        `).join('')}
      </div>`;

  return `<a href="#/calendario" class="card dashboard-hub-card">${cardHeader('calendar-blank', 'Calendário')}${content}</a>`;
}

function renderEntregasCard(workflows: Workflow[], clientes: Cliente[]): string {
  if (workflows.length === 0) return '';

  const recents = [...workflows].slice(0, 3);

  const content = `
    <div class="dashboard-mini-kpis">
      ${miniKpi(String(workflows.length), 'Fluxos Ativos')}
    </div>
    <div class="dashboard-hub-list">
      ${recents.map(w => {
        const cliente = clientes.find(c => c.id === w.cliente_id);
        const nomeCliente = cliente ? cliente.nome : 'Sem cliente';
        return `<div class="dashboard-hub-row">
          <div>
            <strong>${escapeHTML(w.titulo)}</strong>
            <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.35rem">${escapeHTML(nomeCliente)}</span>
          </div>
          <span class="badge" style="background:var(--primary-color);color:var(--dark);font-size:0.65rem">Etapa ${w.etapa_atual + 1}</span>
        </div>`;
      }).join('')}
    </div>
  `;

  return `<a href="#/entregas" class="card dashboard-hub-card">${cardHeader('kanban', 'Entregas')}${content}</a>`;
}
