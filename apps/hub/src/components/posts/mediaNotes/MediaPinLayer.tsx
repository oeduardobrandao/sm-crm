import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  containedRect,
  isNearMoment,
  pinNumbers,
  toPercentStyle,
  toRelative,
  type Box,
} from '@mesaas/ui/mediaPins/geometry';
import { DRAG_INTENT_THRESHOLD_PX, crossedDragThreshold } from '../../../lib/carouselGesture';
import type { HubMediaNote } from '../../../types';

interface Props {
  /** The post's notes (all slides is fine): the layer keeps only those on `linkId`, but
   * numbers pins over everything it is given so the numbers match MediaNotesList. */
  notes: HubMediaNote[];
  /** The `HubPostMedia.id` this layer sits on. */
  linkId: number;
  /** Video playhead in seconds. When given, a video pin shows only near its own moment. */
  currentTime?: number;
  naturalWidth: number | null;
  naturalHeight: number | null;
  placing: boolean;
  pending: { x: number; y: number } | null;
  onPlace: (p: { x: number; y: number }) => void;
  onPinClick?: (noteId: number) => void;
  /** Px kept free at the bottom of the capture area, for a video's native controls. */
  controlsInset?: number;
}

const PIN_BASE =
  'absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold leading-none shadow-md';

/**
 * Pins over a media box. It fills its positioned parent, which must be the same box the
 * media is object-contained in. Pin coordinates are relative to the RENDERED media, so the
 * letterbox is excluded from both placing and display.
 */
export function MediaPinLayer({
  notes,
  linkId,
  currentTime,
  naturalWidth,
  naturalHeight,
  placing,
  pending,
  onPlace,
  onPinClick,
  controlsInset = 0,
}: Props) {
  const { t } = useTranslation('hubPosts');
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === r.width && prev.height === r.height
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const numbers = useMemo(() => pinNumbers(notes, (n) => n.link_id), [notes]);
  const pinned = notes.filter(
    (n) =>
      !n.is_previous_version &&
      n.link_id === linkId &&
      n.x !== null &&
      n.y !== null &&
      (n.media_kind !== 'video' ||
        currentTime === undefined ||
        n.t_seconds === null ||
        isNearMoment(n.t_seconds, currentTime)),
  );

  const localBox: Box = { left: 0, top: 0, width: size.width, height: size.height };
  const localRendered = containedRect(localBox, naturalWidth ?? 0, naturalHeight ?? 0);
  const ready = size.width > 0 && size.height > 0;

  /** The rendered media rect in client coordinates, measured at event time. */
  function clientRendered(): Box | null {
    const el = rootRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return containedRect(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      naturalWidth ?? 0,
      naturalHeight ?? 0,
    );
  }

  function place(clientX: number, clientY: number) {
    const rendered = clientRendered();
    if (!rendered || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const p = toRelative(clientX, clientY, rendered);
    if (p) onPlace(p);
  }

  return (
    <div
      ref={rootRef}
      data-testid="media-pin-layer"
      className="absolute inset-0 pointer-events-none"
    >
      {ready &&
        pinned.map((n) => {
          const open = n.status === 'open';
          return (
            <span
              key={n.id}
              role="img"
              aria-label={n.body}
              onClick={onPinClick ? () => onPinClick(n.id) : undefined}
              style={toPercentStyle({ x: n.x!, y: n.y! }, localBox, localRendered)}
              className={`${PIN_BASE} ${onPinClick ? 'pointer-events-auto cursor-pointer' : ''} ${
                open
                  ? 'bg-neutral-900 text-white ring-2 ring-white'
                  : 'bg-white/90 text-neutral-700 ring-1 ring-neutral-300'
              }`}
            >
              {numbers.get(n.id)}
            </span>
          );
        })}
      {ready && pending && (
        <span
          data-testid="media-pin-pending"
          aria-hidden="true"
          style={toPercentStyle(pending, localBox, localRendered)}
          className={`${PIN_BASE} bg-white text-neutral-900 ring-2 ring-neutral-900`}
        >
          +
        </span>
      )}
      {placing && (
        <button
          type="button"
          aria-label={t('mediaNotes.tapHint')}
          style={{ bottom: controlsInset }}
          className="pointer-events-auto absolute inset-x-0 top-0 cursor-crosshair bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          // No stopPropagation anywhere: a drag must still reach the carousel's swipe handlers.
          onPointerDown={(e) => {
            // Only the primary pointer's main button: not a right-click, not a pinch's 2nd finger.
            if (e.button !== 0 || e.isPrimary === false) return;
            downAt.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            if (e.button !== 0 || e.isPrimary === false) return;
            const start = downAt.current;
            downAt.current = null;
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (crossedDragThreshold(dx, dy) || Math.hypot(dx, dy) >= DRAG_INTENT_THRESHOLD_PX)
              return;
            place(e.clientX, e.clientY);
          }}
          onPointerCancel={() => {
            downAt.current = null;
          }}
          // Keyboard activation has no coordinates (detail 0): mark the centre of the media.
          onClick={(e) => {
            if (e.detail !== 0) return;
            const rendered = clientRendered();
            if (!rendered) return;
            place(rendered.left + rendered.width / 2, rendered.top + rendered.height / 2);
          }}
        />
      )}
    </div>
  );
}
