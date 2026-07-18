import type { WorkflowPost } from '../../store';

export const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

export const PLATFORM_LABELS: Record<NonNullable<WorkflowPost['platform']>, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  both: 'Ambas',
};

export const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

export const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho',
  revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno',
  enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente',
  correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
  falha_publicacao: 'status-danger',
};

/**
 * A presentational-only state, NOT a DB status. A post is "publicando" once it is
 * `agendado` and its scheduled time has passed — the publish cron is actively
 * working on it. Derived from existing fields (no new columns); kept out of the
 * `WorkflowPost['status']`-typed maps above so those stay aligned with the DB enum.
 */
export type PostPublishState = 'publicando' | WorkflowPost['status'];

export function getPostPublishState(p: {
  status: WorkflowPost['status'];
  scheduled_at?: string | null;
  platform?: WorkflowPost['platform'];
  tiktok_publish_status?: WorkflowPost['tiktok_publish_status'];
}): PostPublishState {
  if (p.status !== 'agendado') return p.status;
  const isDue = !!p.scheduled_at && new Date(p.scheduled_at) <= new Date();
  // Extends the original due-time-only derivation: a tiktok/both post is also
  // "publicando" once its TikTok side has been claimed by the cron (initiated/processing),
  // even if the shared scheduled_at hasn't ticked over yet on a slow poll cycle.
  const targetsTikTok = p.platform === 'tiktok' || p.platform === 'both';
  const tiktokPublishing =
    targetsTikTok &&
    (p.tiktok_publish_status === 'initiated' || p.tiktok_publish_status === 'processing');
  return isDue || tiktokPublishing ? 'publicando' : 'agendado';
}

export const PUBLISH_STATE_LABELS: Record<PostPublishState, string> = {
  ...STATUS_LABELS,
  publicando: 'Publicando…',
};

export const PUBLISH_STATE_CLASS: Record<PostPublishState, string> = {
  ...STATUS_CLASS,
  publicando: 'post-status--publicando',
};
