/** Pure view helpers for the Admin blog queue (spec 2026-10-23-blog-automatico §6). The row
 * types mirror `blog_posts` as platform-admin returns it (supabase/functions/platform-admin/
 * blog-posts.ts): the list and every mutation return the list columns, get-blog-post the full
 * row. The Admin cannot import apps/crm, so the shapes are declared here. */
import { BLOG_LIMITS, type BlogImage, type BlogSource } from '@mesaas/ui/blog/model';
import { blogFilePostPath, blogPostPath } from '../../lib/routes';

export type BlogTab = 'aguardando' | 'publicados' | 'rejeitados';
export const BLOG_TABS: Array<{ value: BlogTab; label: string }> = [
  { value: 'aguardando', label: 'Aguardando' },
  { value: 'publicados', label: 'Publicados' },
  { value: 'rejeitados', label: 'Rejeitados' },
];

export function parseTab(value: string | null): BlogTab {
  return value === 'publicados' || value === 'rejeitados' ? value : 'aguardando';
}

export type BlogPostStatus =
  | 'rascunho'
  | 'ajuste_solicitado'
  | 'publicando'
  | 'publicado'
  | 'rejeitado'
  | 'despublicado';

/** `blog_posts.checks`, written by _shared/blog-checks.ts. Null on a row never checked. */
export interface BlogChecks {
  links: { ok: boolean; broken: string[] };
  images: { ok: boolean; missing_license: string[] };
  cover: boolean;
  copy: { em_dash: boolean; meta_endorsement: boolean };
  similar_titles: string[];
}

export type BlogCover = Omit<BlogImage, 'key'>;

/** List columns: everything but the body (and lede, images, topic_reason). */
export interface BlogPostRow {
  id: string;
  slug: string;
  status: BlogPostStatus;
  category: string;
  title: string;
  h1: string;
  description: string;
  cover_image: BlogCover | null;
  sources: BlogSource[] | null;
  feature_slug: string | null;
  checks: BlogChecks | null;
  revision_note: string | null;
  revised_after_note: boolean;
  rejection_reason: string | null;
  date: string | null;
  updated: string | null;
  revision: number;
  live_revision: number | null;
  publish_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

/** A hand-written post that lives as a file in the CRM (list-blog-posts `file_posts`). */
export interface FilePostRow {
  kind: 'arquivo';
  slug: string;
  title: string;
  description: string;
  category: string;
  date: string;
}

/** get-blog-post: the whole row. */
export interface BlogPostDetail extends BlogPostRow {
  lede: string;
  body_md: string;
  images: BlogImage[] | null;
  topic_reason: string;
  author: string;
}

/** Search Console URL-inspection result for a post (null until the collector exists). */
export interface IndexStatus {
  verdict: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  inspection_link: string | null;
  checked_at: string;
}

export interface SearchTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

/** One post in `blog-metrics`. Slugs with no views are absent from the map. */
export interface PostMetrics {
  views_7d: number;
  views_30d: number;
  views_total: number;
  search: SearchTotals | null;
  index: IndexStatus | null;
}

export interface BlogMetricsResponse {
  /** Last successful Search Console sync; null means it never ran (not configured). */
  gsc_updated_at: string | null;
  posts: Record<string, PostMetrics>;
}

/** `blog-post-metrics`: `views` is zero-filled, one entry per day ending today (São Paulo). */
export interface BlogPostMetricsResponse {
  views: Array<{ day: string; views: number }>;
  search: Array<{ day: string; clicks: number; impressions: number }>;
}

export type EditableField = 'title' | 'h1' | 'description' | 'lede' | 'body_md';

/** Editor counters. title/h1/description come from the shared model; lede and body mirror
 * BLOG_DRAFT_LIMITS in supabase/functions/_shared/blog-validate.ts. Hints only: the server
 * validates. */
export const FIELD_LIMITS: Record<EditableField, readonly [number, number]> = {
  title: BLOG_LIMITS.title,
  h1: BLOG_LIMITS.h1,
  description: BLOG_LIMITS.description,
  lede: [1, 300],
  body_md: [1, 50_000],
};

/** request-blog-changes and reject-blog-post cap the note at 1000 chars. */
export const NOTE_MAX = 1000;

export const CATEGORY_LABEL: Record<string, string> = {
  comparativo: 'Comparativo',
  guia: 'Guia',
  noticia: 'Notícia',
  tendencia: 'Tendência',
  planejamento: 'Planejamento',
};

export const STATUS_LABEL: Record<BlogPostStatus, string> = {
  rascunho: 'Rascunho',
  ajuste_solicitado: 'Ajuste pedido',
  publicando: 'Publicando',
  publicado: 'Publicado',
  rejeitado: 'Rejeitado',
  despublicado: 'Despublicado',
};

/** Short names for the "Post da semana" chip (BLOG_FEATURES only has the long pitch). */
export const FEATURE_SHORT_LABEL: Record<string, string> = {
  'aprovacao-de-post': 'Aprovação de post',
  'portal-do-cliente': 'Portal do cliente',
  'agente-de-conteudo-ia': 'Agente de conteúdo IA',
};

const HOUR = 3_600_000;
const STALE_MS = 72 * HOUR;
const SLOW_PUBLISH_MS = 30 * 60_000;
const NO_DRAFT_MS = 36 * HOUR;

const REVIEWABLE: BlogPostStatus[] = ['rascunho', 'ajuste_solicitado'];

const ms = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);

