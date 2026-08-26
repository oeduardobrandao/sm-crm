import { useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getDashboardStats, getClientes, type Cliente } from '../../store';
import { useAuth } from '../../context/AuthContext';
import { ImportBanner } from '../../components/import/ImportBanner';
import { TrialNudgeCard } from '../../components/billing/TrialNudgeCard';
import { WhatsAppSupportCard } from '@/components/support/WhatsAppSupportCard';
import { ClientHealthMonitor } from './components/ClientHealthMonitor';
import { AgentPendingSection } from './components/AgentPendingSection';
import { TodayCard } from './components/TodayCard';
import { FinanceKpiStrip } from './components/FinanceKpiStrip';

export default function DashboardPage() {
  const { role, workspaceRole, canSeeFinancials } = useAuth();
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
      { queryKey: ['clientes'], queryFn: getClientes, retry: 1 },
    ],
  });
  const [statsRes, clientesRes] = results;
  const stats = statsRes.data ?? null;
  const clientes: Cliente[] = clientesRes.data ?? [];

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
      <TodayCard />

      {!isAgent && <TrialNudgeCard />}
      {!isAgent && <WhatsAppSupportCard />}

      {/* Agents see their own pending work where managers see client health. */}
      {isAgent ? <AgentPendingSection /> : <ClientHealthMonitor />}

      {clientesRes.data && <ImportBanner clienteCount={clientes.length} />}

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
