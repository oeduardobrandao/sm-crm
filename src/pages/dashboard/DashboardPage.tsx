import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import {
  getDashboardStats,
  getLeads,
  getContratos,
  getMembros,
  getClientes,
  getWorkflows,
  formatBRL,
  formatDate,
  getInitials,
  type Lead,
  type Contrato,
  type Membro,
  type Cliente,
  type Workflow,
} from '../../store';
import { getPortfolioSummary, type PortfolioSummary } from '../../services/analytics';
import { useAuth } from '../../context/AuthContext';

export default function DashboardPage() {
  const { role } = useAuth();

  const results = useQueries({
    queries: [
      { queryKey: ['dashboardStats'], queryFn: getDashboardStats, retry: 1 },
      { queryKey: ['leads'], queryFn: getLeads, retry: 1 },
      { queryKey: ['contratos'], queryFn: getContratos, retry: 1 },
      { queryKey: ['membros'], queryFn: getMembros, retry: 1 },
      { queryKey: ['clientes'], queryFn: getClientes, retry: 1 },
      { queryKey: ['portfolioSummary'], queryFn: getPortfolioSummary, retry: 1 },
      { queryKey: ['workflows'], queryFn: getWorkflows, retry: 1 },
    ],
  });

  const [statsRes, leadsRes, contratosRes, membrosRes, clientesRes, portfolioRes, workflowsRes] = results;

  const stats = statsRes.data ?? null;
  const leads: Lead[] = leadsRes.data ?? [];
  const contratos: Contrato[] = contratosRes.data ?? [];
  const membros: Membro[] = membrosRes.data ?? [];
  const clientes: Cliente[] = clientesRes.data ?? [];
  const portfolio: PortfolioSummary | undefined = portfolioRes.data;
  const workflows: Workflow[] = workflowsRes.data ?? [];

  const isLoading = results.some(r => r.isLoading);

  // Derived values
  const leadCounts = {
    novo: leads.filter(l => l.status === 'novo').length,
    contatado: leads.filter(l => l.status === 'contatado').length,
    qualificado: leads.filter(l => l.status === 'qualificado').length,
  };
  const last3Leads = leads.slice(0, 3);

  const contratosVigentes = contratos.filter(c => c.status === 'vigente');
  const contratosAAssinar = contratos.filter(c => c.status === 'a_assinar');
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 86400000);
  const contratosExpirando = contratosVigentes.filter(c => {
    const end = new Date(c.data_fim + 'T00:00:00');
    return end >= now && end <= in30Days;
  });

  const transacoes = stats?.transacoes ?? [];
  const aReceber = transacoes.filter(t => t.tipo === 'entrada' && t.status === 'agendado').reduce((s, t) => s + Number(t.valor), 0);
  const aPagar = transacoes.filter(t => t.tipo === 'saida' && t.status === 'agendado').reduce((s, t) => s + Number(t.valor), 0);
  const last4Transacoes = transacoes.slice(0, 4);

  const activeWorkflows = workflows.filter(w => w.status === 'ativo');
  const first3Workflows = activeWorkflows.slice(0, 3);

  const membroTipos = {
    clt: membros.filter(m => m.tipo === 'clt').length,
    mensal: membros.filter(m => m.tipo === 'freelancer_mensal').length,
    demanda: membros.filter(m => m.tipo === 'freelancer_demanda').length,
  };
  const custoEquipe = membros.reduce((s, m) => s + Number(m.custo_mensal ?? 0), 0);

  // Calendar: payment events this month
  const mesAtual = String(now.getMonth() + 1);
  const anoAtual = now.getFullYear();
  const calEvents: { label: string; dia: number; tipo: 'entrada' | 'saida' }[] = [];
  clientes
    .filter(c => c.status === 'ativo' && c.data_pagamento)
    .forEach(c => calEvents.push({ label: c.nome, dia: c.data_pagamento!, tipo: 'entrada' }));
  membros
    .filter(m => m.data_pagamento)
    .forEach(m => calEvents.push({ label: m.nome, dia: m.data_pagamento!, tipo: 'saida' }));
  calEvents.sort((a, b) => a.dia - b.dia);
  const upcomingEvents = calEvents.filter(e => e.dia >= now.getDate()).slice(0, 5);

  const portfolioAccounts = portfolio?.accounts ?? [];
  const totalFollowers = portfolioAccounts.reduce((s, a) => s + a.follower_count, 0);
  const avgEngagement = portfolioAccounts.length > 0
    ? portfolioAccounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / portfolioAccounts.length
    : 0;

  const clienteMap = Object.fromEntries(clientes.map(c => [c.id!, c]));

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title">
          <h1>Dashboard</h1>
        </div>
        <div className="header-actions">
          <img src="/logo-black.svg" className="dashboard-logo logo-light" alt="Logo" style={{ height: 20 }} />
          <img src="/logo-white.svg" className="dashboard-logo logo-dark" alt="Logo" style={{ height: 20 }} />
        </div>
      </div>

      {/* KPI Grid — hidden for agents */}
      {role !== 'agent' && stats && (
        <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="kpi-card animate-up">
            <span className="kpi-label">RECEITA MENSAL</span>
            <span className="kpi-value">{formatBRL(stats.receitaMensal)}</span>
            <span className="kpi-sub">{stats.clientesAtivos.length} clientes ativos</span>
          </div>
          <div className="kpi-card animate-up">
            <span className="kpi-label">DESPESAS</span>
            <span className="kpi-value">{formatBRL(stats.despesaTotal)}</span>
            <span className="kpi-sub">este mês</span>
          </div>
          <div className="kpi-card animate-up">
            <span className="kpi-label">SALDO</span>
            <span className="kpi-value" style={{ color: stats.saldo >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatBRL(stats.saldo)}</span>
            <span className="kpi-sub">projetado</span>
          </div>
          <div className="kpi-card animate-up">
            <span className="kpi-label">CLIENTES ATIVOS</span>
            <span className="kpi-value">{stats.clientesAtivos.length}</span>
            <span className="kpi-sub">de {stats.clientes.length} total</span>
          </div>
          <div className="kpi-card animate-up">
            <span className="kpi-label">CONTRATOS VIGENTES</span>
            <span className="kpi-value">{contratosVigentes.length}</span>
            <span className="kpi-sub">{contratosAAssinar.length} a assinar</span>
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* Dashboard Hub */}
      <div className="dashboard-hub">

        {/* Leads */}
        <Link to="/leads" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="ph ph-funnel" style={{ marginRight: 8 }} />Leads</h3>
              <i className="ph ph-arrow-right" />
            </div>
            <div className="dashboard-mini-kpis">
              <div className="dashboard-mini-kpi">
                <span className="kpi-label">NOVO</span>
                <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{leadCounts.novo}</span>
              </div>
              <div className="dashboard-mini-kpi">
                <span className="kpi-label">CONTATADO</span>
                <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{leadCounts.contatado}</span>
              </div>
              <div className="dashboard-mini-kpi">
                <span className="kpi-label">QUALIFICADO</span>
                <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{leadCounts.qualificado}</span>
              </div>
            </div>
            <div className="dashboard-hub-list">
              {last3Leads.map(lead => (
                <div key={lead.id} className="dashboard-hub-row">
                  <span>{lead.nome}</span>
                  <span className={`badge ${lead.status === 'novo' ? 'badge-info' : lead.status === 'qualificado' ? 'badge-success' : 'badge-neutral'}`}>
                    {lead.status}
                  </span>
                </div>
              ))}
              {last3Leads.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhum lead ainda.</p>}
            </div>
          </div>
        </Link>

        {/* Financeiro — hidden for agents */}
        {role !== 'agent' && (
          <Link to="/financeiro" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card dashboard-hub-card animate-up">
              <div className="dashboard-hub-card-header">
                <h3><i className="ph ph-currency-dollar" style={{ marginRight: 8 }} />Financeiro</h3>
                <i className="ph ph-arrow-right" />
              </div>
              <div className="dashboard-mini-kpis">
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">A RECEBER</span>
                  <span className="kpi-value" style={{ fontSize: '1rem', color: 'var(--success)' }}>{formatBRL(aReceber)}</span>
                </div>
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">A PAGAR</span>
                  <span className="kpi-value" style={{ fontSize: '1rem', color: 'var(--danger)' }}>{formatBRL(aPagar)}</span>
                </div>
              </div>
              <div className="dashboard-hub-list">
                {last4Transacoes.map(t => (
                  <div key={t.id} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>{t.descricao}</span>
                    <span style={{ color: t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                      {t.tipo === 'entrada' ? '+' : '-'}{formatBRL(t.valor)}
                    </span>
                  </div>
                ))}
                {last4Transacoes.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhuma transação este mês.</p>}
              </div>
            </div>
          </Link>
        )}

        {/* Analytics */}
        <Link to="/analytics" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="fa-brands fa-instagram" style={{ marginRight: 8 }} />Analytics</h3>
              <i className="ph ph-arrow-right" />
            </div>
            {portfolioAccounts.length > 0 ? (
              <div className="dashboard-mini-kpis">
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">CONTAS</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{portfolioAccounts.length}</span>
                </div>
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">SEGUIDORES</span>
                  <span className="kpi-value" style={{ fontSize: '1rem' }}>{totalFollowers.toLocaleString('pt-BR')}</span>
                </div>
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">ENG. MÉDIO</span>
                  <span className="kpi-value" style={{ fontSize: '1rem' }}>{avgEngagement.toFixed(2)}%</span>
                </div>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                <i className="fa-brands fa-instagram" style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }} />
                Nenhuma conta conectada
              </p>
            )}
          </div>
        </Link>

        {/* Contratos — hidden for agents */}
        {role !== 'agent' && (
          <Link to="/contratos" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card dashboard-hub-card animate-up">
              <div className="dashboard-hub-card-header">
                <h3><i className="ph ph-file-text" style={{ marginRight: 8 }} />Contratos</h3>
                <i className="ph ph-arrow-right" />
              </div>
              <div className="dashboard-mini-kpis">
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">VIGENTES</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{contratosVigentes.length}</span>
                </div>
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">A ASSINAR</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem', color: 'var(--warning)' }}>{contratosAAssinar.length}</span>
                </div>
              </div>
              {contratosExpirando.length > 0 && (
                <div className="dashboard-hub-list">
                  <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginBottom: 4, fontWeight: 600 }}>EXPIRANDO EM 30 DIAS</p>
                  {contratosExpirando.map(c => (
                    <div key={c.id} className="dashboard-hub-row">
                      <span style={{ fontSize: '0.85rem' }}>{c.titulo}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDate(c.data_fim)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Link>
        )}

        {/* Entregas (Workflows) */}
        <Link to="/entregas" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="ph ph-kanban" style={{ marginRight: 8 }} />Entregas</h3>
              <i className="ph ph-arrow-right" />
            </div>
            <div className="dashboard-mini-kpis">
              <div className="dashboard-mini-kpi">
                <span className="kpi-label">ATIVOS</span>
                <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{activeWorkflows.length}</span>
              </div>
            </div>
            <div className="dashboard-hub-list">
              {first3Workflows.map((wf: Workflow) => {
                const cliente = wf.cliente_id ? clienteMap[wf.cliente_id] : null;
                return (
                  <div key={wf.id} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>{wf.titulo}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{cliente?.nome ?? '—'}</span>
                  </div>
                );
              })}
              {first3Workflows.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhum workflow ativo.</p>}
            </div>
          </div>
        </Link>

        {/* Equipe */}
        <Link to="/equipe" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="ph ph-users" style={{ marginRight: 8 }} />Equipe</h3>
              <i className="ph ph-arrow-right" />
            </div>
            <div className="dashboard-mini-kpis">
              <div className="dashboard-mini-kpi">
                <span className="kpi-label">MEMBROS</span>
                <span className="kpi-value" style={{ fontSize: '1.25rem' }}>{membros.length}</span>
              </div>
              {role !== 'agent' && (
                <div className="dashboard-mini-kpi">
                  <span className="kpi-label">CUSTO/MÊS</span>
                  <span className="kpi-value" style={{ fontSize: '0.95rem' }}>{formatBRL(custoEquipe)}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {membroTipos.clt > 0 && <span className="badge badge-info">CLT: {membroTipos.clt}</span>}
              {membroTipos.mensal > 0 && <span className="badge badge-warning">Mensal: {membroTipos.mensal}</span>}
              {membroTipos.demanda > 0 && <span className="badge badge-neutral">Demanda: {membroTipos.demanda}</span>}
            </div>
          </div>
        </Link>

        {/* Calendário */}
        <Link to="/financeiro" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="ph ph-calendar" style={{ marginRight: 8 }} />Calendário</h3>
              <i className="ph ph-arrow-right" />
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              Pagamentos em {mesAtual}/{anoAtual}
            </p>
            <div className="dashboard-hub-list">
              {upcomingEvents.map((ev, i) => (
                <div key={i} className="dashboard-hub-row">
                  <span style={{ fontSize: '0.85rem' }}>{ev.label}</span>
                  <span style={{ fontSize: '0.8rem', color: ev.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)' }}>
                    Dia {ev.dia}
                  </span>
                </div>
              ))}
              {upcomingEvents.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhum pagamento próximo.</p>
              )}
            </div>
          </div>
        </Link>

      </div>
    </div>
  );
}
