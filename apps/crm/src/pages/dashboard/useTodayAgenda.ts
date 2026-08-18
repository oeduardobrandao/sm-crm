import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { POST_STATUS_DEFINITIONS_QUERY_KEY } from '../../hooks/useStatusRegistry';
import {
  getAllActiveEtapas,
  getAllClienteDatas,
  getAssignedPendingPosts,
  getAwaitingClientePosts,
  getClientes,
  getMembros,
  getPostStatusDefinitions,
  getScheduledPosts,
  getTarefas,
} from '../../store';
import { buildStatusRegistry } from '../entregas/statusRegistry';
import {
  agendaRangeISO,
  buildTodayAgenda,
  type AgendaBuckets,
  type AgendaLabels,
  type AgendaScope,
} from './todayAgenda';

export type TodayAgendaStatus =
  | 'loading'
  | 'role_error'
  | 'no_membership'
  | 'membro_missing'
  | 'ready';

export interface TodayAgenda {
  status: TodayAgendaStatus;
  scope: AgendaScope;
  buckets: AgendaBuckets;
  now: Date;
}

const EMPTY: AgendaBuckets = { atrasado: [], hoje: [], proximos: [] };

/**
 * Role-aware data source for the dashboard "Hoje" card. Fails closed: NOTHING
 * is fetched (membros included) until the ACTIVE workspace role has resolved
 * (workspaceRole is null both while loading and on lookup failure, and
 * profile-level `role` goes stale across workspace switches, so neither can
 * decide the scope). Queries are component-local on purpose: DashboardPage's
 * useQueries batch is mocked by index in its test and must not grow.
 */
export function useTodayAgenda(): TodayAgenda {
  const { t } = useTranslation('dashboard');
  const { user, workspaceRole, membershipResolved, canSeeFinancials } = useAuth();
  const roleReady = membershipResolved === true && workspaceRole !== null;
  const scope: AgendaScope = workspaceRole === 'agent' ? 'mine' : 'workspace';
  const mine = scope === 'mine';

  // Same key/queryFn as useCurrentMembro, but gated on roleReady so the
  // membro is resolved from a role-gated list, never a stale cached one.
  const membros = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
    retry: 1,
    enabled: roleReady,
  });
  const membro = user
    ? ((membros.data ?? []).find((m) => m.crm_user_id === user.id) ?? null)
    : null;
  const membroLoading = membros.isLoading;
  const membroId = membro?.id ?? null;

  const statusDefs = useQuery({
    queryKey: POST_STATUS_DEFINITIONS_QUERY_KEY,
    queryFn: () => getPostStatusDefinitions(),
    staleTime: 5 * 60 * 1000,
    enabled: roleReady,
  });
  const registry = useMemo(() => buildStatusRegistry(statusDefs.data ?? []), [statusDefs.data]);

  const labels = useMemo<AgendaLabels>(
    () => ({
      recebimento: t('events.recebimento', 'Recebimento'),
      despesa: t('events.despesa', 'Despesa'),
      aniversario: t('events.aniversario', 'Aniversário'),
      hoje: t('today.labels.hoje', 'Hoje'),
      amanha: t('today.labels.amanha', 'Amanhã'),
      overdueDays: (n) => t('today.labels.overdueDays', { count: n }),
      inDays: (n) => t('today.labels.inDays', { count: n }),
      agendado: t('today.labels.agendado', 'Agendado'),
      naoAprovado: t('today.labels.naoAprovado', 'Não aprovado'),
      publicaAs: (time) => t('today.labels.publicaAs', { time }),
      aguardandoCliente: t('today.labels.aguardandoCliente', 'Aguardando cliente'),
      aguardandoClienteHa: (days) => t('today.labels.aguardandoClienteHa', { days }),
      aguardando: t('today.labels.aguardando', 'Aguardando'),
      semResposta: (days) => t('today.labels.semResposta', { days }),
    }),
    [t],
  );

  const now = new Date();
  const { startISO, endISO } = agendaRangeISO(now);

  const tarefas = useQuery({
    queryKey: ['tarefas'],
    queryFn: getTarefas,
    retry: 1,
    enabled: roleReady && (!mine || membroId != null),
  });
  const etapas = useQuery({
    queryKey: ['agent-pending-etapas'],
    queryFn: getAllActiveEtapas,
    retry: 1,
    enabled: roleReady && (!mine || membroId != null),
  });
  const scheduled = useQuery({
    queryKey: ['scheduled-posts', startISO, endISO],
    queryFn: () => getScheduledPosts(startISO, endISO),
    retry: 1,
    enabled: roleReady && (!mine || membroId != null),
  });
  const clientes = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    retry: 1,
    enabled: roleReady && !mine,
  });
  const datas = useQuery({
    queryKey: ['allClienteDatas'],
    queryFn: getAllClienteDatas,
    retry: 1,
    enabled: roleReady && !mine,
  });
  const awaiting = useQuery({
    queryKey: ['active-posts', 'awaiting-cliente'],
    queryFn: getAwaitingClientePosts,
    retry: 1,
    enabled: roleReady && !mine,
  });
  const pending = useQuery({
    queryKey: ['agent-pending-posts', membroId],
    queryFn: () => getAssignedPendingPosts(membroId!),
    retry: 1,
    enabled: roleReady && mine && membroId != null,
  });

  const buckets = useMemo(
    () =>
      buildTodayAgenda({
        now,
        scope,
        membroId,
        canSeeFinancials,
        tarefas: tarefas.data ?? [],
        etapas: etapas.data ?? [],
        scheduledPosts: scheduled.data ?? [],
        awaitingClientePosts: awaiting.data ?? [],
        assignedPendingPosts: pending.data ?? [],
        clientes: clientes.data ?? [],
        membros: membros.data ?? [],
        datas: datas.data ?? [],
        labels,
        postStatusLabel: (p) => registry.resolve(p).label,
      }),
    // `now` is intentionally excluded: it changes every render, and the
    // inputs below are what actually move the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      scope,
      membroId,
      canSeeFinancials,
      tarefas.data,
      etapas.data,
      scheduled.data,
      awaiting.data,
      pending.data,
      clientes.data,
      membros.data,
      datas.data,
      labels,
      registry,
    ],
  );

  let status: TodayAgendaStatus = 'ready';
  if (membershipResolved === 'error') status = 'role_error';
  else if (membershipResolved === true && workspaceRole === null) status = 'no_membership';
  else if (!roleReady) status = 'loading';
  else if (membroLoading) status = 'loading';
  else if (mine && membroId == null) status = 'membro_missing';
  else {
    const loading = mine
      ? tarefas.isLoading || etapas.isLoading || scheduled.isLoading || pending.isLoading
      : tarefas.isLoading ||
        etapas.isLoading ||
        scheduled.isLoading ||
        clientes.isLoading ||
        datas.isLoading ||
        awaiting.isLoading;
    if (loading) status = 'loading';
  }

  return { status, scope, buckets: status === 'ready' ? buckets : EMPTY, now };
}
