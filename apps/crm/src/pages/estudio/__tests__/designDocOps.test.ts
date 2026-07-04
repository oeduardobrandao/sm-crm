import { describe, expect, it } from 'vitest';
import * as ops from '../lib/designDocOps';
import { makeDoc, makeImageLayer, makePage, makeTextLayer } from './fixtures';

describe('designDocOps layers', () => {
  it('addLayer inserts at the end by default (top of z-order)', () => {
    const doc = makeDoc();
    const layer = makeTextLayer({ id: 'layer-2', text: 'Segunda' });
    const next = ops.addLayer(doc, 'page-1', layer);
    expect(next.pages[0].layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2']);
    expect(doc.pages[0].layers).toHaveLength(1); // input untouched
  });

  it('addLayer inserts at a specific index', () => {
    const doc = makeDoc();
    const layer = makeTextLayer({ id: 'layer-0', text: 'Primeira' });
    const next = ops.addLayer(doc, 'page-1', layer, 0);
    expect(next.pages[0].layers.map((l) => l.id)).toEqual(['layer-0', 'layer-1']);
  });

  it('addLayer is a no-op (same reference) for an unknown page', () => {
    const doc = makeDoc();
    const next = ops.addLayer(doc, 'missing-page', makeTextLayer({ id: 'layer-2' }));
    expect(next).toBe(doc);
  });

  it('updateLayer shallow-merges a patch', () => {
    const doc = makeDoc();
    const next = ops.updateLayer(doc, 'page-1', 'layer-1', { x: 99, opacity: 0.5 });
    expect(next.pages[0].layers[0]).toMatchObject({ x: 99, opacity: 0.5, text: 'Olá mundo' });
  });

  it('updateLayer is a no-op for a nonexistent layer id', () => {
    const doc = makeDoc();
    const next = ops.updateLayer(doc, 'page-1', 'missing-layer', { x: 99 });
    expect(next).toBe(doc);
  });

  it('updateLayer is a no-op (same reference) for a value-identical patch — no phantom undo step', () => {
    // Regression: a zero-movement click/drag committed {x, y} equal to the layer's current
    // position; the new doc reference made the reducer push an undo entry and clear the redo
    // stack for a change that changed nothing.
    const doc = makeDoc();
    const { x, y } = doc.pages[0].layers[0];
    expect(ops.updateLayer(doc, 'page-1', 'layer-1', { x, y })).toBe(doc);
  });

  it('updateLayer treats a structurally-equal runs patch as a no-op too', () => {
    const runs = [{ text: 'Olá', font_weight: 700 as const }];
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ id: 'layer-1', text: undefined, runs })] })],
    });
    const next = ops.updateLayer(doc, 'page-1', 'layer-1', {
      runs: [{ text: 'Olá', font_weight: 700 }],
    });
    expect(next).toBe(doc);
  });

  it('updateLayer enforces text XOR runs: a { text } patch clears stale runs', () => {
    // Regression: a de-styling TextEditOverlay commit ({ text }) shallow-merged over a layer
    // that still had runs — runs win at render, so the edit visibly reverted.
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            makeTextLayer({ id: 'layer-1', text: undefined, runs: [{ text: 'estilizado' }] }),
          ],
        }),
      ],
    });
    const next = ops.updateLayer(doc, 'page-1', 'layer-1', { text: 'simples' });
    const layer = next.pages[0].layers[0] as { text?: string; runs?: unknown };
    expect(layer.text).toBe('simples');
    expect('runs' in layer).toBe(false);
  });

  it('updateLayer enforces text XOR runs: a { runs } patch clears stale text', () => {
    const doc = makeDoc();
    const next = ops.updateLayer(doc, 'page-1', 'layer-1', { runs: [{ text: 'com estilo' }] });
    const layer = next.pages[0].layers[0] as { text?: string; runs?: unknown };
    expect(layer.runs).toEqual([{ text: 'com estilo' }]);
    expect('text' in layer).toBe(false);
  });

  it('removeLayer removes the matching layer', () => {
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ id: 'a' }), makeTextLayer({ id: 'b' })] })],
    });
    const next = ops.removeLayer(doc, 'page-1', 'a');
    expect(next.pages[0].layers.map((l) => l.id)).toEqual(['b']);
  });

  it('removeLayer is a no-op for a nonexistent layer id', () => {
    const doc = makeDoc();
    const next = ops.removeLayer(doc, 'page-1', 'missing-layer');
    expect(next).toBe(doc);
  });

  it('duplicateLayer clones with a fresh id, inserted directly after the original', () => {
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ id: 'a' }), makeTextLayer({ id: 'b' })] })],
    });
    const next = ops.duplicateLayer(doc, 'page-1', 'a');
    const ids = next.pages[0].layers.map((l) => l.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe('a');
    expect(ids[1]).not.toBe('a');
    expect(ids[1]).not.toBe('b');
    expect(ids[2]).toBe('b');
    expect(next.pages[0].layers[1]).toMatchObject({ text: 'Olá mundo' });
  });

  it('duplicateLayer is a no-op for a nonexistent layer id', () => {
    const doc = makeDoc();
    const next = ops.duplicateLayer(doc, 'page-1', 'missing-layer');
    expect(next).toBe(doc);
  });

  it('reorderLayer moves a layer within its page z-order', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            makeTextLayer({ id: 'a' }),
            makeTextLayer({ id: 'b' }),
            makeTextLayer({ id: 'c' }),
          ],
        }),
      ],
    });
    const next = ops.reorderLayer(doc, 'page-1', 'a', 2);
    expect(next.pages[0].layers.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('reorderLayer is a no-op when the target index is unchanged', () => {
    const doc = makeDoc();
    const next = ops.reorderLayer(doc, 'page-1', 'layer-1', 0);
    expect(next).toBe(doc);
  });

  it('image layers keep fileIds in sync after add/update/remove', () => {
    const doc = makeDoc();
    const withImage = ops.addLayer(doc, 'page-1', {
      ...makeTextLayer({ id: 'img-1' }),
      type: 'image',
      h: 100,
      file_id: 42,
      fit: 'cover',
    } as never);
    expect(withImage.fileIds).toEqual([42]);
    const removed = ops.removeLayer(withImage, 'page-1', 'img-1');
    expect(removed.fileIds).toEqual([]);
  });
});

