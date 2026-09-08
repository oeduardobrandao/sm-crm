import { describe, expect, it } from 'vitest';
import { pageWindow } from '../workspaces-pagination';

describe('pageWindow', () => {
  it('lists every page when they fit', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('centers the current page and adds gaps with first/last pinned', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });
  it('clamps out-of-range current pages', () => {
    expect(pageWindow(99, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(0, 3)).toEqual([1, 2, 3]);
  });
});
