import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, GitBranch } from 'lucide-react';
import { getPostChipPreview, type WorkflowPost } from '@/store';
import { listPostMedia } from '@/services/postMedia';
import { STATUS_LABELS, TIPO_LABELS } from '@/pages/entregas/postLabels';

interface Props {
  postId: number;
  workflowId: number;
  titulo: string | null;
}

const OPEN_DELAY_MS = 200;
/** Rough max height of the open card (thumbnail + body); used to decide the flip. */
const CARD_ESTIMATE_PX = 260;

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

/** Linked-post chip with a lazy hover preview: media thumbnail, tipo/status
 * badges and the fluxo it belongs to. Data loads only when the card opens. */
export function PostChip({ postId, workflowId, titulo }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preview = useQuery({
    queryKey: ['post-preview', postId],
    queryFn: () => getPostChipPreview(postId),
    enabled: open,
    staleTime: 60_000,
  });
  const media = useQuery({
    queryKey: ['post-preview-media', postId],
    queryFn: () => listPostMedia(postId),
    enabled: open,
    staleTime: 60_000,
  });

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

  const first = media.data?.[0];
  const thumb = first ? (first.thumbnail_url ?? (first.kind === 'image' ? first.url : null)) : null;
  const tipo = preview.data?.tipo as WorkflowPost['tipo'] | undefined;
  const status = preview.data?.status as WorkflowPost['status'] | undefined;

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={cancelOpen}
      onFocus={scheduleOpen}
      onBlur={cancelOpen}
    >
      <Link
        to={`/entregas?drawer=${workflowId}`}
        className="flex w-fit items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 font-semibold transition-colors hover:bg-[var(--surface-hover)]"
        style={{ background: 'var(--bg-color)' }}
      >
        <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
        <span>{titulo ?? 'Ver post'}</span>
        <ArrowUpRight size={12} className="shrink-0 text-[var(--text-light)]" />
      </Link>
      {open && (
        <div
          role="tooltip"
          data-testid="post-hover-preview"
          className={`absolute left-0 z-50 w-72 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-left shadow-lg ${
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {thumb && <img src={thumb} alt="" className="h-36 w-full object-cover" loading="lazy" />}
          <div className="flex flex-col gap-2 p-3">
            <div className="text-sm font-semibold text-[var(--text-main)]">
              {preview.data?.titulo ?? titulo ?? 'Post'}
            </div>
            {preview.isLoading && (
              <div className="text-xs text-[var(--text-muted)]">Carregando…</div>
            )}
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
            {preview.data?.workflow_titulo && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <GitBranch size={12} className="shrink-0" />
                <span className="truncate">{preview.data.workflow_titulo}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
