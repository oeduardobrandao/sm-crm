import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import {
  getDashboardStats,
  getLeads,
  getContratos,
  getMembros,
  getClientes,
  getWorkflows,
  getWorkflowEtapas,
  getAllClienteDatas,
  formatBRL,
  formatDate,
  type Lead,
  type Contrato,
  type Membro,
  type Cliente,
  type Workflow,
  type ClienteData,
} from '../../store';
import { getPortfolioSummary, type PortfolioSummary } from '../../services/analytics';
import { useAuth } from '../../context/AuthContext';
import { OnboardingBanner } from '../../components/OnboardingBanner';

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
  const first3Workflows = activeWorkflows.slice(0, 5);

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
  const totalReach = portfolioAccounts.reduce((s, a) => s + a.reach_28d, 0);
  const totalWebsiteClicks = portfolioAccounts.reduce((s, a) => s + (a.website_clicks_28d ?? 0), 0);
  const avgEngagement = portfolioAccounts.length > 0
    ? portfolioAccounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / portfolioAccounts.length
    : 0;
  const topAccountsByEngagement = [...portfolioAccounts]
    .sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)
    .slice(0, 4);

  const clienteMap = Object.fromEntries(clientes.map(c => [c.id!, c]));

  // ---- "What's happening today" card data ----
  const isAgent = role === 'agent';
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const { data: datasImportantes = [] } = useQuery({ queryKey: ['allClienteDatas'], queryFn: getAllClienteDatas, retry: 1 });
  const { data: deadlineEvents = [] } = useQuery({
    queryKey: ['calendar-deadlines', workflows.map(w => w.id).join(',')],
    queryFn: async () => {
      const activeWfs = workflows.filter(w => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map(w => getWorkflowEtapas(w.id!)));
      const events: { workflowTitle: string; etapaNome: string; clienteNome: string; clienteCor: string; deadlineDate: Date; diasRestantes: number; estourado: boolean }[] = [];
      activeWfs.forEach((w, idx) => {
        const etapas = etapasResults[idx];
        const activeEtapa = etapas.find(e => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const cliente = clientes.find(c => c.id === w.cliente_id);
        const inicio = new Date(activeEtapa.iniciado_em);
        const deadlineDate = new Date(inicio);
        if (activeEtapa.tipo_prazo === 'uteis') {
          let added = 0;
          while (added < activeEtapa.prazo_dias) {
            deadlineDate.setDate(deadlineDate.getDate() + 1);
            const dow = deadlineDate.getDay();
            if (dow !== 0 && dow !== 6) added++;
          }
        } else {
          deadlineDate.setDate(deadlineDate.getDate() + activeEtapa.prazo_dias);
        }
        const diffMs = deadlineDate.getTime() - now.getTime();
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        events.push({
          workflowTitle: w.titulo,
          etapaNome: activeEtapa.nome,
          clienteNome: cliente?.nome || '—',
          clienteCor: cliente?.cor || '#888',
          deadlineDate,
          diasRestantes,
          estourado: diasRestantes < 0,
        });
      });
      return events;
    },
    enabled: workflows.length > 0,
  });

  // Today's events
  const todayIncomes = isAgent ? [] : clientes.filter(c => c.data_pagamento === todayDay && c.status === 'ativo');
  const todayExpenses = isAgent ? [] : membros.filter(m => m.data_pagamento === todayDay);
  const todayDeadlines = deadlineEvents.filter(d =>
    d.deadlineDate.getDate() === todayDay &&
    d.deadlineDate.getMonth() === todayMonth &&
    d.deadlineDate.getFullYear() === todayYear
  );
  const todayBirthdays = clientes.filter(c => {
    if (!c.data_aniversario) return false;
    const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
    return (bdMm - 1) === todayMonth && bdDd === todayDay;
  });
  const todayDatas = datasImportantes.filter(d => {
    const dt = new Date(d.data + 'T00:00:00');
    return dt.getMonth() === todayMonth && dt.getDate() === todayDay && dt.getFullYear() === todayYear;
  });
  const todayEventCount = todayIncomes.length + todayExpenses.length + todayDeadlines.length + todayBirthdays.length + todayDatas.length;

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const weekDayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

  return (
    <div>
      <div className="header">
        <div className="header-title">
          <h1>Dashboard</h1>
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* Onboarding banner — only for non-agents */}
      {!isLoading && role !== 'agent' && (
        <OnboardingBanner
          clientes={clientes}
          leads={leads}
          membros={membros}
          portfolioAccounts={portfolioAccounts}
          workflows={workflows}
        />
      )}

      {/* Dashboard Hub */}
      <div className="dashboard-hub">

        {/* What's happening today */}
        <Link to="/calendario" style={{ textDecoration: 'none', color: 'inherit', gridColumn: 'span 1' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="ph ph-calendar-check" style={{ marginRight: 8 }} />Hoje</h3>
              <i className="ph ph-arrow-right" />
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {weekDayNames[now.getDay()]}, {todayDay} de {monthNames[todayMonth]}
            </p>
            {todayEventCount === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '0.5rem 0' }}>
                Nenhum evento hoje.
              </p>
            ) : (
              <div className="dashboard-hub-list">
                {todayIncomes.map(c => (
                  <div key={`inc-${c.id}`} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className="ph ph-arrow-up-right" style={{ color: 'var(--success)', marginRight: 4 }} />{c.nome}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>Recebimento</span>
                  </div>
                ))}
                {todayExpenses.map(m => (
                  <div key={`exp-${m.id}`} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className="ph ph-arrow-down-left" style={{ color: 'var(--danger)', marginRight: 4 }} />{m.nome}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600 }}>Despesa</span>
                  </div>
                ))}
                {todayDeadlines.map((d, i) => (
                  <div key={`dl-${i}`} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className="ph ph-flag" style={{ color: d.estourado ? 'var(--danger)' : 'var(--warning)', marginRight: 4 }} />{d.etapaNome}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.clienteNome}</span>
                  </div>
                ))}
                {todayBirthdays.map(c => (
                  <div key={`bd-${c.id}`} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className="ph ph-cake" style={{ color: 'var(--pink, #ec4899)', marginRight: 4 }} />{c.nome}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aniversário</span>
                  </div>
                ))}
                {todayDatas.map(d => (
                  <div key={`data-${d.id}`} className="dashboard-hub-row">
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className="ph ph-star" style={{ color: 'var(--info, #6366f1)', marginRight: 4 }} />{d.titulo}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{clientes.find(c => c.id === d.cliente_id)?.nome ?? ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Link>

        {/* Leads */}
        <Link to="/leads" style={{ textDecoration: 'none', color: 'inherit', gridColumn: 'span 1' }}>
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

        {/* Analytics */}
        <Link to="/analytics" style={{ textDecoration: 'none', color: 'inherit', gridColumn: 'span 2' }}>
          <div className="card dashboard-hub-card animate-up">
            <div className="dashboard-hub-card-header">
              <h3><i className="fa-brands fa-instagram" style={{ marginRight: 8 }} />Analytics</h3>
              <i className="ph ph-arrow-right" />
            </div>
            {portfolioAccounts.length > 0 ? (
              <>
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
                    <span className="kpi-label">ALCANCE (28D)</span>
                    <span className="kpi-value" style={{ fontSize: '1rem' }}>{totalReach.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="dashboard-mini-kpi">
                    <span className="kpi-label">ENG. MÉDIO</span>
                    <span className="kpi-value" style={{ fontSize: '1rem' }}>{avgEngagement.toFixed(2)}%</span>
                  </div>
                  <div className="dashboard-mini-kpi">
                    <span className="kpi-label">CLIQUES NO LINK</span>
                    <span className="kpi-value" style={{ fontSize: '1rem' }}>{totalWebsiteClicks.toLocaleString('pt-BR')}</span>
                  </div>
                  {portfolio?.summary?.bestByEngagement && (
                    <div className="dashboard-mini-kpi">
                      <span className="kpi-label">MELHOR ENG.</span>
                      <span className="kpi-value" style={{ fontSize: '0.9rem' }}>{portfolio.summary.bestByEngagement.client_name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>{portfolio.summary.bestByEngagement.engagement_rate_avg.toFixed(1)}%</span>
                    </div>
                  )}
                  {portfolio?.summary?.mostImproved && portfolio.summary.mostImproved.follower_delta > 0 && (
                    <div className="dashboard-mini-kpi">
                      <span className="kpi-label">MAIS CRESCEU</span>
                      <span className="kpi-value" style={{ fontSize: '0.9rem' }}>{portfolio.summary.mostImproved.client_name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>+{portfolio.summary.mostImproved.follower_delta.toLocaleString('pt-BR')}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, marginBottom: 10 }}>
                  {(portfolio?.summary?.growing ?? 0) > 0 && (
                    <span className="badge badge-success"><i className="ph ph-trend-up" style={{ marginRight: 3 }} />{portfolio!.summary.growing} crescendo</span>
                  )}
                  {(portfolio?.summary?.stagnant ?? 0) > 0 && (
                    <span className="badge badge-neutral">{portfolio!.summary.stagnant} estável</span>
                  )}
                  {(portfolio?.summary?.declining ?? 0) > 0 && (
                    <span className="badge badge-danger"><i className="ph ph-trend-down" style={{ marginRight: 3 }} />{portfolio!.summary.declining} caindo</span>
                  )}
                </div>
                {topAccountsByEngagement.length > 0 && (
                  <div className="dashboard-hub-list">
                    {topAccountsByEngagement.map(a => (
                      <div key={a.instagram_account_id} className="dashboard-hub-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {a.profile_picture_url
                            ? <img src={a.profile_picture_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                            : <span className="avatar" style={{ width: 24, height: 24, fontSize: '0.55rem', background: a.client_cor }}>{a.client_sigla}</span>
                          }
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{a.client_name}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{a.username}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{a.follower_count.toLocaleString('pt-BR')} seg.</span>
                          <span className={`badge ${a.engagement_rate_avg >= 3 ? 'badge-success' : a.engagement_rate_avg >= 1 ? 'badge-neutral' : 'badge-outline'}`}>
                            {a.engagement_rate_avg.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                <i className="fa-brands fa-instagram" style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }} />
                Nenhuma conta conectada
              </p>
            )}
          </div>
        </Link>

        {/* Entregas (Workflows) */}
        <Link to="/entregas" style={{ textDecoration: 'none', color: 'inherit', gridColumn: 'span 2' }}>
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

      </div>

      {/* Financial Hub Cards — hidden for agents */}
      {role !== 'agent' && (
        <div className="dashboard-hub" style={{ marginTop: '1.5rem' }}>
          {/* Financeiro */}
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
      )}

      {/* KPI Grid — hidden for agents */}
      {role !== 'agent' && stats && (
        <div className="kpi-grid" style={{ marginTop: '1.5rem' }}>
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
    </div>
  );
}