describe('designDocOps pages', () => {
  it('addPage inserts at the end by default', () => {
    const doc = makeDoc({ format: 'carrossel' });
    const page2 = makePage({ id: 'page-2' });
    const next = ops.addPage(doc, page2);
    expect(next.pages.map((p) => p.id)).toEqual(['page-1', 'page-2']);
  });

  it('addPage on a FEED doc converts it to a carousel (backend tipo-sync makes this a sanctioned conversion)', () => {
    const doc = makeDoc({ format: 'feed' });
    const next = ops.addPage(doc, makePage({ id: 'page-2' }));
    expect(next.format).toBe('carrossel');
    expect(next.pages.map((p) => p.id)).toEqual(['page-1', 'page-2']);
  });

  it('addPage is a no-op for reel_cover (a reel has exactly one cover)', () => {
    const doc = makeDoc({ format: 'reel_cover' });
    const next = ops.addPage(doc, makePage({ id: 'page-2' }));
    expect(next).toBe(doc);
  });

  it('addPage is a no-op once the doc already has 10 pages (design-doc.ts schema cap)', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: Array.from({ length: 10 }, (_, i) => makePage({ id: `page-${i}` })),
    });
    const next = ops.addPage(doc, makePage({ id: 'page-11' }));
    expect(next).toBe(doc);
  });

  it('duplicatePage clones with fresh page and layer ids, inserted right after the source', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [
        makePage({ id: 'page-1' }),
        makePage({ id: 'page-2', layers: [makeTextLayer({ id: 'x' })] }),
      ],
    });
    const next = ops.duplicatePage(doc, 'page-1');
    expect(next.pages.map((p) => p.id)).toEqual(['page-1', expect.any(String), 'page-2']);
    const clone = next.pages[1];
    expect(clone.id).not.toBe('page-1');
    expect(clone.layers[0].id).not.toBe('layer-1');
    expect(clone.layers[0]).toMatchObject({ text: 'Olá mundo' });
  });

  it('duplicatePage is a no-op for a nonexistent page id', () => {
    const doc = makeDoc({ format: 'carrossel' });
    const next = ops.duplicatePage(doc, 'missing-page');
    expect(next).toBe(doc);
  });

  it('duplicatePage on a FEED doc converts it to a carousel, same as addPage', () => {
    const doc = makeDoc({ format: 'feed' });
    const next = ops.duplicatePage(doc, 'page-1');
    expect(next.format).toBe('carrossel');
    expect(next.pages).toHaveLength(2);
  });

  it('duplicatePage is a no-op for reel_cover', () => {
    const doc = makeDoc({ format: 'reel_cover' });
    const next = ops.duplicatePage(doc, 'page-1');
    expect(next).toBe(doc);
  });

  it('removePage removes a page when more than one exists', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })] });
    const next = ops.removePage(doc, 'page-1');
    expect(next.pages.map((p) => p.id)).toEqual(['page-2']);
  });

  it('removePage is a no-op on the last remaining page', () => {
    const doc = makeDoc();
    const next = ops.removePage(doc, 'page-1');
    expect(next).toBe(doc);
  });

  it('removePage is a no-op for a nonexistent page id', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })] });
    const next = ops.removePage(doc, 'missing-page');
    expect(next).toBe(doc);
  });

  it('reorderPages moves a page to a new position', () => {
    const doc = makeDoc({
      pages: [makePage({ id: 'a' }), makePage({ id: 'b' }), makePage({ id: 'c' })],
    });
    const next = ops.reorderPages(doc, 0, 2);
    expect(next.pages.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('reorderPages is a no-op for an out-of-range fromIndex', () => {
    const doc = makeDoc();
    const next = ops.reorderPages(doc, 5, 0);
    expect(next).toBe(doc);
  });

  it('background image fill keeps fileIds in sync after page removal', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [
        makePage({ id: 'page-1' }),
        makePage({
          id: 'page-2',
          background: { type: 'image', file_id: 7, fit: 'cover' },
          layers: [],
        }),
      ],
    });
    expect(ops.addPage(doc, makePage({ id: 'page-3' })).fileIds).toEqual([7]);
    const next = ops.removePage(doc, 'page-2');
    expect(next.fileIds).toEqual([]);
  });
});

