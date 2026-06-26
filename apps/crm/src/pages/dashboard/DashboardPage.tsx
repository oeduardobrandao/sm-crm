import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDashboardStats,
  getClientes,
  getMembros,
  getWorkflows,
  getWorkflowEtapas,
  getAllClienteDatas,
  getLeads,
  type Membro,
  type Cliente,
  type Workflow,
  type Lead,
} from '../../store';
import { getPortfolioSummary, type PortfolioSummary } from '../../services/analytics';
import { useAuth } from '../../context/AuthContext';
import { OnboardingBanner } from '../../components/OnboardingBanner';
import { ClientHealthMonitor } from './components/ClientHealthMonitor';
import { TodayCard, type TodayEvent } from './components/TodayCard';
import { FinanceKpiStrip } from './components/FinanceKpiStrip';

export default function DashboardPage() {
  const { role } = useAuth();
  const { t } = useTranslation('dashboard');
  const isAgent = role === 'agent';

  const results = useQueries({
    queries: [
      { queryKey: ['dashboardStats'], queryFn: getDashboardStats, retry: 1 },
      { queryKey: ['membros'], queryFn: getMembros, retry: 1 },
      { queryKey: ['clientes'], queryFn: getClientes, retry: 1 },
      { queryKey: ['workflows'], queryFn: getWorkflows, retry: 1 },
      { queryKey: ['leads'], queryFn: getLeads, retry: 1 },
      {
        queryKey: ['portfolioSummary'],
        queryFn: () => getPortfolioSummary(),
        retry: 1,
        enabled: !isAgent,
      },
    ],
  });
  const [statsRes, membrosRes, clientesRes, workflowsRes, leadsRes, portfolioRes] = results;
  const stats = statsRes.data ?? null;
  const membros: Membro[] = membrosRes.data ?? [];
  const clientes: Cliente[] = clientesRes.data ?? [];
  const workflows: Workflow[] = workflowsRes.data ?? [];
  const leads: Lead[] = leadsRes.data ?? [];
  const portfolio: PortfolioSummary | undefined = portfolioRes.data;

  const { data: datasImportantes = [] } = useQuery({
    queryKey: ['allClienteDatas'],
    queryFn: getAllClienteDatas,
    retry: 1,
  });
  const { data: deadlineEvents = [] } = useQuery({
    queryKey: ['calendar-deadlines', workflows.map((w) => w.id).join(',')],
    queryFn: async () => {
      const activeWfs = workflows.filter((w) => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map((w) => getWorkflowEtapas(w.id!)));
      const now = new Date();
      const events: { etapaNome: string; clienteNome: string; deadlineDate: Date }[] = [];
      activeWfs.forEach((w, idx) => {
        const activeEtapa = etapasResults[idx].find((e) => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const deadlineDate = new Date(activeEtapa.iniciado_em);
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
        const cliente = clientes.find((c) => c.id === w.cliente_id);
        events.push({
          etapaNome: activeEtapa.nome,
          clienteNome: cliente?.nome || '—',
          deadlineDate,
        });
      });
      return events;
    },
    enabled: workflows.length > 0,
  });

  // ---- today's events ----
  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const sameDay = (d: Date) =>
    d.getDate() === todayDay && d.getMonth() === todayMonth && d.getFullYear() === todayYear;

  const todayEvents: TodayEvent[] = [];
  if (!isAgent) {
    clientes
      .filter((c) => c.data_pagamento === todayDay && c.status === 'ativo')
      .forEach((c) =>
        todayEvents.push({ kind: 'income', label: c.nome, sublabel: t('events.recebimento') }),
      );
    membros
      .filter((m) => m.data_pagamento === todayDay)
      .forEach((m) =>
        todayEvents.push({ kind: 'expense', label: m.nome, sublabel: t('events.despesa') }),
      );
  }
  deadlineEvents
    .filter((d) => sameDay(d.deadlineDate))
    .forEach((d) =>
      todayEvents.push({ kind: 'deadline', label: d.etapaNome, sublabel: d.clienteNome }),
    );
  clientes
    .filter((c) => {
      if (!c.data_aniversario) return false;
      const [mm, dd] = c.data_aniversario.split('-').map(Number);
      return mm - 1 === todayMonth && dd === todayDay;
    })
    .forEach((c) =>
      todayEvents.push({ kind: 'birthday', label: c.nome, sublabel: t('events.aniversario') }),
    );
  datasImportantes
    .filter((d) => sameDay(new Date(d.data + 'T00:00:00')))
    .forEach((d) =>
      todayEvents.push({
        kind: 'data',
        label: d.titulo,
        sublabel: clientes.find((c) => c.id === d.cliente_id)?.nome ?? '',
      }),
    );

  // ---- finance figures ----
  const transacoes = stats?.transacoes ?? [];
  const aReceber = transacoes
    .filter((tx) => tx.tipo === 'entrada' && tx.status === 'agendado')
    .reduce((s, tx) => s + Number(tx.valor), 0);
  const aPagar = transacoes
    .filter((tx) => tx.tipo === 'saida' && tx.status === 'agendado')
    .reduce((s, tx) => s + Number(tx.valor), 0);

  return (
    <div>
      {!isAgent && (
        <OnboardingBanner
          clientes={clientes}
          leads={leads}
          membros={membros}
          portfolioAccounts={portfolio?.accounts ?? []}
          workflows={workflows}
        />
      )}

      <ClientHealthMonitor />

      <div className="dashboard-hub" style={{ marginTop: '1.5rem' }}>
        <TodayCard events={todayEvents} />
      </div>

      {!isAgent && stats && (
        <FinanceKpiStrip
          aReceber={aReceber}
          aPagar={aPagar}
          saldoProjetado={stats.saldo}
          receitaMensal={stats.receitaMensal}
        />
      )}
    </div>
  );
}
