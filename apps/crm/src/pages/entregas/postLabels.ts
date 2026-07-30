import type { ClientePost, WorkflowPost } from '../../store';

export const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

export const TIPO_COLORS: Record<WorkflowPost['tipo'], string> = {
  feed: '#eab308',
  reels: '#E1306C',
  stories: '#42c8f5',
  carrossel: '#3ecf8e',
};

/** Fixed render order for tipo dots/swatches, so a day looks identical across refetches. */
export const TIPO_ORDER = [
  'feed',
  'carrossel',
  'reels',
  'stories',
] as const satisfies readonly WorkflowPost['tipo'][];

/** Badge pair: solid text color over a 25-alpha tint of itself. */
export const TIPO_BADGE_COLORS: Record<WorkflowPost['tipo'], { bg: string; text: string }> =
  Object.fromEntries(
    (Object.keys(TIPO_COLORS) as WorkflowPost['tipo'][]).map((tipo) => [
      tipo,
      { bg: `${TIPO_COLORS[tipo]}25`, text: TIPO_COLORS[tipo] },
    ]),
  ) as Record<WorkflowPost['tipo'], { bg: string; text: string }>;

export const PLATFORM_LABELS: Record<NonNullable<WorkflowPost['platform']>, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  both: 'Ambas',
};

/** Pipeline order of post statuses — column order for the Publicações kanban
 *  and sort order for status columns. */
export const POST_STATUS_ORDER = [
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
] as const satisfies readonly WorkflowPost['status'][];

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

/** Key for the tipo dashes/dots, in TIPO_ORDER. Consumed by DateTimePicker's legend. */
export const TIPO_LEGEND: { color: string; label: string }[] = TIPO_ORDER.map((tipo) => ({
  color: TIPO_COLORS[tipo],
  label: TIPO_LABELS[tipo],
}));

export type DayMarker = { colors: string[]; label: string };

/** Local-time `yyyy-MM-dd`. Must match how CalendarGrid builds its droppable ids — a
 *  UTC-based key shifts posts to the wrong day either side of midnight. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Groups scheduled posts into per-day dot markers: one dot per distinct tipo present that
 * day (never one per post), in TIPO_ORDER, plus a pre-formatted tooltip with the counts.
 */
export function buildTipoDayMarkers(
  posts: Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>[],
  opts?: { excludePostId?: number },
): Map<string, DayMarker> {
  const counts = new Map<string, Map<WorkflowPost['tipo'], number>>();

  for (const post of posts) {
    if (!post.scheduled_at) continue;
    if (opts?.excludePostId != null && post.id === opts.excludePostId) continue;

    const key = localDayKey(new Date(post.scheduled_at));
    let byTipo = counts.get(key);
    if (!byTipo) {
      byTipo = new Map();
      counts.set(key, byTipo);
    }
    byTipo.set(post.tipo, (byTipo.get(post.tipo) ?? 0) + 1);
  }

  const markers = new Map<string, DayMarker>();
  for (const [key, byTipo] of counts) {
    const present = TIPO_ORDER.filter((tipo) => byTipo.has(tipo));
    markers.set(key, {
      colors: present.map((tipo) => TIPO_COLORS[tipo]),
      label: present.map((tipo) => `${byTipo.get(tipo)} ${TIPO_LABELS[tipo]}`).join(' · '),
    });
  }
  return markers;
}
