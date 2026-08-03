import { useEffect } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
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
import { ImportBanner } from '../../components/import/ImportBanner';
import { TrialNudgeCard } from '../../components/billing/TrialNudgeCard';
import { ClientHealthMonitor } from './components/ClientHealthMonitor';
import { AgentPendingSection } from './components/AgentPendingSection';
import { TodayCard, type TodayEvent } from './components/TodayCard';
import { FinanceKpiStrip } from './components/FinanceKpiStrip';

export default function DashboardPage() {
  const { role, workspaceRole, canSeeFinancials } = useAuth();
  const { t } = useTranslation('dashboard');
  // workspaceRole reflects the ACTIVE workspace; profile-level `role` goes
  // stale across workspace switches (a user can be owner in one workspace and
  // agent in another). Fall back to `role` only while membership resolves.
  const isAgent = (workspaceRole ?? role) === 'agent';

  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Stripe returns here after an onboarding checkout. The plan lands via webhook,
  // so re-read a few times rather than trusting the first response — same
  // treatment CobrancaPage gives its own return.
  useEffect(() => {
    const trial = searchParams.get('trial');
    if (!trial) return;
    if (trial === 'started') {
      toast.success('Teste de 30 dias ativado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        // The entitlements cache is keyed ['workspace-limits', workspaceId]
        // (useWorkspaceLimits) with a 5 minute staleTime. The prefix alone
        // reaches the workspace-scoped entry without needing the id; getting
        // this key wrong leaves ProtectedRoute gating on the old plan for five
        // minutes, so a user who just started a trial to unlock relatórios
        // walks straight into the upgrade paywall.
        queryClient.invalidateQueries({ queryKey: ['workspace-limits'] });
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      setSearchParams({}, { replace: true });
      return () => window.clearInterval(id);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useQueries({
    queries: [
      {
        queryKey: ['dashboardStats', canSeeFinancials],
        queryFn: () => getDashboardStats(canSeeFinancials),
        retry: 1,
      },
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
  if (canSeeFinancials === true) {
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
      {!isAgent && <TrialNudgeCard />}
      {!isAgent && (
        <OnboardingBanner
          clientes={clientes}
          leads={leads}
          membros={membros}
          portfolioAccounts={portfolio?.accounts ?? []}
          workflows={workflows}
        />
      )}

      {/* Agents see their own pending work where managers see client health. */}
      {isAgent ? <AgentPendingSection /> : <ClientHealthMonitor />}

      {clientesRes.data && <ImportBanner clienteCount={clientes.length} />}

      <div className="dashboard-hub" style={{ marginTop: '1.5rem' }}>
        <TodayCard events={todayEvents} />
      </div>

      {canSeeFinancials === true && stats && (
        <FinanceKpiStrip
          aReceber={aReceber}
          aPagar={aPagar}
          saldoProjetado={stats.saldo}
          receitaMensal={stats.receitaMensal}
          canSeeFinancials={canSeeFinancials}
        />
      )}
    </div>
  );
}
