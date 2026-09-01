import { formatPostDateFull } from '@/utils/postDate';
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
 * Statuses driven entirely by machinery (the publish cron, Instagram/TikTok) —
 * once a post reaches one of these, moving it by hand in the CRM is blocked.
 * Single source for both drag guards that read it: CalendarGrid's calendar
 * drag (which re-exports these two below) and the Publicações kanban's card
 * drag/column drop guard.
 */
export const LOCKED_STATUSES = new Set<WorkflowPost['status']>([
  'agendado',
  'postado',
  'falha_publicacao',
]);

export const LOCKED_TOOLTIPS: Record<string, string> = {
  agendado: 'Post já agendado no Instagram — cancele o agendamento para mover',
  postado: 'Post já publicado',
  falha_publicacao: 'Post com falha de publicação — resolva o erro antes de reagendar',
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

/**
 * Who actually writes each status.
 *
 * Only the `equipe` set is a decision someone makes in the CRM. The rest arrive
 * on their own — the client acting in the Hub, or the publish cron — and a flat
 * list of nine equally-pickable options hid that completely. The picker groups
 * by this and the chip explains it.
 *
 * Client- and system-owned statuses stay selectable on purpose: publishing
 * outside Mesaas and then marking a post `postado` by hand is a legitimate
 * correction, so this labels ownership rather than enforcing it.
 */
export type StatusOwner = 'equipe' | 'cliente' | 'sistema';

export const STATUS_OWNER: Record<WorkflowPost['status'], StatusOwner> = {
  rascunho: 'equipe',
  revisao_interna: 'equipe',
  aprovado_interno: 'equipe',
  enviado_cliente: 'equipe',
  agendado: 'equipe',
  aprovado_cliente: 'cliente',
  correcao_cliente: 'cliente',
  postado: 'sistema',
  falha_publicacao: 'sistema',
};

/** Group order for the status picker. */
export const STATUS_OWNER_ORDER = [
  'equipe',
  'cliente',
  'sistema',
] as const satisfies readonly StatusOwner[];

/** `<optgroup label>` copy — reads as "who puts a post in this status". */
export const STATUS_OWNER_LABELS: Record<StatusOwner, string> = {
  equipe: 'Você define',
  cliente: 'O cliente define — pelo portal',
  sistema: 'O sistema define — automático',
};

/**
 * What happens to this post on its own, in one sentence, or null when nothing
 * automatic is pending and the post is simply waiting on a person.
 *
 * Rendered as the status chip's tooltip and as help text under the picker, so
 * the automatic transitions stop being folklore. Keep these claims true — each
 * one describes real behaviour:
 *  - `agendado`   → the publish cron fires at `scheduled_at`; date, tipo, platform
 *                   and caption are locked while it is armed (see `isScheduleLocked`).
 *  - `publicando` → derived state, the cron has the post in hand right now.
 *  - `enviado_cliente` → visible in the Hub; the client's verdict writes the status.
 *  - `falha_publicacao` → retried automatically while `publish_retry_count < 3`,
 *                   except for errors classified as non-retryable.
 */
export function getStatusAutomationHint(p: {
  status: WorkflowPost['status'];
  scheduled_at?: string | null;
  platform?: WorkflowPost['platform'];
  tiktok_publish_status?: WorkflowPost['tiktok_publish_status'];
}): string | null {
  const state = getPostPublishState(p);
  switch (state) {
    case 'publicando':
      return 'Publicando agora. O status vira "Postado" sozinho assim que a rede confirmar.';
    case 'agendado':
      return p.scheduled_at
        ? `Publica sozinho em ${formatPostDateFull(p.scheduled_at)}. Data, tipo, plataforma e legenda ficam travados até você cancelar o agendamento.`
        : 'Publica sozinho na data agendada. Data, tipo, plataforma e legenda ficam travados até você cancelar o agendamento.';
    case 'enviado_cliente':
      return 'Visível para o cliente no portal. O status muda sozinho quando ele aprovar ou pedir correção.';
    case 'aprovado_cliente':
      return 'O cliente aprovou pelo portal. Continua visível para ele.';
    case 'correcao_cliente':
      return 'O cliente pediu correção pelo portal. Nada acontece sozinho a partir daqui.';
    case 'falha_publicacao':
      return 'A publicação falhou. O sistema tenta de novo sozinho até 3 vezes; erros não recuperáveis param na hora.';
    default:
      return null;
  }
}

/**
 * Whether a post in this status is visible to the client in the Hub.
 *
 * This is the rule that used to live inline in WorkflowDrawer as
 * `isExternallyVisible`, and it is the single most consequential thing the
 * status column decides — picking "Enviado ao cliente" publishes the post to
 * the client's portal. It was only ever surfaced as a banner *inside* an
 * already-expanded post, i.e. after the fact. Exported so the row badge, the
 * status picker and the explainer all read the same source.
 *
 * Visibility is sticky: once a post reaches `enviado_cliente` every later
 * status keeps it visible, including `falha_publicacao`.
 */
export const STATUS_CLIENT_VISIBILITY: Record<WorkflowPost['status'], boolean> = {
  rascunho: false,
  revisao_interna: false,
  aprovado_interno: false,
  enviado_cliente: true,
  aprovado_cliente: true,
  correcao_cliente: true,
  agendado: true,
  postado: true,
  falha_publicacao: true,
};

export function isVisibleToClient(status: WorkflowPost['status']): boolean {
  return STATUS_CLIENT_VISIBILITY[status] ?? false;
}

/**
 * Short suffix for the status picker's options. Carries the emoji because a
 * native `<option>` renders text only — an SVG icon is impossible there.
 * Anywhere a real icon can be drawn, use VISIBILITY_TEXT_LABEL with a lucide
 * icon instead, or the line ends up with two icons saying the same thing.
 */
export const VISIBILITY_OPTION_SUFFIX = {
  visible: '👁 o cliente vê',
  internal: '🔒 interno',
} as const;

/** Same two labels, icon-free, for use alongside a real icon. */
export const VISIBILITY_TEXT_LABEL = {
  visible: 'o cliente vê',
  internal: 'interno',
} as const;

/** Row-badge copy — the tooltip carries the sentence the badge cannot. */
export const VISIBILITY_BADGE_LABEL = {
  visible: 'Visível para o cliente no portal',
  internal: 'Interno — o cliente não vê este post',
} as const;
