import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { InstagramGrid, type GridItem, type ReorderUpdate } from '@mesaas/ui/InstagramGrid';
import { reorderPostSchedules } from '../api';
import type { HubPost, InstagramFeedProfile, InstagramFeedPost } from '../types';

/** Statuses a client may reschedule from the Hub (mirrors the backend allowlist). */
const RESCHEDULABLE = new Set(['enviado_cliente', 'correcao_cliente', 'aprovado_cliente']);

/** A post is movable when it is reschedulable, or scheduled for a still-future time. */
function isMovable(status: string, scheduledAt: string | null): boolean {
  if (RESCHEDULABLE.has(status)) return true;
  if (status === 'agendado') return !!scheduledAt && new Date(scheduledAt) > new Date();
  return false;
}

interface InstagramGridPreviewProps {
  selectedPosts: HubPost[];
  feedProfile: InstagramFeedProfile;
  livePosts: InstagramFeedPost[];
  token: string;
  onClose: () => void;
  onScheduleUpdated?: () => void;
}

/**
 * Client-facing modal shell around the shared <InstagramGrid/>. Owns the
 * overlay, close button, focus trap, Escape handling and scroll lock; delegates
 * the profile header, feed grid, date-swap reorder and Save bar to the shared
 * core. Normalizes Hub posts + the live IG feed into the grid's GridItem shape.
 */
export function InstagramGridPreview({
  selectedPosts,
  feedProfile,
  livePosts,
  token,
  onClose,
  onScheduleUpdated,
}: InstagramGridPreviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const items = useMemo<GridItem[]>(() => {
    const livePermalinks = new Set(livePosts.map((p) => p.permalink));
    const hubItems: GridItem[] = selectedPosts
      // Dedupe a published Hub post that already appears in the live feed (prefer live).
      .filter(
        (p) =>
          !(
            p.status === 'postado' &&
            p.instagram_permalink &&
            livePermalinks.has(p.instagram_permalink)
          ),
      )
      .map((p) => {
        const firstMedia = p.media?.[0];
        const isVideo = firstMedia?.kind === 'video';
        const movable = isMovable(p.status, p.scheduled_at);
        // Full-res image for photos, poster for videos — never a <video> per tile.
        const img = isVideo
          ? (firstMedia?.thumbnail_url ?? null)
          : (firstMedia?.url ?? firstMedia?.thumbnail_url ?? null);
        return {
          source: 'hub' as const,
          mobility: movable ? ('movable' as const) : ('fixed' as const),
          id: `hub-${p.id}`,
          postId: p.id,
          status: p.status,
          thumbnailUrl: img,
          videoUrl: null,
          blurDataUrl: firstMedia?.blur_data_url ?? null,
          mediaType:
            p.tipo === 'carrossel' || (p.media?.length ?? 0) > 1
              ? 'CAROUSEL_ALBUM'
              : p.tipo === 'reels'
                ? 'VIDEO'
                : 'IMAGE',
          isCarousel: (p.media?.length ?? 0) > 1,
          scheduledAt: p.scheduled_at,
          sortTs: p.published_at ?? p.scheduled_at ?? '',
        };
      });

    const live: GridItem[] = livePosts.map((p) => ({
      source: 'live' as const,
      mobility: 'fixed' as const,
      id: `live-${p.id}`,
      postId: null,
      status: null,
      thumbnailUrl: p.thumbnailUrl,
      videoUrl: null,
      mediaType: p.mediaType,
      isCarousel: p.mediaType === 'CAROUSEL_ALBUM',
      scheduledAt: null,
      sortTs: p.postedAt,
    }));

    return [...hubItems, ...live].sort((a, b) => (b.sortTs ?? '').localeCompare(a.sortTs ?? ''));
  }, [selectedPosts, livePosts]);

  const handleReorder = async (updates: ReorderUpdate[]) => {
    await reorderPostSchedules(token, updates);
  };

  // Mount/unmount only: lock scroll, move focus in, restore focus on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const displayName = feedProfile.username ?? '';

  return createPortal(
    <div
      className="fixed inset-0 z-[9010] bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Pré-visualização do feed de ${displayName || 'Instagram'}`}
        className="bg-white rounded-2xl w-[min(420px,calc(100vw-2rem))] max-h-[92vh] overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-[#262626] text-base transition-colors"
        >
          ✕
        </button>

        <div className="overflow-y-auto flex-1 min-h-0">
          <InstagramGrid
            items={items}
            profile={feedProfile}
            onReorder={handleReorder}
            onSaved={onScheduleUpdated}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
