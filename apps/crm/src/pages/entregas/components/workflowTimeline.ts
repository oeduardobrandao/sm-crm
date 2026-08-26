import { differenceInDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { WorkflowEvent, WorkflowEventChange } from '../../../store';

export type WorkflowTimelineTone = 'neutral' | 'approved' | 'correction' | 'published';

export interface WorkflowTimelineNode {
  key: string;
  label: string;
  detail: string | null;
  at: string;
  actorLabel: string;
  tone: WorkflowTimelineTone;
  diffs: string[];
  eventType: WorkflowEvent['event_type'];
}

// Exhaustive (not defaulted) on purpose: a new event_type added to the union
// without an explicit tone here is a compile error, not a silent 'neutral'.
// Unlike post statuses (an effectively open string via custom statuses),
// event_type is a closed, backend-defined enum, so exhaustiveness is cheap
// to keep and worth enforcing.
const TONE_BY_EVENT_TYPE: Record<WorkflowEvent['event_type'], WorkflowTimelineTone> = {
  criado: 'neutral',
  etapa_iniciada: 'neutral',
  etapa_editada: 'neutral',
  fluxo_editado: 'neutral',
  fluxo_arquivado: 'neutral',
  template_migrado: 'neutral',
  template_propagado: 'neutral',
  etapa_concluida: 'approved',
  etapa_revertida: 'correction',
  fluxo_reaberto: 'correction',
  fluxo_concluido: 'published',
};

const FIELD_LABELS: Record<string, string> = {
  titulo: 'Título',
  cliente_id: 'Cliente',
  recorrente: 'Recorrente',
  link_notion: 'Link Notion',
  link_drive: 'Link Drive',
  nome: 'Nome',
  prazo_dias: 'Prazo',
  tipo_prazo: 'Tipo de prazo',
  data_limite: 'Data limite',
  responsavel_id: 'Responsável',
  tipo: 'Tipo',
};

// The "start anchor" event types for tempo-na-etapa math. etapa_iniciada is
// the normal case; etapa_revertida and fluxo_reaberto carry the
// re-activated etapa's id specifically so they can anchor a subsequent
// completion; template_migrado carries the newly-activated etapa's id for
// the same reason, since the plain etapa-activation UPDATE that would
// otherwise fire etapa_iniciada is suppressed in all three of those flows.
const ANCHOR_EVENT_TYPES = new Set<WorkflowEvent['event_type']>([
  'etapa_iniciada',
  'etapa_revertida',
  'fluxo_reaberto',
  'template_migrado',
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function labelFor(ev: WorkflowEvent): string {
  switch (ev.event_type) {
    case 'criado':
      return 'Fluxo criado';
    case 'etapa_iniciada':
      return `Etapa iniciada: ${ev.etapa_nome ?? '—'}`;
    case 'etapa_concluida':
      return `Etapa concluída: ${ev.etapa_nome ?? '—'}`;
    case 'etapa_revertida': {
      const voltouDe = typeof ev.metadata.voltou_de === 'string' ? ev.metadata.voltou_de : '—';
      return `Etapa revertida: ${voltouDe} → ${ev.etapa_nome ?? '—'}`;
    }
    case 'etapa_editada':
      return `Etapa editada: ${ev.etapa_nome ?? '—'}`;
    case 'fluxo_editado':
      return 'Fluxo editado';
    case 'fluxo_concluido':
      return 'Fluxo concluído';
    case 'fluxo_reaberto':
      return 'Fluxo reaberto';
    case 'fluxo_arquivado':
      return 'Fluxo arquivado';
    case 'template_migrado': {
      const from =
        typeof ev.metadata.from_template_nome === 'string' ? ev.metadata.from_template_nome : '—';
      const to =
        typeof ev.metadata.to_template_nome === 'string' ? ev.metadata.to_template_nome : '—';
      return `Template migrado: ${from} → ${to}`;
    }
    case 'template_propagado': {
      const nome = typeof ev.metadata.template_nome === 'string' ? ev.metadata.template_nome : '—';
      return `Template atualizado: ${nome}`;
    }
    default:
      // Forward-compat: an event_type the frontend doesn't yet know how to
      // label falls back to the raw string rather than crashing.
      return ev.event_type;
  }
}

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'recorrente') return value ? 'Sim' : 'Não';
  if (field === 'prazo_dias') return `${value} dias`;
  if (field === 'data_limite' && typeof value === 'string' && ISO_DATE_RE.test(value)) {
    return format(parseISO(value), 'dd/MM/yyyy', { locale: ptBR });
  }
  if (field === 'tipo_prazo') {
    return value === 'uteis' ? 'úteis' : String(value);
  }
  if (field === 'tipo') {
    if (value === 'padrao') return 'Padrão';
    if (value === 'aprovacao_cliente') return 'Aprovação do cliente';
    return String(value);
  }
  return String(value);
}

function renderChange(change: WorkflowEventChange): string {
  const label = FIELD_LABELS[change.field] ?? change.field;
  const fromDisplay = change.from_label ?? formatChangeValue(change.field, change.from);
  const toDisplay = change.to_label ?? formatChangeValue(change.field, change.to);
  return `${label}: ${fromDisplay} → ${toDisplay}`;
}

function diffsFor(ev: WorkflowEvent): string[] {
  const changes = ev.metadata.changes;
  if (!changes || changes.length === 0) return [];
  return changes.map(renderChange);
}

function findAnchor(
  ev: WorkflowEvent,
  sorted: WorkflowEvent[],
  index: number,
): WorkflowEvent | null {
  for (let i = index - 1; i >= 0; i--) {
    const candidate = sorted[i];
    if (candidate.etapa_id === ev.etapa_id && ANCHOR_EVENT_TYPES.has(candidate.event_type)) {
      return candidate;
    }
  }
  // First-etapa fallback: the very first etapa of a workflow never gets an
  // etapa_iniciada event (no INSERT trigger on workflow_etapas, and the
  // wizard creates it already status: 'ativo'), so its completion is the
  // first event ever involving that etapa_id. Fall back to the workflow's
  // own 'criado' event, which every workflow has exactly one of and which
  // always precedes any etapa's first completion.
  return sorted.find((candidate) => candidate.event_type === 'criado') ?? null;
}

function renderDuration(fromISO: string, toISO: string): string {
  // Floor, not round/ceiling: a 3.9-day stay reading as "3 dias" undersells
  // it less than a 2.1-day stay reading as "3 dias" would oversell it.
  const days = differenceInDays(parseISO(toISO), parseISO(fromISO));
  if (days <= 0) return 'menos de 1 dia na etapa';
  return `${days} dia(s) na etapa`;
}

function detailFor(ev: WorkflowEvent, sorted: WorkflowEvent[], index: number): string | null {
  if (ev.event_type !== 'etapa_concluida') return null;
  const anchor = findAnchor(ev, sorted, index);
  if (!anchor) return null;
  return renderDuration(anchor.created_at, ev.created_at);
}

function actorLabelFor(ev: WorkflowEvent): string {
  // Order matters: check the agent-created case first (only relevant on
  // 'criado' events), then 'system', then fall back to the named actor.
  // MCP-created and data-import-created workflows both resolve to
  // source: 'workspace_user' via the DB trigger's user_id fallback, so
  // source alone can never distinguish an agent-created workflow from a
  // human-created one — only metadata.created_via on 'criado' can.
  if (ev.event_type === 'criado' && ev.metadata.created_via === 'agent') return 'Agente';
  if (ev.source === 'system') return 'Sistema';
  return ev.actor_name ?? '—';
}

export function buildWorkflowTimeline(events: WorkflowEvent[]): WorkflowTimelineNode[] {
  const sorted = [...events].sort((a, b) => {
    const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (byTime !== 0) return byTime;
    return a.id - b.id;
  });

  return sorted.map((ev, index) => ({
    key: `event-${ev.id}`,
    label: labelFor(ev),
    detail: detailFor(ev, sorted, index),
    at: ev.created_at,
    actorLabel: actorLabelFor(ev),
    // Runtime guard alongside the exhaustive Record: a future/unknown
    // event_type still degrades gracefully (matches labelFor's fallback)
    // instead of rendering a `history-step-icon--undefined` class.
    tone: TONE_BY_EVENT_TYPE[ev.event_type] ?? 'neutral',
    diffs: diffsFor(ev),
    eventType: ev.event_type,
  }));
}
