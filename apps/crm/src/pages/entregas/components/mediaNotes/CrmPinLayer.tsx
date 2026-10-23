import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  containedRect,
  isNearMoment,
  pinNumbers,
  toPercentStyle,
  toRelative,
  type Box,
} from '@mesaas/ui/mediaPins/geometry';
import type { MediaNote } from '@/store/mediaNotes';
import { authorLabel, type MediaNoteAuthors } from './MediaNoteCard';

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
  /** Names for the author line of a pin's details. */
  authors?: MediaNoteAuthors;
  /** Resolve / reopen from a pin's details. Absent: the details are read-only. */
  onStatus?: (noteIds: number[], status: 'open' | 'resolved') => Promise<void>;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  authors,
  onStatus,
}: CrmPinLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [changing, setChanging] = useState(false);

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
  // Client pins are numbered on their own, exactly as the client sees them in the Hub and
  // on the conversation chip; internal pins have their own sequence.
  const numbers = useMemo(() => {
    const out = new Map<number, number>();
    for (const group of [
      current.filter((n) => n.visibility === 'client'),
      current.filter((n) => n.visibility === 'internal'),
    ]) {
      for (const [id, num] of pinNumbers(group, (n) => n.current_link_id)) out.set(id, num);
    }
    return out;
  }, [current]);

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

  // Escape closes the open details, not the lightbox behind them. A capture listener on
  // window runs before the dialog's own document-level one and can stop it.
  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpenId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openId]);

  const toggleStatus = async (note: MediaNote) => {
    if (!onStatus || changing) return;
    setChanging(true);
    try {
      await onStatus([note.id], note.status === 'resolved' ? 'open' : 'resolved');
      setOpenId(null);
    } catch {
      toast.error('Não foi possível atualizar a nota. Tente novamente.');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div
      ref={ref}
      data-testid="crm-pin-layer"
      className={`absolute inset-0 ${placing ? 'crm-pin-layer--placing cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
      onClick={place}
    >
      {box &&
        rendered &&
        visible.map((n) => {
          const internal = n.visibility === 'internal';
          const resolved = n.status === 'resolved';
          const num = numbers.get(n.id) ?? 1;
          const label = `${internal ? 'Interno' : 'Ponto'} ${num}: ${n.body}`;
          const expanded = openId === n.id;
          return (
            <span
              key={n.id}
              className="crm-pin-anchor"
              style={toPercentStyle({ x: n.x as number, y: n.y as number }, box, rendered)}
            >
              <button
                type="button"
                aria-label={label}
                aria-expanded={expanded}
                data-visibility={n.visibility}
                data-state={resolved ? 'resolved' : 'open'}
                className="crm-pin"
                onClick={(e) => {
                  if (placing) return;
                  e.stopPropagation();
                  setOpenId(expanded ? null : n.id);
                }}
              >
                {num}
              </button>
              {expanded && (
                <div
                  role="group"
                  aria-label="Detalhes da nota"
                  className="crm-pin-details"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="crm-pin-details__meta">
                    <strong>
                      {internal ? 'Interno · ' : ''}
                      {authorLabel(
                        n.author_kind,
                        n.author_user_id,
                        authors ?? { membros: [], workspaceUsers: [] },
                      )}
                    </strong>
                    <span>{formatWhen(n.created_at)}</span>
                    <span>{resolved ? 'Resolvido' : 'Em aberto'}</span>
                  </p>
                  <p className="crm-pin-details__body">{n.body}</p>
                  <div className="crm-pin-details__actions">
                    {onStatus && (
                      <button
                        type="button"
                        disabled={changing}
                        onClick={() => void toggleStatus(n)}
                      >
                        {resolved ? 'Reabrir' : 'Marcar como resolvido'}
                      </button>
                    )}
                    <button type="button" onClick={() => setOpenId(null)}>
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </span>
          );
        })}
      {box && rendered && draft && (
        <span
          aria-hidden="true"
          className="crm-pin-anchor"
          style={toPercentStyle(draft, box, rendered)}
        >
          <span className="crm-pin crm-pin--draft" />
        </span>
      )}
    </div>
  );
}
