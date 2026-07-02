import { describe, expect, it } from 'vitest';
import { toDesignValidationError, validateDesignDoc } from '@mesaas/design-doc';
import {
  makeBigIntDoc,
  makeCircularDoc,
  makeContext,
  makeOversizedDoc,
  REJECT_FIXTURES,
  VALID_CARROSSEL_4x5,
  VALID_FEED_1x1,
  VALID_REEL_COVER_9x16,
  VALID_WITH_EDGE_CASES,
} from '../supabase/functions/_shared/design-doc-fixtures';

// Mirrors supabase/functions/__tests__/design-doc-schema_test.ts exactly — same fixtures
// module, same assertions — so the Deno (edge) and Vite (browser/editor) runtimes are proven
// to accept/reject/normalize identical documents. A change that passes one suite but not the
// other is exactly the drift this pair exists to catch.

describe('design-doc schema (vitest / browser runtime)', () => {
  it('valid feed 1:1 doc normalizes cleanly', async () => {
    const result = await validateDesignDoc(VALID_FEED_1x1, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.canvas).toEqual({ width: 1080, height: 1080 });
    expect(result.doc.pages[0].layers[0].id).toBe('headline');
    expect((result.doc.pages[0].layers[0] as { align: string }).align).toBe('left');
    expect((result.doc.pages[0].layers[0] as { line_height: number }).line_height).toBe(1.2);
    expect(result.doc.fileIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('valid carrossel 4:5 doc: runs, pill, gradient overlay, gradient stops sorted', async () => {
    const result = await validateDesignDoc(VALID_CARROSSEL_4x5, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.canvas).toEqual({ width: 1080, height: 1350 });
    expect(result.doc.pages).toHaveLength(2);
    const headline = result.doc.pages[0].layers[1];
    expect(headline.type).toBe('text');
    if (headline.type !== 'text') return;
    expect(headline.runs).toHaveLength(3);
    expect(headline.runs?.[1].font_weight).toBe(600);
    expect(headline.pill).toBeDefined();
    const bg = result.doc.pages[0].background;
    expect(bg.type).toBe('image');
    if (bg.type !== 'image') return;
    expect(bg.file_id).toBe(812);
    expect(bg.overlay?.type).toBe('linear_gradient');
    if (bg.overlay?.type === 'linear_gradient') {
      expect(bg.overlay.stops.map((s) => s.at)).toEqual([0.45, 1]);
    }
    expect(result.doc.fileIds).toEqual([812]);
  });

  it('gradient stops out of order get sorted by `at`', async () => {
    const doc = {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          background: {
            type: 'linear_gradient',
            angle: 0,
            stops: [
              { color: '#000000', at: 1 },
              { color: '#ffffff', at: 0 },
            ],
          },
        },
      ],
    };
    const result = await validateDesignDoc(doc, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bg = result.doc.pages[0].background;
    expect(bg.type).toBe('linear_gradient');
    if (bg.type === 'linear_gradient') {
      expect(bg.stops.map((s) => s.at)).toEqual([0, 1]);
    }
  });

  it('valid reel_cover 9:16 doc', async () => {
    const result = await validateDesignDoc(VALID_REEL_COVER_9x16, makeContext({ postTipo: 'reels' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.canvas).toEqual({ width: 1080, height: 1920 });
    expect(result.doc.fileIds).toEqual([900]);
  });

  it('server mints ids for a doc that omits them', async () => {
    const result = await validateDesignDoc(VALID_REEL_COVER_9x16, makeContext({ postTipo: 'reels' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].id.startsWith('page-')).toBe(true);
    expect(result.doc.pages[0].layers[0].id.startsWith('layer-')).toBe(true);
  });

  it('auto-names an unnamed layer', async () => {
    const result = await validateDesignDoc(VALID_FEED_1x1, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].layers[0].name).toBe('Texto 1');
  });

  it('oversized doc (>256KB) is rejected before any structural parse', async () => {
    const result = await validateDesignDoc(makeOversizedDoc(), makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('doc_too_large');
  });

  it('text layer with both text and runs is rejected (XOR violation)', async () => {
    const doc = {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [{ ...VALID_FEED_1x1.pages[0].layers[0], runs: [{ text: 'x' }] }],
        },
      ],
    };
    const result = await validateDesignDoc(doc, makeContext());
    expect(result.ok).toBe(false);
  });

  it('business-rule issues are aggregated, not fail-fast', async () => {
    const doc = {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [
            { ...VALID_FEED_1x1.pages[0].layers[0], font_key: 'helvetica' },
            { type: 'image', x: 0, y: 0, w: 10, h: 10, file_id: 99999, fit: 'cover' },
          ],
        },
      ],
    };
    const result = await validateDesignDoc(doc, makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('unknown_font');
    expect(codes).toContain('file_not_found');
    expect(result.truncated).toBe(false);
  });

  it('issue list is capped at 20 with truncated:true', async () => {
    const manyBadLayers = Array.from({ length: 25 }, (_, i) => ({
      id: `bad-${i}`,
      type: 'image',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      file_id: 99999 - i,
      fit: 'cover',
    }));
    const doc = { ...VALID_FEED_1x1, pages: [{ ...VALID_FEED_1x1.pages[0], layers: manyBadLayers }] };
    const result = await validateDesignDoc(doc, makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(20);
    expect(result.issueCount).toBe(25);
    expect(result.truncated).toBe(true);
  });

  it('toDesignValidationError builds the §2.4 envelope shape', async () => {
    const result = await validateDesignDoc({ ...VALID_FEED_1x1, extra: true }, makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const envelope = toDesignValidationError(result);
    expect(envelope.error).toBe('design_invalid');
    expect(envelope.doc_version).toBe(1);
    expect(Array.isArray(envelope.issues)).toBe(true);
  });

  it('opacity:0 survives normalization (?? not || for the default)', async () => {
    const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].layers[0].opacity).toBe(0);
  });

  it('coordinates round to 2 decimals', async () => {
    const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0].layers[0].x).toBe(90.13);
    expect(result.doc.pages[0].layers[0].y).toBe(400.99);
  });

  it('italic font_style survives normalization', async () => {
    const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const layer = result.doc.pages[0].layers[0];
    expect(layer.type).toBe('text');
    if (layer.type === 'text') expect(layer.font_style).toBe('italic');
  });

  it('empty_text and layer_off_canvas warnings actually fire', async () => {
    const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('empty_text');
    expect(codes).toContain('layer_off_canvas');
  });

  it('reel_cover format is exempt from post_has_video_media', async () => {
    const result = await validateDesignDoc(
      VALID_REEL_COVER_9x16,
      makeContext({ postTipo: 'reels', postHasVideoMedia: true }),
    );
    expect(result.ok).toBe(true);
  });

  it('circular reference doc returns a clean issue, never an unhandled rejection', async () => {
    const result = await validateDesignDoc(makeCircularDoc(), makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('doc_unserializable');
  });

  it('BigInt-containing doc returns a clean issue, never an unhandled rejection', async () => {
    const result = await validateDesignDoc(makeBigIntDoc(), makeContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('doc_unserializable');
  });

  it.each(REJECT_FIXTURES)('reject fixture: $description', async (fixture) => {
    const result = await validateDesignDoc(fixture.doc, makeContext(fixture.context));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain(fixture.expectedCode);
  });
});
