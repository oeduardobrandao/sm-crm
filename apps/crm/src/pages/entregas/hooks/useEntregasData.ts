import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  getPortalApprovals, getDeadlineInfo, getWorkflowPostsCounts,
  type Workflow, type WorkflowEtapa, type Cliente, type Membro,
  type WorkflowTemplate, type PortalApproval, type PostMedia,
} from '../../../store';
import { getWorkflowCovers } from '../../../services/postMedia';

export interface BoardCard {
  workflow: Workflow;
  etapa: WorkflowEtapa;
  cliente: Cliente | undefined;
  membro: Membro | undefined;
  deadline: ReturnType<typeof getDeadlineInfo>;
  totalEtapas: number;
  etapaIdx: number;
  allEtapas: WorkflowEtapa[];
  coverMedia?: PostMedia;
}

export interface BoardRow {
  key: string;
  label: string;
  stepNames: string[];
  columns: Map<string, BoardCard[]>;
}

export interface BoardFilters {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

/**
 * Computes the absolute deadline date from an etapa's start time and duration.
 * - corridos: adds prazo_dias calendar days
 * - uteis: advances prazo_dias Mon–Fri days (no public holiday exclusions)
 */
export function computeDeadlineDate(
  iniciado_em: string,
  prazo_dias: number,
  tipo_prazo: 'corridos' | 'uteis'
): Date {
  const start = new Date(iniciado_em);
  if (tipo_prazo === 'corridos') {
    const result = new Date(start);
    result.setDate(result.getDate() + prazo_dias);
    return result;
  }
  // uteis: count only Mon-Fri
  let remaining = prazo_dias;
  const cursor = new Date(start);
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return cursor;
}

/**
 * Computes the estimated workflow end date by chaining all remaining etapas
 * from the active one through the last, starting from the active etapa's iniciado_em.
 * When steps have data_limite, uses the last step's data_limite as the end date.
 * Returns null if neither data_limite nor iniciado_em is available.
 */
export function computeWorkflowDeadlineDate(
  allEtapas: WorkflowEtapa[],
  activeEtapa: WorkflowEtapa
): Date | null {
  const sorted = [...allEtapas].sort((a, b) => a.ordem - b.ordem);

  // If any steps have data_limite set, use the last step's data_limite
  const lastWithLimit = [...sorted].reverse().find(e => e.data_limite);
  if (lastWithLimit?.data_limite) {
    return new Date(lastWithLimit.data_limite);
  }

  if (!activeEtapa.iniciado_em) return null;
  const activeIdx = sorted.findIndex(e => e.id === activeEtapa.id);
  if (activeIdx === -1) return null;
  const remaining = sorted.slice(activeIdx);

  let currentStart = activeEtapa.iniciado_em;
  let deadline: Date = new Date(currentStart);
  for (const etapa of remaining) {
    deadline = computeDeadlineDate(currentStart, etapa.prazo_dias, etapa.tipo_prazo);
    currentStart = deadline.toISOString();
  }
  return deadline;
}

/**
 * Subtracts business or calendar days from a date.
 * Inverse of computeDeadlineDate for backward scheduling.
 */
export function subtractDays(
  from: Date,
  days: number,
  tipoPrazo: 'corridos' | 'uteis'
): Date {
  const result = new Date(from);
  if (tipoPrazo === 'corridos') {
    result.setDate(result.getDate() - days);
    return result;
  }
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

/**
 * Returns the next upcoming date for the given day of month (1-31).
 * If this month's occurrence is today or in the future, returns it.
 * Otherwise returns next month's occurrence (clamped to the last day of that month).
 */
export function getNextDeliveryDate(diaEntrega: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);  // compare date only
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based

  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const dayThisMonth = Math.min(diaEntrega, daysInCurrentMonth);
  const thisMonthDate = new Date(year, month, dayThisMonth);

  if (thisMonthDate >= today) {
    return thisMonthDate;
  }

  // Next month
  const nextMonth = month + 1 > 11 ? 0 : month + 1;
  const nextYear = month + 1 > 11 ? year + 1 : year;
  const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  const dayNextMonth = Math.min(diaEntrega, daysInNextMonth);
  return new Date(nextYear, nextMonth, dayNextMonth);
}

/**
 * Computes data_limite (ISO date string) for each step in a data_entrega workflow.
 * The aprovacao_cliente step gets deliveryDate.
 * Steps before the anchor: walk backward subtracting each prior step's prazo_dias.
 * Steps after the anchor: walk forward adding each subsequent step's prazo_dias.
 * Returns Map<ordem, ISO date string>.
 */
export function computeDeliveryDeadlines(
  etapas: WorkflowEtapa[],
  deliveryDate: Date
): Map<number, string> {
  const sorted = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const anchorIdx = sorted.findIndex(e => e.tipo === 'aprovacao_cliente');
  if (anchorIdx === -1) return new Map();

  const toISO = (d: Date) => d.toISOString().split('T')[0];
  const result = new Map<number, string>();

  // Anchor step gets delivery date
  result.set(sorted[anchorIdx].ordem, toISO(deliveryDate));

  // Walk backward from anchor (each prior step ends when next step begins)
  let cursor = new Date(deliveryDate);
  for (let i = anchorIdx - 1; i >= 0; i--) {
    cursor = subtractDays(cursor, sorted[i + 1].prazo_dias, sorted[i + 1].tipo_prazo);
    result.set(sorted[i].ordem, toISO(cursor));
  }

  // Walk forward from anchor
  cursor = new Date(deliveryDate);
  for (let i = anchorIdx + 1; i < sorted.length; i++) {
    cursor = computeDeadlineDate(cursor.toISOString(), sorted[i].prazo_dias, sorted[i].tipo_prazo);
    result.set(sorted[i].ordem, toISO(cursor));
  }

  return result;
}

export function useEntregasData() {
  const qc = useQueryClient();

  const { data: workflows = [], isLoading: loadingWf } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
  });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: templates = [] } = useQuery({ queryKey: ['workflow-templates'], queryFn: getWorkflowTemplates });

  const activeWorkflows = workflows.filter(w => w.status === 'ativo');

  const etapasQuery = useQuery({
    queryKey: ['all-active-etapas', activeWorkflows.map(w => w.id).join(',')],
    queryFn: async () => {
      const map = new Map<number, WorkflowEtapa[]>();
      await Promise.all(
        activeWorkflows.map(async w => {
          const etapas = await getWorkflowEtapas(w.id!);
          map.set(w.id!, etapas);
        })
      );
      return map;
    },
    enabled: !loadingWf,
  });

  const etapasMap: Map<number, WorkflowEtapa[]> = etapasQuery.data || new Map();

  // Collect approval etapa IDs for portal approvals query
  const approvalEtapaIds: number[] = [];
  for (const [, etapas] of etapasMap) {
    for (const e of etapas) {
      if (e.tipo === 'aprovacao_cliente' && e.status === 'ativo' && e.id) {
        approvalEtapaIds.push(e.id);
      }
    }
  }

  const { data: portalApprovals = [] } = useQuery<PortalApproval[]>({
    queryKey: ['portal-approvals', approvalEtapaIds.join(',')],
    queryFn: () => getPortalApprovals(approvalEtapaIds),
    enabled: approvalEtapaIds.length > 0,
  });

  const activeWorkflowIds = activeWorkflows.map(w => w.id!).filter(Boolean);
  const { data: covers } = useQuery({
    queryKey: ['workflow-covers', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowCovers(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: postsCountsData } = useQuery({
    queryKey: ['workflow-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const postsCounts: Map<number, number> = postsCountsData ?? new Map();

  // Build BoardCards from active workflows
  const cards: BoardCard[] = [];
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    let activeEtapa = etapas.find(e => e.status === 'ativo');
    if (!activeEtapa && etapas.length > 0) {
      activeEtapa = etapas[w.etapa_atual] || etapas[0];
    }
    if (!activeEtapa) continue;
    const cliente = clientes.find(c => c.id === w.cliente_id);
    const membro = activeEtapa.responsavel_id
      ? membros.find(m => m.id === activeEtapa!.responsavel_id)
      : undefined;
    const deadline = getDeadlineInfo(activeEtapa);
    cards.push({
      workflow: w,
      etapa: activeEtapa,
      cliente,
      membro,
      deadline,
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
      allEtapas: etapas,
      coverMedia: covers?.get(w.id!),
    });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ['workflows'] });
    qc.invalidateQueries({ queryKey: ['workflow-templates'] });
    qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
    qc.invalidateQueries({ queryKey: ['portal-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-covers'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  }

  const isLoading = loadingWf || etapasQuery.isLoading;

  return {
    workflows,
    activeWorkflows,
    clientes,
    membros,
    templates,
    etapasMap,
    cards,
    postsCounts,
    portalApprovals,
    isLoading,
    refresh,
  };
}
