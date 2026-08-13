import { useState, useEffect, useCallback, useRef } from 'react';
import { crossedDragThreshold } from './dragThreshold';
import type { GridItem, GridProfile, ReorderUpdate } from './types';

export type { GridItem, GridProfile, ReorderUpdate } from './types';

const IG_BLUE = '#0095f6';
const PLACEHOLDER = '#efefef';

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n >= 1_000) return n.toLocaleString('pt-BR');
  return String(n);
}

function formatShortDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const carouselIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="white" aria-hidden="true">
    <path d="M4 6.5C4 5.12 5.12 4 6.5 4h8C15.88 4 17 5.12 17 6.5v8c0 1.38-1.12 2.5-2.5 2.5h-8C5.12 17 4 15.88 4 14.5v-8zm2.5-.5a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5v-8a.5.5 0 00-.5-.5h-8zM19 7.5v10c0 1.38-1.12 2.5-2.5 2.5h-10c-.55 0-1 .45-1 1s.45 1 1 1h10c2.49 0 4.5-2.01 4.5-4.5v-10c0-.55-.45-1-1-1s-1 .45-1 1z" />
  </svg>
);

const reelsIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M3.2 8.8h17.6" />
    <path d="M8.5 3.2 11.1 8.7" />
    <path d="M13.4 3.2 16 8.7" />
    <path d="M10.3 12.4v4.4l3.9-2.2z" fill="white" />
  </svg>
);

const lockIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="white" strokeWidth="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="white" strokeWidth="2" />
  </svg>
);

const GRID_STYLE = `
.igp-tile .igp-date, .igp-tile .igp-lock { opacity: 0; transition: opacity .12s ease; }
.igp-tile.igp-movable:hover { cursor: grab; }
.igp-tile.igp-movable:hover .igp-date { opacity: 1; }
.igp-tile.igp-fixed:hover .igp-lock { opacity: 1; }
.igp-tile.igp-drag .igp-date, .igp-tile.igp-over .igp-date { opacity: 1; }
`;

export interface InstagramGridProps {
  /** Already normalized and sorted newest-first by the caller. */
  items: GridItem[];
  /** Optional IG profile header; omit to render the grid alone. */
  profile?: GridProfile | null;
  onReorder: (updates: ReorderUpdate[]) => Promise<void>;
  /** Fired after a successful save, so the caller can refetch / invalidate. */
  onSaved?: () => void;
  /** Extra className on the root (e.g. to size it inside a drawer). */
  className?: string;
  saveLabel?: string;
  savedLabel?: string;
}

/**
 * Embeddable Instagram-grid preview: an IG-style profile header + 3-column feed
 * where planned ('movable') posts can be dragged to swap publish dates around
 * fixed anchors (already-live posts). Owns the swap semantics, drag/touch, and
 * the Save bar; the caller owns data-fetching and persistence via `onReorder`.
 * Deliberately a light IG mock (white surface, IG-blue accent) regardless of the
 * host app's theme, so the preview matches the real grid.
 */
