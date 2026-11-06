import type { WorkflowPost, PostApproval, PostStatusEvent, PostProcessEvent } from '../../../store';
import { i18n } from '@mesaas/i18n';
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
  if (ev.source === 'client') return i18n.t('postEditor:postTimeline.client');
  if (ev.source === 'system') return i18n.t('postEditor:postTimeline.system');
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
      return i18n.t('postEditor:postTimeline.process.desmembrado', {
        fluxo: str(antes.workflow_titulo, i18n.t('postEditor:postTimeline.process.aFluxo')),
        etapa: str(antes.etapa_nome, i18n.t('postEditor:postTimeline.process.currentStage')),
      });
    case 'aplicado':
      return i18n.t('postEditor:postTimeline.process.aplicado', {
        template: str(depois.template_nome, i18n.t('postEditor:postTimeline.process.template')),
      });
    case 'avancou':
      return i18n.t('postEditor:postTimeline.process.avancou', {
        etapa: str(depois.etapa_nome, i18n.t('postEditor:postTimeline.process.nextStage')),
      });
    case 'voltou':
      return i18n.t('postEditor:postTimeline.process.voltou', {
        etapa: str(depois.etapa_nome, i18n.t('postEditor:postTimeline.process.previousStage')),
      });
    case 'concluido':
      return i18n.t('postEditor:postTimeline.process.concluido');
    case 'reaberto':
      return i18n.t('postEditor:postTimeline.process.reaberto');
    case 'removido':
      return i18n.t('postEditor:postTimeline.process.removido');
    case 'vinculado':
      return i18n.t('postEditor:postTimeline.process.vinculado');
    case 'etapa_editada':
      return i18n
        .t('postEditor:postTimeline.process.etapaEditada', { nome: str(depois.nome, '') })
        .replace('  ', ' ');
    case 'voltou_rascunho':
      return i18n.t('postEditor:postTimeline.process.voltouRascunho');
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
      label: i18n.t('postEditor:postTimeline.created'),
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
      actorLabel:
        ev.origem === 'system' ? i18n.t('postEditor:postTimeline.system') : (ev.actor_name ?? '—'),
      comment: null,
      tone: ev.evento === 'concluido' ? 'approved' : 'neutral',
    });
  }

  return nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
