import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  getPortalApprovals, getDeadlineInfo,
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
 * Returns null if the active etapa has no iniciado_em.
 */
export function computeWorkflowDeadlineDate(
  allEtapas: WorkflowEtapa[],
  activeEtapa: WorkflowEtapa
): Date | null {
  if (!activeEtapa.iniciado_em) return null;
  const sorted = [...allEtapas].sort((a, b) => a.ordem - b.ordem);
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
    portalApprovals,
    isLoading,
    refresh,
  };
}
