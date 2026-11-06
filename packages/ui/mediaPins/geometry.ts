// Shared by the CRM and Hub as '@mesaas/ui/mediaPins/geometry' (standalone-file
// pattern, see packages/ui/index.ts; no '@/' imports).
//
// Pins are stored relative to the RENDERED media (the object-contain rect), not
// to the element box, so a pin lands on the same spot at any display size.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The rect an object-contain image/video actually occupies inside `box`.
 *  Falls back to `box` when the natural size is unknown or zero. */
export function containedRect(box: Box, naturalW: number, naturalH: number): Box {
  if (
    !(naturalW > 0) ||
    !(naturalH > 0) ||
    !Number.isFinite(naturalW) ||
    !Number.isFinite(naturalH)
  )
    return box;
  const scale = Math.min(box.width / naturalW, box.height / naturalH);
  const width = naturalW * scale;
  const height = naturalH * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** Client point -> 0..1 coordinates inside `rendered`; null when outside it. */
export function toRelative(
  clientX: number,
  clientY: number,
  rendered: Box,
): { x: number; y: number } | null {
  if (!(rendered.width > 0) || !(rendered.height > 0)) return null;
  const x = (clientX - rendered.left) / rendered.width;
  const y = (clientY - rendered.top) / rendered.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: round4(x), y: round4(y) };
}

/** Relative pin -> CSS percentages within the full `box` (the positioned parent). */
export function toPercentStyle(
  p: { x: number; y: number },
  box: Box,
  rendered: Box,
): { left: string; top: string } {
  const left = ((rendered.left - box.left + p.x * rendered.width) / box.width) * 100;
  const top = ((rendered.top - box.top + p.y * rendered.height) / box.height) * 100;
  return { left: `${round4(left)}%`, top: `${round4(top)}%` };
}

/** Note id -> 1-based pin number, counted per link (by created_at, then id).
 *  Only current notes (linkOf non-null) that carry a spot (x non-null) get one.
 *  Hub passes `n => n.link_id`, CRM passes `n => n.current_link_id`. */
export function pinNumbers<T extends { id: number; x: number | null; created_at: string }>(
  notes: T[],
  linkOf: (n: T) => number | null,
): Map<number, number> {
  const byLink = new Map<number, T[]>();
  for (const n of notes) {
    const link = linkOf(n);
    if (link == null || n.x == null) continue;
    const list = byLink.get(link);
    if (list) list.push(n);
    else byLink.set(link, [n]);
  }
  const out = new Map<number, number>();
  for (const list of byLink.values()) {
    list.sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      return ta !== tb ? ta - tb : a.id - b.id;
    });
    list.forEach((n, i) => out.set(n.id, i + 1));
  }
  return out;
}

/** 42 -> "0:42", 125.4 -> "2:05". */
export function formatMoment(t: number): string {
  const total = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function isNearMoment(t: number, now: number, windowSeconds = 1): boolean {
  return Math.abs(now - t) <= windowSeconds;
}