/** A news draft still in review after 3 days: it sorts last and wears "Desatualizado". */
export function isStale(row: BlogPostRow, now: Date): boolean {
  return (
    row.category === 'noticia' &&
    REVIEWABLE.includes(row.status) &&
    now.getTime() - ms(row.created_at) > STALE_MS
  );
}

/** Fresh rows newest first, then the stale ones (also newest first). */
export function sortQueue<T extends BlogPostRow>(rows: T[], now: Date): T[] {
  return [...rows].sort((a, b) => {
    const sa = isStale(a, now) ? 1 : 0;
    const sb = isStale(b, now) ? 1 : 0;
    return sa - sb || ms(b.created_at) - ms(a.created_at);
  });
}

/** True while a publicando row has waited more than 30 min for its revision to go live. */
export function isSlowPublish(row: BlogPostRow, now: Date): boolean {
  return (
    row.status === 'publicando' &&
    row.publish_attempt_at !== null &&
    now.getTime() - ms(row.publish_attempt_at) > SLOW_PUBLISH_MS
  );
}

/** Labels of the failing automatic checks, in the order the sidebar lists them. */
export function failingChecks(row: Pick<BlogPostRow, 'checks'>): string[] {
  const c = row.checks;
  if (!c) return [];
  const out: string[] = [];
  if (c.links && !c.links.ok) out.push('Link fora do ar');
  if (c.images && !c.images.ok) out.push('Imagem sem licença');
  if (c.cover === false) out.push('Sem imagem de capa');
  if (c.copy?.em_dash) out.push('Travessão no texto');
  if (c.copy?.meta_endorsement) out.push('Selo da Meta no texto');
  if (c.similar_titles && c.similar_titles.length > 0) out.push('Tema parecido com outro post');
  return out;
}

export interface CheckLine {
  label: string;
  ok: boolean;
  /** What failed: URLs, image keys, similar titles. */
  details: string[];
}

/** The sidebar checklist: every check, passing or not. Null when the row was never checked. */
export function checkLines(row: Pick<BlogPostRow, 'checks'>): CheckLine[] | null {
  const c = row.checks;
  if (!c) return null;
  const similar = c.similar_titles ?? [];
  return [
    {
      label: c.links?.ok === false ? 'Link fora do ar' : 'Links respondem',
      ok: c.links?.ok !== false,
      details: c.links?.broken ?? [],
    },
    {
      label: c.images?.ok === false ? 'Imagem sem licença' : 'Imagens com crédito e licença',
      ok: c.images?.ok !== false,
      details: c.images?.missing_license ?? [],
    },
    {
      label: c.cover === false ? 'Sem imagem de capa' : 'Imagem de capa',
      ok: c.cover !== false,
      details: [],
    },
    {
      label: c.copy?.em_dash ? 'Travessão no texto' : 'Sem travessão',
      ok: !c.copy?.em_dash,
      details: [],
    },
    {
      label: c.copy?.meta_endorsement ? 'Selo da Meta no texto' : 'Sem selo da Meta',
      ok: !c.copy?.meta_endorsement,
      details: [],
    },
    {
      label: similar.length > 0 ? 'Tema parecido com outro post' : 'Tema novo',
      ok: similar.length === 0,
      details: similar,
    },
  ];
}