describe('designDocOps setPageBackground (T6.4)', () => {
  it('replaces a page background and syncs doc.fileIds for an image fill', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'p1' })] });
    const next = ops.setPageBackground(doc, 'p1', { type: 'image', file_id: 900, fit: 'cover' });
    expect(next).not.toBe(doc);
    expect(next.pages[0].background).toEqual({ type: 'image', file_id: 900, fit: 'cover' });
    expect(next.fileIds).toContain(900);
  });

  it('is a no-op (same reference → no undo entry) when the background is content-identical', () => {
    const doc = makeDoc({
      pages: [makePage({ id: 'p1', background: { type: 'solid', color: '#ffffff' } })],
    });
    expect(ops.setPageBackground(doc, 'p1', { type: 'solid', color: '#ffffff' })).toBe(doc);
  });

  it('returns the doc unchanged for an unknown page id', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'p1' })] });
    expect(ops.setPageBackground(doc, 'nope', { type: 'solid', color: '#000000' })).toBe(doc);
  });

  it('swapping an image background off drops the stale file id', () => {
    const doc = makeDoc({
      pages: [makePage({ id: 'p1', background: { type: 'image', file_id: 5, fit: 'cover' } })],
    });
    const next = ops.setPageBackground(doc, 'p1', { type: 'solid', color: '#000000' });
    expect(next.fileIds).not.toContain(5);
  });
});

describe('instantiateDoc (T7.6 template groundwork)', () => {
  const template = () =>
    makeDoc({
      format: 'carrossel',
      pages: [
        makePage({
          id: 'tpl-page-1',
          background: { type: 'image', file_id: 7, fit: 'cover' },
          layers: [makeTextLayer({ id: 'tpl-a' }), makeImageLayer({ id: 'tpl-b', file_id: 9 })],
        }),
        makePage({ id: 'tpl-page-2', layers: [makeTextLayer({ id: 'tpl-c' })] }),
      ],
    });

  it('re-mints every page id and every layer id', () => {
    const src = template();
    const out = ops.instantiateDoc(src);
    const pageIds = out.pages.map((p) => p.id);
    const layerIds = out.pages.flatMap((p) => p.layers.map((l) => l.id));
    expect(pageIds).not.toContain('tpl-page-1');
    expect(pageIds).not.toContain('tpl-page-2');
    expect(layerIds).not.toContain('tpl-a');
    expect(layerIds).not.toContain('tpl-b');
    expect(layerIds).not.toContain('tpl-c');
    // All fresh ids are unique across the whole doc (schema id-uniqueness rule).
    const all = [...pageIds, ...layerIds];
    expect(new Set(all).size).toBe(all.length);
  });

  it('preserves structure, layer props, and file references (files are shared assets)', () => {
    const src = template();
    const out = ops.instantiateDoc(src);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0].layers).toHaveLength(2);
    expect(out.pages[0].background).toEqual({ type: 'image', file_id: 7, fit: 'cover' });
    expect(out.pages[0].layers[0]).toMatchObject({ type: 'text', name: 'Texto 1' });
    // fileIds stay in sync with the (unchanged) file references.
    expect(new Set(out.fileIds)).toEqual(new Set([7, 9]));
  });

  it('is a pure deep clone — the source doc is never mutated and shares no nested refs', () => {
    const src = template();
    const snapshot = JSON.stringify(src);
    const out = ops.instantiateDoc(src);
    expect(JSON.stringify(src)).toBe(snapshot); // source untouched
    expect(out).not.toBe(src);
    expect(out.pages[0]).not.toBe(src.pages[0]);
    expect(out.pages[0].layers[0]).not.toBe(src.pages[0].layers[0]);
  });
});
