import type { WorkflowPost, PostApproval, PostStatusEvent, PostProcessEvent } from '../../../store';
import { STATUS_LABELS } from '../postLabels';

export type TimelineTone = 'neutral' | 'approved' | 'correction' | 'published' | 'failed';

export interface TimelineNode {
  key: string;
  kind: 'created' | 'status' | 'process';
  label: string;
  at: string;
  actorLabel: string;
  comment: string | null;
  tone: TimelineTone;
}

const TONE_BY_STATUS: Partial<Record<WorkflowPost['status'], TimelineTone>> = {
  aprovado_interno: 'approved',
  aprovado_cliente: 'approved',
  correcao_cliente: 'correction',
  postado: 'published',
  falha_publicacao: 'failed',
};

function actorLabelFor(ev: PostStatusEvent): string {
  if (ev.source === 'client') return 'Cliente';
  if (ev.source === 'system') return 'Sistema';
  return ev.actor_name ?? '—';
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v !== '' ? v : fallback;

/** Rótulo de um evento de processo a partir do payload gravado pelas RPCs da
 *  fase 2 (antes/depois em jsonb; ver post_process_log_event nas migrations
 *  20260919000003-7). Campos ausentes caem em texto genérico, nunca em erro. */
export function processEventLabel(ev: PostProcessEvent): string {
  const antes = ev.antes ?? {};
  const depois = ev.depois ?? {};
  switch (ev.evento) {
    case 'desmembrado':
      return `Desmembrado de ${str(antes.workflow_titulo, 'um fluxo')} na etapa ${str(antes.etapa_nome, 'atual')}`;
    case 'aplicado':
      return `Processo aplicado: ${str(depois.template_nome, 'template')}`;
    case 'avancou':
      return `Avançou para ${str(depois.etapa_nome, 'a próxima etapa')}`;
    case 'voltou':
      return `Voltou para ${str(depois.etapa_nome, 'a etapa anterior')}`;
    case 'concluido':
      return 'Processo concluído';
    case 'reaberto':
      return 'Processo reaberto';
    case 'removido':
      return 'Processo removido';
    case 'vinculado':
      return 'Vinculado a um fluxo, processo encerrado';
    case 'etapa_editada':
      return `Etapa ${str(depois.nome, '')} editada`.replace('  ', ' ');
    default:
      return ev.evento;
  }
}

export function buildPostTimeline(
  post: Pick<WorkflowPost, 'created_at'>,
  events: PostStatusEvent[],
  approvals: PostApproval[],
  processEvents: PostProcessEvent[] = [],
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  if (post.created_at) {
    nodes.push({
      key: 'created',
      kind: 'created',
      label: 'Criado',
      at: post.created_at,
      actorLabel: '—',
      comment: null,
      tone: 'neutral',
    });
  }

  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  for (const ev of events) {
    const comment =
      ev.post_approval_id != null
        ? (approvalById.get(ev.post_approval_id)?.comentario ?? null)
        : null;
    nodes.push({
      key: `event-${ev.id}`,
      kind: 'status',
      // Custom statuses show the nome snapshotted at event time; the tone
      // still comes from the canonical status underneath.
      label: ev.to_custom_nome ?? STATUS_LABELS[ev.to_status] ?? ev.to_status,
      at: ev.created_at,
      actorLabel: actorLabelFor(ev),
      comment,
      tone: TONE_BY_STATUS[ev.to_status] ?? 'neutral',
    });
  }

  // Terceira fonte (spec §5.4): o histórico do processo individual no mesmo
  // feed em que o usuário já procura. Mesma ordenação por `at`.
  for (const ev of processEvents) {
    nodes.push({
      key: `process-${ev.id}`,
      kind: 'process',
      label: processEventLabel(ev),
      at: ev.created_at,
      actorLabel: ev.origem === 'system' ? 'Sistema' : (ev.actor_name ?? '—'),
      comment: null,
      tone: ev.evento === 'concluido' ? 'approved' : 'neutral',
    });
  }

  return nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