export type ChipTone = 'success' | 'warning' | 'danger' | 'neutral';
export interface Chip {
  label: string;
  tone: ChipTone;
}

export function chipsFor(row: BlogPostRow, now: Date): Chip[] {
  const chips: Chip[] = [];
  const n = row.sources?.length ?? 0;
  if (n > 0) chips.push({ label: n === 1 ? '1 fonte' : `${n} fontes`, tone: 'neutral' });
  if (row.feature_slug) {
    const name = FEATURE_SHORT_LABEL[row.feature_slug] ?? row.feature_slug;
    chips.push({ label: `Post da semana: ${name}`, tone: 'neutral' });
  }
  for (const label of failingChecks(row)) chips.push({ label, tone: 'danger' });
  if (row.revised_after_note) chips.push({ label: 'Reescrito após sua nota', tone: 'success' });
  if (isStale(row, now)) chips.push({ label: 'Desatualizado', tone: 'warning' });
  if (row.status === 'publicando') {
    chips.push(
      isSlowPublish(row, now)
        ? { label: 'Publicação demorando', tone: 'warning' }
        : { label: 'Publicando…', tone: 'neutral' },
    );
  }
  return chips;
}

/** The 36 h silent-failure guard. No draft at all yet: nothing to date the banner with. */
export function noRecentDraft(lastDraftAt: string | null, now: Date): boolean {
  if (!lastDraftAt) return false;
  const t = ms(lastDraftAt);
  return Number.isFinite(t) && now.getTime() - t > NO_DRAFT_MS;
}

export type BlogAction =
  | 'reject'
  | 'edit'
  | 'request'
  | 'approve'
  | 'retry'
  | 'unpublish'
  | 'republish';

/** What the server accepts from each status (REVIEWABLE / EDITABLE / LIVE in blog-posts.ts),
 * in toolbar order. Gated by the row, not the tab: Aguardando also holds publicando rows. */
export function actionsFor(row: Pick<BlogPostRow, 'status'>): BlogAction[] {
  switch (row.status) {
    case 'rascunho':
    case 'ajuste_solicitado':
      return ['reject', 'edit', 'request', 'approve'];
    case 'publicando':
      return ['edit', 'retry'];
    case 'publicado':
      return ['edit', 'unpublish'];
    case 'despublicado':
      // retry re-fires the unpublish build: the Admin has no signal that the page left the air.
      return ['retry', 'republish'];
    default:
      return [];
  }
}

/** "Tentar de novo": a publicando row only once it is slow; a despublicado row always, since
 * nothing confirms the unpublish build went through (the page may still be live). */
export function showsRetry(row: BlogPostRow, now: Date): boolean {
  if (!actionsFor(row).includes('retry')) return false;
  return row.status === 'despublicado' || isSlowPublish(row, now);
}

/** One row of the Admin list: a rotina post (DB, actionable) or a hand-written one (file,
 * read-only). */
export type BlogListItem =
  | { kind: 'rotina'; row: BlogPostRow }
  | { kind: 'arquivo'; row: FilePostRow };

/** Publicados: DB and file posts merged by publication date, newest first. A DB row without a
 * `date` falls back to when it was approved, then created. The review tabs keep the queue
 * order and never hold file posts. */
export function itemsFor(
  tab: BlogTab,
  posts: BlogPostRow[],
  files: FilePostRow[],
  now: Date,
): BlogListItem[] {
  if (tab !== 'publicados') {
    return sortQueue(posts, now).map((row) => ({ kind: 'rotina', row }));
  }
  // An unparseable date sorts last.
  const at = (iso: string | null): number => {
    const t = ms(iso);
    return Number.isNaN(t) ? -Infinity : t;
  };
  const dated = [
    ...posts.map((row) => ({
      item: { kind: 'rotina', row } satisfies BlogListItem,
      at: at(row.date ?? row.approved_at ?? row.created_at),
    })),
    ...files.map((row) => ({
      item: { kind: 'arquivo', row } satisfies BlogListItem,
      at: at(row.date),
    })),
  ];
  // Array.sort is stable: equal dates keep DB-then-file order.
  return dated.sort((a, b) => b.at - a.at).map((d) => d.item);
}

