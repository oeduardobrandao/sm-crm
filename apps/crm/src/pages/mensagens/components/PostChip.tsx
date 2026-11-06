import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, GitBranch, MessageSquare } from 'lucide-react';
import { getDiscussaoNaoLidas, getPostChipPreview, type WorkflowPost } from '@/store';
import { listPostMedia } from '@/services/postMedia';
import { STATUS_LABELS, TIPO_LABELS } from '@/pages/entregas/postLabels';

interface Props {
  postId: number;
  /** NULL = post avulso (fora de fluxo) -- the chip still links, via the
   *  universal `?post=` deep-link form. */
  workflowId: number | null;
  titulo: string | null;
  /** Team-chat blocks: the preview adds the discussion message count and a link that
   *  opens the post straight on its team discussion. */
  comDiscussao?: boolean;
  /** Which edge the preview card aligns to (right-aligned bubbles use 'end'). */
  align?: 'start' | 'end';
}

const OPEN_DELAY_MS = 200;
/** Rough max height of the open card (thumbnail + body); used to decide the flip. */
const CARD_ESTIMATE_PX = 260;

/** Deep link of a linked post: inside its fluxo when it has one, else the universal form. */
export function postChipHref(postId: number, workflowId: number | null): string {
  return workflowId != null
    ? `/entregas?drawer=${workflowId}&post=${postId}`
    : `/entregas?post=${postId}`;
}

/** Deep link that opens the post on its team discussion (`&discussao=1`). */
export function postDiscussaoHref(postId: number, workflowId: number | null): string {
  return `${postChipHref(postId, workflowId)}&discussao=1`;
}

/** The absolutely-positioned card is clipped by the nearest scrollable ancestor,
 * so the flip decision measures the room INSIDE that ancestor, not the viewport. */
function placementFor(el: HTMLElement | null): 'above' | 'below' {
  if (!el) return 'above';
  let boundTop = 0;
  let parent = el.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      boundTop = parent.getBoundingClientRect().top;
      break;
    }
    parent = parent.parentElement;
  }
  const room = el.getBoundingClientRect().top - boundTop;
  return room < CARD_ESTIMATE_PX ? 'below' : 'above';
}

/** Lazy preview data of a linked post (thumbnail, tipo/status, fluxo). Loads only
 *  while `enabled` (the card is open). */
export function usePostPreview(postId: number, enabled: boolean, comDiscussao = false) {
  const preview = useQuery({
    queryKey: ['post-preview', postId],
    queryFn: () => getPostChipPreview(postId),
    enabled,
    staleTime: 60_000,
  });
  const media = useQuery({
    queryKey: ['post-preview-media', postId],
    queryFn: () => listPostMedia(postId),
    enabled,
    staleTime: 60_000,
  });
  // getDiscussaoNaoLidas returns no row for a post without comments: no row = 0.
  const discussao = useQuery({
    queryKey: ['post-preview-discussao', postId],
    queryFn: () => getDiscussaoNaoLidas({ postIds: [postId] }),
    enabled: enabled && comDiscussao,
    staleTime: 60_000,
  });
  const discussaoTotal = discussao.data?.find((r) => r.postId === postId)?.total ?? 0;
  const first = media.data?.[0];
  const thumb = first ? (first.thumbnail_url ?? (first.kind === 'image' ? first.url : null)) : null;
  return {
    thumb,
    titulo: preview.data?.titulo ?? null,
    discussaoTotal,
    isLoading: preview.isLoading,
    tipo: preview.data?.tipo as WorkflowPost['tipo'] | undefined,
    status: preview.data?.status as WorkflowPost['status'] | undefined,
    workflowTitulo: preview.data?.workflow_titulo ?? null,
  };
}

/** Body of the post preview card: thumbnail, title, tipo/status badges, fluxo. */
export function PostPreviewBody({
  data,
  fallbackTitulo,
  discussaoHref,
}: {
  data: ReturnType<typeof usePostPreview>;
  fallbackTitulo: string | null;
  /** Shows "Abrir na discussão do post" (desktop card only; the phone uses a menu action). */
  discussaoHref?: string;
}) {
  const { t } = useTranslation('messages');
  const { thumb, tipo, status } = data;
  return (
    <>
      {thumb && <img src={thumb} alt="" className="h-36 w-full object-cover" loading="lazy" />}
      <div className="flex flex-col gap-2 p-3">
        <div className="text-sm font-semibold text-[var(--text-main)]">
          {data.titulo ?? fallbackTitulo ?? t('postChip.postFallback')}
        </div>
        {data.isLoading && <div className="text-xs text-[var(--text-muted)]">{t('loading')}</div>}
        {(tipo || status) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tipo && (
              <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                {TIPO_LABELS[tipo] ?? tipo}
              </span>
            )}
            {status && (
              <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                {STATUS_LABELS[status] ?? status}
              </span>
            )}
          </div>
        )}
        {data.workflowTitulo && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate">{data.workflowTitulo}</span>
          </div>
        )}
        {data.discussaoTotal > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <MessageSquare size={12} className="shrink-0" />
            <span>{t('postChip.discussionMessages', { count: data.discussaoTotal })}</span>
          </div>
        )}
        {discussaoHref && (
          <Link
            to={discussaoHref}
            className="flex w-fit items-center gap-1 text-xs font-semibold text-[var(--text-main)] underline-offset-2 hover:underline"
          >
            {t('postChip.openDiscussion')}
            <ArrowUpRight size={12} className="shrink-0" />
          </Link>
        )}
      </div>
    </>
  );
}

/** Linked-post chip with a lazy hover preview: media thumbnail, tipo/status
 * badges and the fluxo it belongs to. Data loads only when the card opens. */
export function PostChip({
  postId,
  workflowId,
  titulo,
  comDiscussao = false,
  align = 'start',
}: Props) {
  const { t } = useTranslation('messages');
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preview = usePostPreview(postId, open, comDiscussao);

  function scheduleOpen() {
    timer.current = setTimeout(() => {
      setPlacement(placementFor(wrapperRef.current));
      setOpen(true);
    }, OPEN_DELAY_MS);
  }
  function cancelOpen() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex max-w-full"
      onMouseEnter={scheduleOpen}
      onMouseLeave={cancelOpen}
      onFocus={scheduleOpen}
      onBlur={(e) => {
        // Focus moving into the card (its discussion link) must not close it.
        if (e.relatedTarget instanceof Node && wrapperRef.current?.contains(e.relatedTarget))
          return;
        cancelOpen();
      }}
    >
      <Link
        to={postChipHref(postId, workflowId)}
        className="flex w-fit max-w-full items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 font-semibold transition-colors hover:bg-[var(--surface-hover)]"
        style={{ background: 'var(--bg-color)' }}
      >
        <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{titulo ?? t('postChip.viewPost')}</span>
        <ArrowUpRight size={12} className="shrink-0 text-[var(--text-light)]" />
      </Link>
      {open && (
        // The gap to the chip is padding of this wrapper (not a margin), so the pointer can
        // cross it into the card and reach the link without the hover closing.
        <div
          role="tooltip"
          data-testid="post-hover-preview"
          className={`absolute z-50 w-72 text-left ${align === 'end' ? 'right-0' : 'left-0'} ${
            placement === 'above' ? 'bottom-full pb-2' : 'top-full pt-2'
          }`}
        >
          <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg">
            <PostPreviewBody
              data={preview}
              fallbackTitulo={titulo}
              discussaoHref={comDiscussao ? postDiscussaoHref(postId, workflowId) : undefined}
            />
          </div>
        </div>
      )}
    </span>
  );
}
