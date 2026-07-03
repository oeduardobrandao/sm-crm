import { describe, expect, it } from 'vitest';
import {
  clampPatchToAvailableFonts,
  layerToTiptapDoc,
  tiptapDocToLayerPatch,
  type TiptapDoc,
} from '../lib/runsMapping';
import { makeTextLayer } from './fixtures';
import type { NormalizedTextLayer } from '../types';

function makeDoc(content: TiptapDoc['content'][number]['content']): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

describe('layerToTiptapDoc', () => {
  it('maps plain text with no marks', () => {
    const layer = makeTextLayer({ text: 'hello world' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello world' }],
        },
      ],
    });
  });

  it('maps an empty plain-text layer to a paragraph with no content', () => {
    const layer = makeTextLayer({ text: '' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([]);
  });

  it('splits a literal "\\n" in plain text into hardBreak nodes', () => {
    const layer = makeTextLayer({ text: 'line one\nline two' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'line one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'line two' },
    ]);
  });

  it('splits multiple consecutive newlines into multiple hardBreaks with empty text between', () => {
    const layer = makeTextLayer({ text: 'a\n\nb' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: '' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('maps a bold run (font_weight strictly greater than layer base) to a bold mark', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [{ text: 'bold text', font_weight: 700 }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'bold text', marks: [{ type: 'bold' }] },
    ]);
  });

  it('does NOT map bold when run.font_weight equals the layer base weight', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 700,
      runs: [{ text: 'same weight', font_weight: 700 }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([{ type: 'text', text: 'same weight' }]);
  });

  it('does NOT map bold when run.font_weight is lower than the layer base weight', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 700,
      runs: [{ text: 'lighter text', font_weight: 400 }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([{ type: 'text', text: 'lighter text' }]);
  });

  it('maps italic run to an italic mark regardless of layer base font_style', () => {
    const layer = makeTextLayer({
      text: undefined,
      runs: [{ text: 'italic text', font_style: 'italic' }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'italic text', marks: [{ type: 'italic' }] },
    ]);
  });

  it('maps run.color to a textStyle/color mark', () => {
    const layer = makeTextLayer({
      text: undefined,
      runs: [{ text: 'red text', color: '#ff0000' }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      {
        type: 'text',
        text: 'red text',
        marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }],
      },
    ]);
  });

  it('maps run.highlight.color to a highlight mark, dropping padding_x/radius (documented lossy edge)', () => {
    const layer = makeTextLayer({
      text: undefined,
      runs: [{ text: 'highlighted', highlight: { color: '#ffff00', padding_x: 4, radius: 2 } }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      {
        type: 'text',
        text: 'highlighted',
        marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }],
      },
    ]);
  });

  it('combines bold + italic + color + highlight marks on a single run', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [
        {
          text: 'combo',
          font_weight: 800,
          font_style: 'italic',
          color: '#00ff00',
          highlight: { color: '#0000ff' },
        },
      ],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      {
        type: 'text',
        text: 'combo',
        marks: [
          { type: 'bold' },
          { type: 'italic' },
          { type: 'textStyle', attrs: { color: '#00ff00' } },
          { type: 'highlight', attrs: { color: '#0000ff' } },
        ],
      },
    ]);
  });

  it('splits an embedded "\\n" inside a single run into hardBreak nodes, marks applied to each segment', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [{ text: 'line one\nline two', font_weight: 700 }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'line one', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'line two', marks: [{ type: 'bold' }] },
    ]);
  });

  it('maps multiple runs in sequence, each producing its own node(s)', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [{ text: 'plain ' }, { text: 'bold', font_weight: 700 }, { text: ' plain again' }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' plain again' },
    ]);
  });
});

