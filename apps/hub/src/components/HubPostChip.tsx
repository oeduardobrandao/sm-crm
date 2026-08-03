import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, GitBranch } from 'lucide-react';
import { fetchPosts } from '../api';
import { CLIENT_STATUS_LABELS, TIPO_LABELS } from '../lib/postView';

interface Props {
  postId: number;
  titulo: string | null;
  /** e.g. ' · correção' — rendered after the title inside the chip. */
  suffix?: string;
  base: string;
  token: string;
}

const OPEN_DELAY_MS = 200;
/** Rough max height of the open card (thumbnail + body); used to decide the flip. */
const CARD_ESTIMATE_PX = 240;

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

/** Linked-post chip with a hover preview fed entirely from the already-cached
 * hub-posts payload (thumbnail, tipo/status, fluxo). No extra endpoint. */
export function HubPostChip({ postId, titulo, suffix, base, token }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
    enabled: open,
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

  const post = open ? data?.posts.find((p) => p.id === postId) : undefined;
  const first = post?.media?.[0];
  const thumb = first ? (first.thumbnail_url ?? (first.kind === 'image' ? first.url : null)) : null;

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
        to={`${base}/postagens/${postId}`}
        className="flex w-fit items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold hub-txt"
        style={{ background: 'var(--hub-soft)', boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
      >
        <FileText size={13} className="shrink-0" style={{ color: 'var(--hub-tx3)' }} />
        <span>
          {titulo ?? 'Ver post'}
          {suffix ?? ''}
        </span>
        <ArrowUpRight size={11} className="shrink-0" style={{ color: 'var(--hub-tx3)' }} />
      </Link>
      {open && post && (
        <div
          role="tooltip"
          data-testid="hub-post-hover-preview"
          className={`absolute left-0 z-50 w-64 overflow-hidden rounded-xl hub-bg-card text-left ${
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.18), inset 0 0 0 1px var(--hub-bd)' }}
        >
          {thumb && <img src={thumb} alt="" className="h-32 w-full object-cover" loading="lazy" />}
          <div className="flex flex-col gap-1.5 p-3">
            <div className="text-sm font-semibold hub-txt">{post.titulo}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold hub-tx2"
                style={{ boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
              >
                {TIPO_LABELS[post.tipo] ?? post.tipo}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold hub-tx2"
                style={{ boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
              >
                {CLIENT_STATUS_LABELS[post.status] ?? post.status}
              </span>
            </div>
            {post.workflow_titulo && (
              <div className="flex items-center gap-1.5 text-xs hub-tx3">
                <GitBranch size={12} className="shrink-0" />
                <span className="truncate">{post.workflow_titulo}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
