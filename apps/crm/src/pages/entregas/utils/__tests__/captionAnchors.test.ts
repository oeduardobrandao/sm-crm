import { describe, expect, it } from 'vitest';
import {
  anchorsFromThreads,
  buildMirrorSegments,
  patchesFromAnchors,
  pickThreadId,
  remapAnchors,
  validateAnchors,
  type CaptionAnchor,
} from '../captionAnchors';

const a = (id: number, start: number, end: number, text: string): CaptionAnchor => ({
  id,
  start,
  end,
  quotedText: text.slice(start, end),
  orphaned: false,
});

describe('remapAnchors', () => {
  const old = 'hello brave new world';
  // "brave" = [6, 11)
  const anchors = [a(1, 6, 11, old)];

  it('returns the same anchors when the text is unchanged', () => {
    expect(remapAnchors(old, old, anchors)).toBe(anchors);
  });

  it('leaves a range untouched for an edit after it', () => {
    const next = old + '!!';
    expect(remapAnchors(old, next, anchors)[0]).toMatchObject({ start: 6, end: 11 });
  });

  it('shifts a range for an insertion before it', () => {
    const next = 'oh hello brave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 9, end: 14, quotedText: 'brave', orphaned: false });
  });

  it('shifts (does not grow) for an insertion exactly at the start', () => {
    const next = 'hello XXbrave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 8, end: 13, quotedText: 'brave' });
  });

  it('grows for an insertion exactly at the end', () => {
    const next = 'hello braveXX new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 13, quotedText: 'braveXX' });
  });

  it('grows for an insertion inside and refreshes quotedText', () => {
    const next = 'hello bra--ve new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 13, quotedText: 'bra--ve' });
  });

  it('shifts left for a deletion before it', () => {
    const next = 'brave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 0, end: 5, quotedText: 'brave' });
  });

  it('clamps when the tail is deleted', () => {
    const next = 'hello bra new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 9, quotedText: 'bra', orphaned: false });
  });

  it('clamps when the head is deleted', () => {
    const next = 'hello ve new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 8, quotedText: 've', orphaned: false });
  });

  it('orphans a range whose whole passage is deleted', () => {
    const next = 'hello  new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r.orphaned).toBe(true);
    expect(r.quotedText).toBe('brave');
  });

  it('orphans a range whose whole passage is replaced', () => {
    const next = 'hello NICE new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r.orphaned).toBe(true);
  });

  it('never revives an orphaned anchor', () => {
    const orphan: CaptionAnchor = { ...anchors[0], orphaned: true };
    expect(remapAnchors(old, 'hello brave new world!', [orphan])[0].orphaned).toBe(true);
  });

  it('treats "aa" -> "aaa" as an insertion, not a delete', () => {
    const [r] = remapAnchors('aa', 'aaa', [a(1, 0, 2, 'aa')]);
    expect(r.orphaned).toBe(false);
    expect(r).toMatchObject({ start: 0, end: 3 });
  });

  it('does not split a surrogate pair when one emoji replaces another', () => {
    const before = 'x \u{1F600} y';
    const after = 'x \u{1F603} y';
    const [r] = remapAnchors(before, after, [a(1, 2, 4, before)]);
    expect(r.orphaned).toBe(true); // the whole emoji was replaced
    const partial = remapAnchors(before, 'x \u{1F600}\u{1F603} y', [a(1, 2, 4, before)])[0];
    expect(partial.quotedText).toBe(partial.quotedText.normalize()); // no lone surrogate
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(partial.quotedText)).toBe(false);
  });
});