describe('tiptapDocToLayerPatch', () => {
  it('returns { text: "" } for a fully empty paragraph', () => {
    const doc = makeDoc([]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: '' });
  });

  it('returns { text: "" } for a paragraph with no content key at all', () => {
    const doc: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: '' });
  });

  it('returns { text } for unmarked plain text (no runs array)', () => {
    const doc = makeDoc([{ type: 'text', text: 'hello world' }]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: 'hello world' });
  });

  it('flattens hardBreak nodes in unmarked text back to literal "\\n"', () => {
    const doc = makeDoc([
      { type: 'text', text: 'line one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'line two' },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: 'line one\nline two' });
  });

  it('flattens multiple adjacent unmarked text nodes into one text string (no runs)', () => {
    // TipTap sometimes splits unstyled text into multiple text nodes for reasons unrelated to
    // styling -- since none of them carry marks, this must still produce a plain `text` patch.
    const doc = makeDoc([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: 'hello world' });
  });

  it('returns a single run for a fully-bold paragraph', () => {
    const doc = makeDoc([{ type: 'text', text: 'bold text', marks: [{ type: 'bold' }] }]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'bold text', font_weight: 700 }],
    });
  });

  it('returns a single run with italic mapped to font_style', () => {
    const doc = makeDoc([{ type: 'text', text: 'italic text', marks: [{ type: 'italic' }] }]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'italic text', font_style: 'italic' }],
    });
  });

  it('returns a single run with color mapped from a textStyle mark', () => {
    const doc = makeDoc([
      {
        type: 'text',
        text: 'red text',
        marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }],
      },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'red text', color: '#ff0000' }],
    });
  });

  it('returns a single run with highlight color mapped (padding_x/radius NOT reconstructed)', () => {
    const doc = makeDoc([
      {
        type: 'text',
        text: 'highlighted',
        marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }],
      },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'highlighted', highlight: { color: '#ffff00' } }],
    });
  });

  it('combines bold + italic + color + highlight into one run', () => {
    const doc = makeDoc([
      {
        type: 'text',
        text: 'combo',
        marks: [
          { type: 'bold' },
          { type: 'italic' },
          { type: 'textStyle', attrs: { color: '#00ff00' } },
          { type: 'highlight', attrs: { color: '#0000ff' } },
        ],
      },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [
        {
          text: 'combo',
          font_weight: 700,
          font_style: 'italic',
          color: '#00ff00',
          highlight: { color: '#0000ff' },
        },
      ],
    });
  });

  it('coalesces adjacent text nodes that share the exact same mark set into one run', () => {
    const doc = makeDoc([
      { type: 'text', text: 'hello ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'hello world', font_weight: 700 }],
    });
  });

  it('coalesces regardless of mark array ordering (order-independent mark-set comparison)', () => {
    const doc = makeDoc([
      {
        type: 'text',
        text: 'a',
        marks: [{ type: 'bold' }, { type: 'italic' }],
      },
      {
        type: 'text',
        text: 'b',
        marks: [{ type: 'italic' }, { type: 'bold' }],
      },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'ab', font_weight: 700, font_style: 'italic' }],
    });
  });

  it('does NOT coalesce adjacent text nodes with different mark sets into one run', () => {
    const doc = makeDoc([
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [
        { text: 'bold', font_weight: 700 },
        { text: 'italic', font_style: 'italic' },
      ],
    });
  });

  it('splits a marked paragraph with an unmarked segment into separate runs (mixed styling => runs, not text)', () => {
    const doc = makeDoc([
      { type: 'text', text: 'plain ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'plain ' }, { text: 'bold', font_weight: 700 }],
    });
  });

  it('keeps a hardBreak inside a styled run as an embedded "\\n" in that run\'s text (no new run)', () => {
    const doc = makeDoc([
      { type: 'text', text: 'line one', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'line two', marks: [{ type: 'bold' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'line one\nline two', font_weight: 700 }],
    });
  });

  it('a hardBreak between differently-styled runs still lands in the first (currently open) run', () => {
    const doc = makeDoc([
      { type: 'text', text: 'bold line', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'italic line', marks: [{ type: 'italic' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [
        { text: 'bold line\n', font_weight: 700 },
        { text: 'italic line', font_style: 'italic' },
      ],
    });
  });

  it('a leading hardBreak (paragraph starts with Shift+Enter) opens an unmarked run', () => {
    const doc = makeDoc([
      { type: 'hardBreak' },
      { type: 'text', text: 'after break', marks: [{ type: 'bold' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: '\n' }, { text: 'after break', font_weight: 700 }],
    });
  });

  it('drops zero-length text nodes rather than emitting an invalid empty-text run', () => {
    const doc = makeDoc([
      { type: 'text', text: '', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'kept', marks: [{ type: 'italic' }] },
    ]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({
      runs: [{ text: 'kept', font_style: 'italic' }],
    });
  });

  it('falls back to { text: "" } when every run ends up empty after filtering', () => {
    const doc = makeDoc([{ type: 'text', text: '', marks: [{ type: 'bold' }] }]);
    expect(tiptapDocToLayerPatch(doc)).toEqual({ text: '' });
  });
});

describe('round-trip fidelity', () => {
  it('plain text round-trips exactly, including embedded newlines', () => {
    const layer = makeTextLayer({ text: 'first line\nsecond line' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({ text: 'first line\nsecond line' });
  });

  it('a single bold+color run round-trips to an equivalent run', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [{ text: 'styled', font_weight: 700, color: '#123456' }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({
      runs: [{ text: 'styled', font_weight: 700, color: '#123456' }],
    });
  });

  it('multiple distinctly-styled runs round-trip to the same run boundaries', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [
        { text: 'plain ' },
        { text: 'bold italic', font_weight: 700, font_style: 'italic' },
        { text: ' plain again' },
      ],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({
      runs: [
        { text: 'plain ' },
        { text: 'bold italic', font_weight: 700, font_style: 'italic' },
        { text: ' plain again' },
      ],
    });
  });

  it('a run with an embedded newline round-trips with the newline preserved inside the run', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 400,
      runs: [{ text: 'top\nbottom', color: '#abcdef' }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({ runs: [{ text: 'top\nbottom', color: '#abcdef' }] });
  });

  it('an empty text layer round-trips to { text: "" }', () => {
    const layer = makeTextLayer({ text: '' }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({ text: '' });
  });

  it('a run explicitly lighter than the layer base weight round-trips WITHOUT bold (documented lossy edge)', () => {
    const layer = makeTextLayer({
      text: undefined,
      font_weight: 700,
      runs: [{ text: 'lighter', font_weight: 400 }],
    }) as NormalizedTextLayer;
    const doc = layerToTiptapDoc(layer);
    // No mark was applied going in, so this run is indistinguishable from plain text once inside
    // the editor -- it comes back as `{ text }`, not `{ runs }` with the original font_weight:400.
    const patch = tiptapDocToLayerPatch(doc);
    expect(patch).toEqual({ text: 'lighter' });
  });
});

describe('clampPatchToAvailableFonts', () => {
  const layer = makeTextLayer({ font_key: 'bebas-neue', font_weight: 400 }) as NormalizedTextLayer;
  // bebas-neue ships ONLY 400/normal in the real manifest — this fixture's `hasVariant` mirrors
  // that exactly, so this test proves the clamp against a real, not hypothetical, gap.
  const onlyBase400Normal = (weight: number, style: 'normal' | 'italic') =>
    weight === 400 && style === 'normal';

  it('passes a { text } patch through unchanged (nothing to clamp)', () => {
    const patch = clampPatchToAvailableFonts({ text: 'hello' }, layer, onlyBase400Normal);
    expect(patch).toEqual({ text: 'hello' });
  });

  it('strips a bold run.font_weight override the font does not ship, falling back to inherit-from-layer (undefined)', () => {
    const patch = clampPatchToAvailableFonts(
      { runs: [{ text: 'bold', font_weight: 700 }] },
      layer,
      onlyBase400Normal,
    );
    expect(patch).toEqual({ runs: [{ text: 'bold', font_weight: undefined }] });
  });

  it('strips an italic run.font_style override the font does not ship', () => {
    const patch = clampPatchToAvailableFonts(
      { runs: [{ text: 'italic', font_style: 'italic' }] },
      layer,
      onlyBase400Normal,
    );
    expect(patch).toEqual({ runs: [{ text: 'italic', font_style: undefined }] });
  });

  it('keeps a run.font_weight override the font DOES ship', () => {
    const hasBold = (weight: number, style: 'normal' | 'italic') =>
      (weight === 400 || weight === 700) && style === 'normal';
    const patch = clampPatchToAvailableFonts(
      { runs: [{ text: 'bold', font_weight: 700 }] },
      layer,
      hasBold,
    );
    expect(patch).toEqual({ runs: [{ text: 'bold', font_weight: 700 }] });
  });

  it('leaves an already-unstyled run (same object reference) untouched when nothing needs clamping', () => {
    const run = { text: 'plain' };
    const patch = clampPatchToAvailableFonts({ runs: [run] }, layer, onlyBase400Normal);
    expect(patch.runs?.[0]).toBe(run);
  });

  it('clamps bold and italic independently on the same run when both are unavailable', () => {
    const patch = clampPatchToAvailableFonts(
      { runs: [{ text: 'both', font_weight: 700, font_style: 'italic' }] },
      layer,
      onlyBase400Normal,
    );
    expect(patch).toEqual({
      runs: [{ text: 'both', font_weight: undefined, font_style: undefined }],
    });
  });

  it('preserves color/highlight fields untouched while clamping weight/style', () => {
    const patch = clampPatchToAvailableFonts(
      { runs: [{ text: 'colored', font_weight: 700, color: '#ff0000' }] },
      layer,
      onlyBase400Normal,
    );
    expect(patch).toEqual({
      runs: [{ text: 'colored', font_weight: undefined, color: '#ff0000' }],
    });
  });
});
