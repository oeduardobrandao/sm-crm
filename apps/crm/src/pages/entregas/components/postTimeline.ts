import type { WorkflowPost, PostApproval, PostStatusEvent } from '../../../store';
import { STATUS_LABELS } from '../postLabels';

export type TimelineTone = 'neutral' | 'approved' | 'correction' | 'published' | 'failed';

export interface TimelineNode {
  key: string;
  kind: 'created' | 'status';
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

export function buildPostTimeline(
  post: Pick<WorkflowPost, 'created_at'>,
  events: PostStatusEvent[],
  approvals: PostApproval[],
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

  return nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