export function InstagramGrid({
  items,
  profile,
  onReorder,
  onSaved,
  className,
  saveLabel = 'Salvar agendamento',
  savedLabel = 'Agendamento atualizado',
}: InstagramGridProps) {
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const touchRef = useRef<{
    startX: number;
    startY: number;
    idx: number;
    dragging: boolean;
  } | null>(null);
  const initialSchedulesRef = useRef<Map<number, string | null>>(new Map());
  const lastSignatureRef = useRef<string | null>(null);

  // Re-seed from `items` only when their content actually changes — callers pass
  // a fresh array on every render and may background-refetch, and we must not
  // discard an in-progress reorder on an identical refetch.
  useEffect(() => {
    const signature = items
      .map((i) => `${i.id}:${i.scheduledAt ?? ''}:${i.status ?? ''}`)
      .join('|');
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    const map = new Map<number, string | null>();
    items.forEach((i) => {
      if (i.mobility === 'movable' && i.postId !== null) map.set(i.postId, i.scheduledAt);
    });
    initialSchedulesRef.current = map;
    setGridItems(items);
    setHasChanges(false);
    setSaved(false);
    setSaveError(null);
  }, [items]);

  const checkForChanges = useCallback((next: GridItem[]) => {
    const initial = initialSchedulesRef.current;
    const changed = next.some(
      (item) =>
        item.mobility === 'movable' &&
        item.postId !== null &&
        item.scheduledAt !== initial.get(item.postId),
    );
    setHasChanges(changed);
    setSaved(false);
  }, []);

  // Swap two movable posts: they trade grid slots AND publish dates, so fixed
  // anchors stay put while the two posts exchange dates around them.
  const swapItems = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      setGridItems((prev) => {
        const src = prev[from];
        const tgt = prev[to];
        if (!src || !tgt || src.mobility !== 'movable' || tgt.mobility !== 'movable') return prev;
        // A scheduled (agendado) post can only take a still-future slot — mirror the
        // backend rule client-side so the whole save isn't rejected with a 400.
        const isFuture = (d: string | null) => !!d && new Date(d).getTime() > Date.now() + 600_000;
        if (
          (src.status === 'agendado' && !isFuture(tgt.scheduledAt)) ||
          (tgt.status === 'agendado' && !isFuture(src.scheduledAt))
        ) {
          setSaveError('Posts agendados só podem trocar de data com outro post de data futura.');
          return prev;
        }
        const next = [...prev];
        next[from] = { ...tgt, scheduledAt: src.scheduledAt };
        next[to] = { ...src, scheduledAt: tgt.scheduledAt };
        setSaveError(null);
        checkForChanges(next);
        return next;
      });
    },
    [checkForChanges],
  );

  const handleDragStart = useCallback(
    (idx: number) => {
      if (gridItems[idx]?.mobility !== 'movable') return;
      setDragIdx(idx);
    },
    [gridItems],
  );

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback(
    (targetIdx: number) => {
      const from = dragIdx;
      setDragIdx(null);
      setDragOverIdx(null);
      if (from === null) return;
      swapItems(from, targetIdx);
    },
    [dragIdx, swapItems],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent, idx: number) => {
      if (gridItems[idx]?.mobility !== 'movable') return;
      const touch = e.touches[0];
      touchRef.current = { startX: touch.clientX, startY: touch.clientY, idx, dragging: false };
    },
    [gridItems],
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = touchRef.current;
    if (!t) return;
    const touch = e.touches[0];
    const dx = touch.clientX - t.startX;
    const dy = touch.clientY - t.startY;
    if (!t.dragging) {
      // Only claim the gesture as a reorder once it's a deliberate horizontal drag;
      // a vertical gesture stays a scroll and must never swap dates.
      if (!crossedDragThreshold(dx, dy)) return;
      t.dragging = true;
      setDragIdx(t.idx);
    }
    if (e.cancelable) e.preventDefault();
    const cell = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest('[data-grid-idx]');
    setDragOverIdx(cell ? parseInt(cell.getAttribute('data-grid-idx')!, 10) : null);
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const t = touchRef.current;
      if (t?.dragging) {
        const touch = e.changedTouches[0];
        const cell = document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest('[data-grid-idx]');
        if (cell) swapItems(t.idx, parseInt(cell.getAttribute('data-grid-idx')!, 10));
      }
      touchRef.current = null;
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [swapItems],
  );

  async function handleSave() {
    const initial = initialSchedulesRef.current;
    const updates = gridItems
      .filter(
        (i) =>
          i.mobility === 'movable' && i.postId !== null && i.scheduledAt !== initial.get(i.postId),
      )
      .map((i) => ({ post_id: i.postId!, scheduled_at: i.scheduledAt }));
    if (updates.length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      await onReorder(updates);
      const next = new Map(initial);
      updates.forEach((u) => next.set(u.post_id, u.scheduled_at));
      initialSchedulesRef.current = next;
      setHasChanges(false);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setSaveError((e as Error).message || 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  const displayName = profile?.username ?? '';

  return (
    <div
      className={className}
      style={{
        background: '#fff',
        color: '#262626',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <style>{GRID_STYLE}</style>

      {profile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 18px 14px' }}>
          {profile.profilePictureUrl ? (
            <img
              src={profile.profilePictureUrl}
              alt={displayName}
              width={72}
              height={72}
              loading="lazy"
              decoding="async"
              style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: PLACEHOLDER,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontWeight: 500,
                color: '#8e8e8e',
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1 }}>
            {displayName && (
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>{displayName}</div>
            )}
            <div style={{ display: 'flex', gap: 22 }}>
              {[
                { n: profile.mediaCount, label: 'posts' },
                { n: profile.followerCount, label: 'seguidores' },
                { n: profile.followingCount, label: 'seguindo' },
              ].map((s) => (
                <div key={s.label} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{formatCount(s.n)}</span>{' '}
                  <span style={{ color: '#8e8e8e' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1.5px',
          borderTop: '0.5px solid #dbdbdb',
        }}
      >
        {gridItems.map((item, idx) => {
          const movable = item.mobility === 'movable';
          const cls = [
            'igp-tile',
            movable ? 'igp-movable' : 'igp-fixed',
            dragIdx === idx ? 'igp-drag' : '',
            dragOverIdx === idx && dragIdx !== idx && movable ? 'igp-over' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={item.id}
              data-grid-idx={idx}
              draggable={movable}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => {
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              onTouchStart={(e) => handleTouchStart(e, idx)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className={cls}
              style={{
                position: 'relative',
                aspectRatio: '4 / 5',
                overflow: 'hidden',
                background: PLACEHOLDER,
                opacity: dragIdx === idx ? 0.5 : 1,
                outline:
                  dragOverIdx === idx && dragIdx !== idx && movable
                    ? `2px solid ${IG_BLUE}`
                    : 'none',
                outlineOffset: -2,
              }}
            >
              {item.thumbnailUrl ? (
                // Blur-up: the tiny blur shows instantly while the full-res image
                // loads lazily on top of it, so tiles feel fast without looking soft.
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundImage: item.blurDataUrl ? `url(${item.blurDataUrl})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              ) : item.videoUrl ? (
                <video
                  src={item.videoUrl}
                  muted
                  preload="metadata"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  data-grid-placeholder
                  style={{
                    width: '100%',
                    height: '100%',
                    background: PLACEHOLDER,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="3"
                      stroke="#b8b8b8"
                      strokeWidth="1.6"
                    />
                    <circle cx="8.5" cy="8.5" r="1.7" fill="#b8b8b8" />
                    <path
                      d="M21 15.5 16 10.5 5.5 21"
                      stroke="#b8b8b8"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}

              {(item.isCarousel || item.mediaType === 'VIDEO') && (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    filter: 'drop-shadow(0 0 2px rgba(0,0,0,.35))',
                    lineHeight: 0,
                  }}
                >
                  {item.isCarousel ? carouselIcon : reelsIcon}
                </span>
              )}

              {!movable && (
                <span
                  className="igp-lock"
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    filter: 'drop-shadow(0 0 2px rgba(0,0,0,.35))',
                    lineHeight: 0,
                  }}
                >
                  {lockIcon}
                </span>
              )}

              {movable && (
                <span
                  className="igp-date"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '14px 7px 5px',
                    background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '.02em',
                    pointerEvents: 'none',
                  }}
                >
                  {formatShortDate(item.scheduledAt)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {(hasChanges || saved || saveError) && (
        <div
          style={{
            borderTop: '0.5px solid #efefef',
            padding: '12px 14px',
            display: 'grid',
            gap: 8,
          }}
        >
          {saveError && <div style={{ fontSize: 12, color: '#c11574' }}>{saveError}</div>}
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: '100%',
                padding: '9px 0',
                borderRadius: 8,
                border: 'none',
                background: IG_BLUE,
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Salvando…' : saveLabel}
            </button>
          )}
          {saved && !hasChanges && (
            <div style={{ fontSize: 12, color: '#1d9e75', textAlign: 'center', fontWeight: 500 }}>
              {savedLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default InstagramGrid;
