import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicateLayerName, useEditorShortcuts } from '../hooks/useEditorShortcuts';
import type { UseEditorShortcutsArgs } from '../hooks/useEditorShortcuts';
import type { DesignDocAction } from '../hooks/useDesignDocState';
import { makePage, makeTextLayer } from './fixtures';

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function setup(overrides: Partial<UseEditorShortcutsArgs> = {}) {
  const dispatch = vi.fn<[DesignDocAction], void>();
  const select = vi.fn<[string[]], void>();
  const undo = vi.fn();
  const redo = vi.fn();
  const args: UseEditorShortcutsArgs = {
    activePage: makePage({ layers: [makeTextLayer({ id: 'layer-1', x: 10, y: 10 })] }),
    activePageId: 'page-1',
    selection: ['layer-1'],
    dispatch,
    select,
    undo,
    redo,
    isTextEditing: false,
    enabled: true,
    ...overrides,
  };
  const view = renderHook((p: UseEditorShortcutsArgs) => useEditorShortcuts(p), {
    initialProps: args,
  });
  return { ...view, dispatch, select, undo, redo, args };
}

describe('duplicateLayerName', () => {
  it('appends " cópia" to a plain name', () => {
    expect(duplicateLayerName('Texto 1')).toBe('Texto 1 cópia');
  });
  it('promotes " cópia" to " cópia 2"', () => {
    expect(duplicateLayerName('Texto 1 cópia')).toBe('Texto 1 cópia 2');
  });
  it('increments an existing numbered copy', () => {
    expect(duplicateLayerName('Texto 1 cópia 3')).toBe('Texto 1 cópia 4');
  });
});

describe('useEditorShortcuts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Delete removes the selected layer', () => {
    const { dispatch } = setup();
    press({ key: 'Delete' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'layer/remove',
      pageId: 'page-1',
      layerId: 'layer-1',
    });
  });

  it('Backspace removes the selected layer', () => {
    const { dispatch } = setup();
    press({ key: 'Backspace' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'layer/remove',
      pageId: 'page-1',
      layerId: 'layer-1',
    });
  });

  it('Delete skips a locked layer', () => {
    const { dispatch } = setup({
      activePage: makePage({ layers: [makeTextLayer({ id: 'layer-1', locked: true })] }),
    });
    press({ key: 'Delete' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ArrowRight nudges the layer by 1px', () => {
    const { dispatch } = setup();
    press({ key: 'ArrowRight' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action).toMatchObject({
      type: 'layer/update',
      layerId: 'layer-1',
      patch: { x: 11, y: 10 },
    });
    expect((action as { coalesceKey?: string }).coalesceKey).toMatch(/^nudge-/);
  });

  it('Shift+ArrowDown nudges by 10px', () => {
    const { dispatch } = setup();
    press({ key: 'ArrowDown', shiftKey: true });
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'layer/update',
      patch: { x: 10, y: 20 },
    });
  });

  it('consecutive nudges share one coalesce key (single undo step)', () => {
    const { dispatch } = setup();
    press({ key: 'ArrowRight' });
    press({ key: 'ArrowRight' });
    const k1 = (dispatch.mock.calls[0][0] as { coalesceKey?: string }).coalesceKey;
    const k2 = (dispatch.mock.calls[1][0] as { coalesceKey?: string }).coalesceKey;
    expect(k1).toBeDefined();
    expect(k1).toBe(k2);
  });

  it('a locked layer does not nudge', () => {
    const { dispatch } = setup({
      activePage: makePage({ layers: [makeTextLayer({ id: 'layer-1', locked: true })] }),
    });
    press({ key: 'ArrowRight' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Cmd+D duplicates the layer with an offset, fresh id, and copy name, then selects it', () => {
    const { dispatch, select } = setup();
    press({ key: 'd', metaKey: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0] as Extract<DesignDocAction, { type: 'layer/add' }>;
    expect(action.type).toBe('layer/add');
    expect(action.layer).toMatchObject({ x: 30, y: 30, name: 'Texto 1 cópia' });
    expect(action.layer.id).not.toBe('layer-1');
    expect(select).toHaveBeenCalledWith([action.layer.id]);
  });

  it('Ctrl+D also duplicates (non-mac modifier)', () => {
    const { dispatch } = setup();
    press({ key: 'd', ctrlKey: true });
    expect(dispatch.mock.calls[0][0].type).toBe('layer/add');
  });

  it('Escape clears the selection', () => {
    const { select } = setup();
    press({ key: 'Escape' });
    expect(select).toHaveBeenCalledWith([]);
  });

  it('Cmd+Z undoes; Shift+Cmd+Z and Ctrl+Y redo', () => {
    const { undo, redo } = setup();
    press({ key: 'z', metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
    press({ key: 'z', metaKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    press({ key: 'y', ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('is inert while the text overlay is editing', () => {
    const { dispatch, select, undo } = setup({ isTextEditing: true });
    press({ key: 'Delete' });
    press({ key: 'ArrowRight' });
    press({ key: 'z', metaKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('is inert while a form field is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const { dispatch } = setup();
    press({ key: 'Delete' });
    expect(dispatch).not.toHaveBeenCalled();
    input.remove();
  });

  it('is inert when disabled', () => {
    const { dispatch, undo } = setup({ enabled: false });
    press({ key: 'Delete' });
    press({ key: 'z', metaKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('does nothing (and yields the key) when the selection is empty', () => {
    const { dispatch, select } = setup({ selection: [] });
    const del = press({ key: 'Delete' });
    const arrow = press({ key: 'ArrowRight' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    // Un-prevented → the browser keeps its default behaviour.
    expect(del.defaultPrevented).toBe(false);
    expect(arrow.defaultPrevented).toBe(false);
  });

  it('undo still fires with an empty selection (doc-level, not layer-level)', () => {
    const { undo } = setup({ selection: [] });
    press({ key: 'z', metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('nudges every selected non-locked layer under one coalesce key', () => {
    const { dispatch } = setup({
      activePage: makePage({
        layers: [
          makeTextLayer({ id: 'layer-1', x: 10, y: 10 }),
          makeTextLayer({ id: 'layer-2', x: 50, y: 60, locked: true }),
          makeTextLayer({ id: 'layer-3', x: 100, y: 100 }),
        ],
      }),
      selection: ['layer-1', 'layer-2', 'layer-3'],
    });
    press({ key: 'ArrowRight' });
    // layer-2 is locked → skipped; layer-1 and layer-3 move.
    expect(dispatch).toHaveBeenCalledTimes(2);
    const [a, b] = dispatch.mock.calls.map(
      (c) => c[0] as { layerId: string; coalesceKey?: string },
    );
    expect(a.layerId).toBe('layer-1');
    expect(b.layerId).toBe('layer-3');
    expect(a.coalesceKey).toBe(b.coalesceKey);
  });
});
