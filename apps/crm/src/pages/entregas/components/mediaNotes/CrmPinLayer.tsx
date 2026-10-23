import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  containedRect,
  isNearMoment,
  pinNumbers,
  toPercentStyle,
  toRelative,
  type Box,
} from '@mesaas/ui/mediaPins/geometry';
import type { MediaNote } from '@/store/mediaNotes';

interface CrmPinLayerProps {
  /** Every note of the post: the layer keeps the current ones on `linkId`. */
  notes: MediaNote[];
  linkId: number;
  /** Natural size of the media, to find the letterboxed rendered rect. */
  natural?: { w: number; h: number } | null;
  /** Video playback position; pins with a moment show only near it. Omit for images. */
  currentTime?: number | null;
  /** Placing mode: the layer captures a click and reports it relative to the media. */
  placing?: boolean;
  onPlace?: (point: { x: number; y: number }) => void;
  /** A spot picked but not yet saved (the composer is open). */
  draft?: { x: number; y: number } | null;
}

function readBox(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * The client's (and the team's internal) pins over a media item. Positions are fractions of
 * the RENDERED media, so they land on the same spot the client tapped on any display size.
 * Client pins are ink (dark when open, light when resolved); internal ones are outlined and
 * say "Interno" in their label.
 */
export function CrmPinLayer({
  notes,
  linkId,
  natural,
  currentTime,
  placing = false,
  onPlace,
  draft,
}: CrmPinLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox(readBox(el));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [natural?.w, natural?.h]);

  const current = useMemo(
    () =>
      notes.filter(
        (n) => !n.is_previous_version && n.current_link_id === linkId && n.x != null && n.y != null,
      ),
    [notes, linkId],
  );
  const numbers = useMemo(() => pinNumbers(current, (n) => n.current_link_id), [current]);

  const rendered: Box | null =
    box && box.width > 0 && box.height > 0
      ? natural
        ? containedRect(box, natural.w, natural.h)
        : box
      : null;

  const place = (e: React.MouseEvent) => {
    if (!placing || !onPlace || !ref.current) return;
    const fresh = readBox(ref.current);
    const area = natural ? containedRect(fresh, natural.w, natural.h) : fresh;
    const point = toRelative(e.clientX, e.clientY, area);
    if (point) onPlace(point);
  };

  const visible = current.filter((n) => {
    if (n.media_kind !== 'video' || n.t_seconds == null) return true;
    return currentTime != null && isNearMoment(n.t_seconds, currentTime);
  });

  return (
    <div
      ref={ref}
      data-testid="crm-pin-layer"
      className={`absolute inset-0 ${placing ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
      onClick={place}
    >
      {box &&
        rendered &&
        visible.map((n) => {
          const internal = n.visibility === 'internal';
          const num = numbers.get(n.id) ?? 1;
          const label = `${internal ? 'Interno · ponto' : 'Ponto'} ${num}: ${n.body}`;
          return (
            <span
              key={n.id}
              role="img"
              aria-label={label}
              title={label}
              data-visibility={n.visibility}
              data-state={n.status === 'resolved' ? 'resolved' : 'open'}
              className="crm-pin"
              style={toPercentStyle({ x: n.x as number, y: n.y as number }, box, rendered)}
            >
              {num}
            </span>
          );
        })}
      {box && rendered && draft && (
        <span
          aria-hidden="true"
          className="crm-pin crm-pin--draft"
          style={toPercentStyle(draft, box, rendered)}
        />
      )}
    </div>
  );
}
