import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelection } from '../hooks/useSelection';

describe('useSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.count).toBe(0);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.anchor).toBeNull();
  });

  it('toggle adds and removes an id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.anchor).toBe(1);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('toggle sets anchor to last toggled id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(5));
    act(() => result.current.toggle(10));
    expect(result.current.anchor).toBe(10);
  });

  it('toggleRange selects from anchor to target in display order', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

    act(() => result.current.toggle(2));
    act(() => result.current.toggleRange(4, items));

    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(5)).toBe(false);
  });

  it('toggleRange works backward (target before anchor)', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

    act(() => result.current.toggle(4));
    act(() => result.current.toggleRange(2, items));

    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);
  });

  it('toggleRange with no anchor behaves like toggle', () => {
    const { result } = renderHook(() => useSelection());
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

    act(() => result.current.toggleRange(2, items));
    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it('prune removes stale ids and preserves valid ones', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(3));

    act(() => result.current.prune(new Set([1, 3, 5])));

    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(2)).toBe(false);
    expect(result.current.isSelected(3)).toBe(true);
    expect(result.current.count).toBe(2);
  });

  it('prune resets anchor if anchor was pruned', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(5));
    expect(result.current.anchor).toBe(5);

    act(() => result.current.prune(new Set([1, 2, 3])));
    expect(result.current.anchor).toBeNull();
  });

  it('clear resets everything', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.clear());

    expect(result.current.count).toBe(0);
    expect(result.current.anchor).toBeNull();
    expect(result.current.selectedIds.size).toBe(0);
  });
});
