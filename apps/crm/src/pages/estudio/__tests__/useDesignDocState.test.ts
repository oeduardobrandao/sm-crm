import { describe, expect, it } from 'vitest';
import {
  designDocReducer,
  initDesignDocState,
  MAX_UNDO,
  type DesignDocState,
} from '../hooks/useDesignDocState';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

describe('designDocReducer — undo/redo', () => {
  it('pushes exactly one past entry per mutating action', () => {
    const state = initDesignDocState(makeDoc());
    const s1 = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 1 },
    });
    const s2 = designDocReducer(s1, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 2 },
    });
    expect(s2.past).toHaveLength(2);
    expect(s2.past[0]).toBe(state.doc);
    expect(s2.past[1]).toBe(s1.doc);
    expect(s2.doc.pages[0].layers[0]).toMatchObject({ x: 2 });
  });

  it('a no-op mutation (designDocOps returns the same doc) does not push an undo entry', () => {
    const state = initDesignDocState(makeDoc());
    const next = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'missing-layer',
      patch: { x: 1 },
    });
    expect(next).toBe(state);
    expect(next.past).toHaveLength(0);
  });

  it('undo restores the previous doc and moves the current one to future', () => {
    const state = initDesignDocState(makeDoc());
    const mutated = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 1 },
    });
    const undone = designDocReducer(mutated, { type: 'undo' });
    expect(undone.doc).toBe(state.doc);
    expect(undone.past).toHaveLength(0);
    expect(undone.future).toEqual([mutated.doc]);
  });

  it('redo re-applies a future doc', () => {
    const state = initDesignDocState(makeDoc());
    const mutated = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 1 },
    });
    const undone = designDocReducer(mutated, { type: 'undo' });
    const redone = designDocReducer(undone, { type: 'redo' });
    expect(redone.doc).toBe(mutated.doc);
    expect(redone.future).toHaveLength(0);
    expect(redone.past).toEqual([state.doc]);
  });

  it('undo on an empty past is a no-op', () => {
    const state = initDesignDocState(makeDoc());
    const next = designDocReducer(state, { type: 'undo' });
    expect(next).toBe(state);
  });

  it('redo on an empty future is a no-op', () => {
    const state = initDesignDocState(makeDoc());
    const next = designDocReducer(state, { type: 'redo' });
    expect(next).toBe(state);
  });

  it('a fresh mutation after undo clears the redo stack', () => {
    const state = initDesignDocState(makeDoc());
    const mutated = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 1 },
    });
    const undone = designDocReducer(mutated, { type: 'undo' });
    expect(undone.future).toHaveLength(1);
    const newBranch = designDocReducer(undone, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 2 },
    });
    expect(newBranch.future).toHaveLength(0);
  });

  it('past is capped at MAX_UNDO entries, dropping the oldest', () => {
    let state: DesignDocState = initDesignDocState(makeDoc());
    for (let i = 0; i < MAX_UNDO + 10; i++) {
      state = designDocReducer(state, {
        type: 'layer/update',
        pageId: 'page-1',
        layerId: 'layer-1',
        patch: { x: i },
      });
    }
    expect(state.past).toHaveLength(MAX_UNDO);
    // The oldest surviving past entry should NOT be the very first doc (x defaults to 10, since
    // the original doc plus the first 9 mutations were evicted).
    expect(state.past[0].pages[0].layers[0]).toMatchObject({ x: 9 });
  });
});

describe('designDocReducer — selection and active page', () => {
  it('select replaces the selection list', () => {
    const state = initDesignDocState(makeDoc());
    const next = designDocReducer(state, { type: 'select', selection: ['layer-1'] });
    expect(next.selection).toEqual(['layer-1']);
    expect(next.past).toHaveLength(0); // selection changes are never undoable
  });

  it('a mutation drops selected ids that no longer exist afterward', () => {
    const state = { ...initDesignDocState(makeDoc()), selection: ['layer-1'] };
    const next = designDocReducer(state, {
      type: 'layer/remove',
      pageId: 'page-1',
      layerId: 'layer-1',
    });
    expect(next.selection).toEqual([]);
  });

  it('a mutation preserves selected ids that still exist', () => {
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ id: 'a' }), makeTextLayer({ id: 'b' })] })],
    });
    const state = { ...initDesignDocState(doc), selection: ['a', 'b'] };
    const next = designDocReducer(state, { type: 'layer/remove', pageId: 'page-1', layerId: 'a' });
    expect(next.selection).toEqual(['b']);
  });

  it('activePage/set updates the active page id', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })] });
    const state = initDesignDocState(doc);
    const next = designDocReducer(state, { type: 'activePage/set', pageId: 'page-2' });
    expect(next.activePageId).toBe('page-2');
    expect(next.past).toHaveLength(0); // not undoable
  });

  it('removing the active page falls back to the first remaining page', () => {
    const doc = makeDoc({ pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })] });
    const state = { ...initDesignDocState(doc), activePageId: 'page-1' };
    const next = designDocReducer(state, { type: 'page/remove', pageId: 'page-1' });
    expect(next.activePageId).toBe('page-2');
  });
});

describe('designDocReducer — load', () => {
  it('load replaces the doc and resets history, selection, and active page', () => {
    const state = initDesignDocState(makeDoc());
    const mutated = designDocReducer(state, {
      type: 'layer/update',
      pageId: 'page-1',
      layerId: 'layer-1',
      patch: { x: 1 },
    });
    const withSelection = designDocReducer(mutated, { type: 'select', selection: ['layer-1'] });

    const freshDoc = makeDoc({ pages: [makePage({ id: 'server-page' })] });
    const loaded = designDocReducer(withSelection, { type: 'load', doc: freshDoc });

    expect(loaded.doc).toBe(freshDoc);
    expect(loaded.past).toHaveLength(0);
    expect(loaded.future).toHaveLength(0);
    expect(loaded.selection).toEqual([]);
    expect(loaded.activePageId).toBe('server-page');
  });
});