export type BlogSort = 'recentes' | 'vistos' | 'cliques';
export const BLOG_SORTS: Array<{ value: BlogSort; label: string }> = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'vistos', label: 'Mais vistos' },
  { value: 'cliques', label: 'Mais cliques' },
];

export function parseSort(value: string | null): BlogSort {
  return value === 'vistos' || value === 'cliques' ? value : 'recentes';
}

/** Appends `?ordem=` / `&ordem=` so opening a row keeps the Publicados sort. */
export function withSort(path: string, sort: BlogSort): string {
  if (sort === 'recentes') return path;
  return `${path}${path.includes('?') ? '&' : '?'}ordem=${sort}`;
}

const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatInt = (n: number): string => nf.format(n);
export const formatPosition = (n: number): string => nf1.format(n);

/** Publicados sort. `recentes` keeps the incoming order (already by date); the others are a
 * stable descending sort, so ties keep date order. A slug with no metrics counts as zero. */
export function sortItems(
  items: BlogListItem[],
  metrics: Record<string, PostMetrics>,
  sort: BlogSort,
): BlogListItem[] {
  if (sort === 'recentes') return items;
  const score = (item: BlogListItem): number => {
    const m = metrics[item.row.slug];
    return sort === 'vistos' ? (m?.views_30d ?? 0) : (m?.search?.clicks ?? 0);
  };
  return [...items].sort((a, b) => score(b) - score(a));
}

/** "1.240 views (30d) · 38 cliques · posição 12,4". Search Console parts only once it has run. */
export function metricLine(m: PostMetrics | undefined, gscReady: boolean): string {
  const views = m?.views_30d ?? 0;
  const parts = [`${formatInt(views)} ${views === 1 ? 'view' : 'views'} (30d)`];
  const s = gscReady ? m?.search : null;
  if (s) {
    parts.push(`${formatInt(s.clicks)} ${s.clicks === 1 ? 'clique' : 'cliques'}`);
    if (s.position !== null) parts.push(`posição ${formatPosition(s.position)}`);
  }
  return parts.join(' · ');
}

/** File posts are always on the site; rotina posts once publicado/publicando. */
export function isLiveItem(item: BlogListItem): boolean {
  return item.kind === 'arquivo' || isLive(item.row);
}

export const itemSlug = (item: BlogListItem): string => item.row.slug;

/** Selection key: the row id for rotina posts, `arquivo:<slug>` for files (slugs are not ids). */
export const itemKey = (item: BlogListItem): string =>
  item.kind === 'arquivo' ? `arquivo:${item.row.slug}` : item.row.id;

export function itemPath(item: BlogListItem, tab: BlogTab): string {
  return item.kind === 'arquivo' ? blogFilePostPath(item.row.slug) : blogPostPath(item.row.id, tab);
}

const LIVE_BASE = 'https://www.mesaas.com.br/blog/';

/** Public URL of a post. Constant origin + encoded slug: nothing user-controlled reaches the
 * scheme or host. `fromAdmin` tags the visit (`?ref=admin`) so the site can leave it out of the
 * blog view counts; a copied/shared link never carries it. */
export function liveUrl(slug: string, opts?: { fromAdmin?: boolean }): string {
  return `${LIVE_BASE}${encodeURIComponent(slug)}${opts?.fromAdmin ? '?ref=admin' : ''}`;
}

/** Editing a live row republishes it on save. */
export function isLive(row: Pick<BlogPostRow, 'status'>): boolean {
  return row.status === 'publicado' || row.status === 'publicando';
}

/** Only the fields that changed, for update-blog-post. */
export function changedFields(
  post: Pick<BlogPostDetail, EditableField>,
  draft: Record<EditableField, string>,
): Partial<Record<EditableField, string>> {
  const out: Partial<Record<EditableField, string>> = {};
  for (const k of Object.keys(FIELD_LIMITS) as EditableField[]) {
    if (draft[k] !== (post[k] ?? '')) out[k] = draft[k];
  }
  return out;
}

/** "Fora do limite" hint for a counter. */
export function outOfRange(value: string, [min, max]: readonly [number, number]): boolean {
  return value.length < min || value.length > max;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

export function formatDay(iso: string | null): string {
  if (!iso) return '';
  // A bare calendar date has no time zone: format its digits as-is instead of
  // parsing it as UTC midnight (which shows the previous day in São Paulo).
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) return `${bare[3]}/${bare[2]}/${bare[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
}
