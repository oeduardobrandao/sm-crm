import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSelection } from '../hooks/useSelection';
import { makeTextLayer, makeImageLayer } from './fixtures';
import type { NormalizedTextLayer } from '../types';

const getTextHeight = (_layer: NormalizedTextLayer): number => 50;

describe('useSelection', () => {
  it('selectAtPoint selects the topmost layer hit and calls select([id])', () => {
    const select = vi.fn();
    const layers = [makeTextLayer({ id: 'a', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    let hit;
    act(() => {
      hit = result.current.selectAtPoint({ x: 50, y: 25 });
    });

    expect(hit).toEqual(layers[0]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(['a']);
  });

  it('selectAtPoint calls select([]) (deselect) when nothing is hit', () => {
    const select = vi.fn();
    const layers = [makeTextLayer({ id: 'a', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    let hit;
    act(() => {
      hit = result.current.selectAtPoint({ x: 500, y: 500 });
    });

    expect(hit).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith([]);
  });

  it('clearSelection calls select([]) directly, without a hit test', () => {
    const select = vi.fn();
    const layers = [makeTextLayer({ id: 'a' })];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    act(() => {
      result.current.clearSelection();
    });

    expect(select).toHaveBeenCalledWith([]);
  });

  it('hitTest does not mutate selection', () => {
    const select = vi.fn();
    const layers = [makeTextLayer({ id: 'a', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    const hit = result.current.hitTest({ x: 50, y: 25 });

    expect(hit).toEqual(layers[0]);
    expect(select).not.toHaveBeenCalled();
  });

  it('selects the topmost (last-in-array) layer when two layers overlap', () => {
    const select = vi.fn();
    const layers = [
      makeTextLayer({ id: 'bottom', x: 0, y: 0, w: 100 }),
      makeImageLayer({ id: 'top', x: 0, y: 0, w: 100, h: 100 }),
    ];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    act(() => {
      result.current.selectAtPoint({ x: 50, y: 50 });
    });

    expect(select).toHaveBeenCalledWith(['top']);
  });

  it('skips locked layers during hit-testing', () => {
    const select = vi.fn();
    const layers = [
      makeTextLayer({ id: 'bottom', x: 0, y: 0, w: 100 }),
      makeImageLayer({ id: 'top-locked', x: 0, y: 0, w: 100, h: 100, locked: true }),
    ];
    const { result } = renderHook(() => useSelection({ layers, getTextHeight, select }));

    act(() => {
      result.current.selectAtPoint({ x: 50, y: 50 });
    });

    expect(select).toHaveBeenCalledWith(['bottom']);
  });
});
