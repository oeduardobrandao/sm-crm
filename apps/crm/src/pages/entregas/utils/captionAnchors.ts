import type { CaptionAnchorPatch, CommentThread } from '@/store';

/** A comment anchor on the Instagram caption. Offsets are UTF-16 code-unit indices. */
export interface CaptionAnchor {
  id: number;
  start: number;
  end: number;
  quotedText: string;
  orphaned: boolean;
}

export interface MirrorSegment {
  text: string;
  threadIds: number[];
}

const isHighSurrogate = (c: string | undefined) => !!c && c >= '\uD800' && c <= '\uDBFF';
const isLowSurrogate = (c: string | undefined) => !!c && c >= '\uDC00' && c <= '\uDFFF';

export function anchorsFromThreads(threads: CommentThread[]): CaptionAnchor[] {
  return threads
    .filter((t) => t.field === 'ig_caption')
    .map((t) => ({
      id: t.id,
      start: t.anchor_start ?? 0,
      end: t.anchor_end ?? 0,
      quotedText: t.quoted_text,
      orphaned: t.orphaned || t.anchor_start == null || t.anchor_end == null,
    }));
}

export function patchesFromAnchors(anchors: CaptionAnchor[]): CaptionAnchorPatch[] {
  return anchors.map((a) =>
    a.orphaned
      ? { id: a.id, anchor_start: null, anchor_end: null, orphaned: true }
      : {
          id: a.id,
          anchor_start: a.start,
          anchor_end: a.end,
          orphaned: false,
          quoted_text: a.quotedText,
        },
  );
}

/**
 * Common prefix / suffix diff. The suffix is bounded by what the prefix left over
 * (so "aa" -> "aaa" is an insertion), and both edges are backed off so an edit never
 * splits a surrogate pair.
 */
function diffWindow(oldText: string, newText: string) {
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  if (prefix > 0 && isHighSurrogate(oldText[prefix - 1])) prefix--;

  const maxSuffix = max - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(oldText[oldText.length - suffix])) suffix--;

  return { p: prefix, oldEnd: oldText.length - suffix, newEnd: newText.length - suffix };
}

/**
 * Moves anchors through a single text edit (used on every keystroke).
 * Boundaries match the content editor's mark: an insertion exactly at `start` shifts
 * the range, an insertion exactly at `end` grows it. A range whose whole passage is
 * removed or replaced is orphaned; orphaning is terminal.
 */
export function remapAnchors(
  oldText: string,
  newText: string,
  anchors: CaptionAnchor[],
): CaptionAnchor[] {
  if (oldText === newText) return anchors;
  const { p, oldEnd, newEnd } = diffWindow(oldText, newText);
  const d = newEnd - oldEnd;
  const isInsertion = oldEnd === p;

  return anchors.map((a) => {
    if (a.orphaned) return a;
    let start = a.start;
    let end = a.end;

    if (isInsertion) {
      if (p <= a.start) {
        start += d;
        end += d;
      } else if (p <= a.end) {
        end += d;
      }
    } else if (oldEnd <= a.start) {
      start += d;
      end += d;
    } else if (p < a.end) {
      const left = Math.max(0, p - a.start);
      const right = Math.max(0, a.end - oldEnd);
      if (left === 0 && right === 0) return { ...a, orphaned: true };
      start = left > 0 ? a.start : newEnd;
      end = right > 0 ? a.end + d : p;
      if (end <= start) return { ...a, orphaned: true };
    }
    return { ...a, start, end, quotedText: newText.slice(start, end) };
  });
}

/**
 * For text that arrived without being remapped edit by edit (drawer open, another
 * writer such as MCP `update_post`, an accepted Hub suggestion): keep an anchor whose
 * slice still equals its quote, re-anchor on a unique occurrence of the quote,
 * otherwise orphan it.
 */
export function validateAnchors(text: string, anchors: CaptionAnchor[]): CaptionAnchor[] {
  return anchors.map((a) => {
    if (a.orphaned) return a;
    if (
      a.start >= 0 &&
      a.end > a.start &&
      a.end <= text.length &&
      text.slice(a.start, a.end) === a.quotedText
    ) {
      return a;
    }
    const first = a.quotedText ? text.indexOf(a.quotedText) : -1;
    if (first !== -1 && text.indexOf(a.quotedText, first + 1) === -1) {
      return { ...a, start: first, end: first + a.quotedText.length };
    }
    return { ...a, orphaned: true };
  });
}

/** Splits `text` at every range boundary; each segment lists the threads covering it. */
export function buildMirrorSegments(
  text: string,
  ranges: { id: number; start: number; end: number }[],
): MirrorSegment[] {
  const clamp = (n: number) => Math.min(Math.max(n, 0), text.length);
  const points = new Set<number>([0, text.length]);
  for (const r of ranges) {
    points.add(clamp(r.start));
    points.add(clamp(r.end));
  }
  const sorted = [...points].sort((x, y) => x - y);
  const segments: MirrorSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (to <= from) continue;
    const threadIds = ranges
      .filter((r) => clamp(r.start) <= from && clamp(r.end) >= to)
      .map((r) => r.id);
    segments.push({ text: text.slice(from, to), threadIds });
  }
  return segments;
}

/** `hits` = the thread-id list of every highlight under the pointer. Newest (highest id) wins. */
export function pickThreadId(hits: number[][]): number | null {
  const ids = hits.flat();
  return ids.length ? Math.max(...ids) : null;
}
