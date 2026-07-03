import { describe, expect, it } from 'vitest';
import * as ops from '../lib/designDocOps';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

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
    const doc = makeDoc();
    const page2 = makePage({ id: 'page-2' });
    const next = ops.addPage(doc, page2);
    expect(next.pages.map((p) => p.id)).toEqual(['page-1', 'page-2']);
  });

  it('duplicatePage clones with fresh page and layer ids, inserted right after the source', () => {
    const doc = makeDoc({
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
    const doc = makeDoc();
    const next = ops.duplicatePage(doc, 'missing-page');
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