describe('validateAnchors', () => {
  const text = 'hello brave new world';

  it('keeps anchors whose slice still matches', () => {
    const list = [a(1, 6, 11, text)];
    expect(validateAnchors(text, list)).toEqual(list);
  });

  it('re-anchors on a unique match of quotedText', () => {
    const list = [{ ...a(1, 6, 11, text), start: 0, end: 5 }]; // stale offsets
    expect(validateAnchors(text, list)[0]).toMatchObject({ start: 6, end: 11, orphaned: false });
  });

  it('orphans when quotedText is missing', () => {
    const list = [{ ...a(1, 6, 11, text), quotedText: 'gone' }];
    expect(validateAnchors(text, list)[0].orphaned).toBe(true);
  });

  it('orphans when quotedText is ambiguous', () => {
    const t = 'la la land';
    const list = [{ id: 1, start: 0, end: 2, quotedText: 'zz', orphaned: false }];
    expect(validateAnchors(t, list)[0].orphaned).toBe(true);
    const dup = [{ id: 2, start: 3, end: 5, quotedText: 'la', orphaned: false }]; // slice(3,5) = "la"
    expect(validateAnchors(t, dup)[0].orphaned).toBe(false); // slice matches, so kept even though the quote is repeated
    const stale = [{ id: 3, start: 0, end: 3, quotedText: 'la', orphaned: false }]; // slice "la " != "la", "la" occurs 3x
    expect(validateAnchors(t, stale)[0].orphaned).toBe(true);
  });

  it('orphans out-of-range offsets', () => {
    const list = [{ id: 1, start: 50, end: 60, quotedText: 'brave', orphaned: false }];
    expect(validateAnchors(text, list)[0]).toMatchObject({ start: 6, end: 11 });
  });

  it('skips already orphaned anchors', () => {
    const list = [{ id: 1, start: 0, end: 0, quotedText: 'brave', orphaned: true }];
    expect(validateAnchors(text, list)[0].orphaned).toBe(true);
  });
});

describe('anchorsFromThreads / patchesFromAnchors', () => {
  const base = {
    post_id: 1,
    conta_id: 'c',
    status: 'active' as const,
    created_by: 'u',
    resolved_by: null,
    created_at: '',
    resolved_at: null,
  };

  it('keeps only caption threads and maps DB columns', () => {
    const anchors = anchorsFromThreads([
      {
        ...base,
        id: 1,
        quoted_text: 'x',
        field: 'conteudo',
        anchor_start: null,
        anchor_end: null,
        orphaned: false,
      },
      {
        ...base,
        id: 2,
        quoted_text: 'brave',
        field: 'ig_caption',
        anchor_start: 6,
        anchor_end: 11,
        orphaned: false,
      },
      {
        ...base,
        id: 3,
        quoted_text: 'gone',
        field: 'ig_caption',
        anchor_start: null,
        anchor_end: null,
        orphaned: true,
      },
    ]);
    expect(anchors).toEqual([
      { id: 2, start: 6, end: 11, quotedText: 'brave', orphaned: false },
      { id: 3, start: 0, end: 0, quotedText: 'gone', orphaned: true },
    ]);
  });

  it('builds RPC patches; orphans carry null offsets and no quoted_text', () => {
    expect(
      patchesFromAnchors([
        { id: 2, start: 6, end: 11, quotedText: 'brave', orphaned: false },
        { id: 3, start: 0, end: 0, quotedText: 'gone', orphaned: true },
      ]),
    ).toEqual([
      { id: 2, anchor_start: 6, anchor_end: 11, orphaned: false, quoted_text: 'brave' },
      { id: 3, anchor_start: null, anchor_end: null, orphaned: true },
    ]);
  });
});

describe('buildMirrorSegments / pickThreadId', () => {
  it('splits text around ranges', () => {
    expect(buildMirrorSegments('hello world', [{ id: 1, start: 6, end: 11 }])).toEqual([
      { text: 'hello ', threadIds: [] },
      { text: 'world', threadIds: [1] },
    ]);
  });

  it('unions overlapping ranges into per-interval id lists', () => {
    expect(
      buildMirrorSegments('abcdef', [
        { id: 1, start: 0, end: 4 },
        { id: 2, start: 2, end: 6 },
      ]),
    ).toEqual([
      { text: 'ab', threadIds: [1] },
      { text: 'cd', threadIds: [1, 2] },
      { text: 'ef', threadIds: [2] },
    ]);
  });

  it('returns no segments for empty text and clamps out-of-range ends', () => {
    expect(buildMirrorSegments('', [])).toEqual([]);
    expect(buildMirrorSegments('abc', [{ id: 1, start: 1, end: 99 }])).toEqual([
      { text: 'a', threadIds: [] },
      { text: 'bc', threadIds: [1] },
    ]);
  });

  it('picks the most recent (highest id) thread among hits', () => {
    expect(
      pickThreadId([
        [1, 2],
        [2, 5],
      ]),
    ).toBe(5);
    expect(pickThreadId([])).toBeNull();
  });
});
