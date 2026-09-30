import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingFilterBar } from '../FloatingFilterBar';

type Entry = { isIntersecting: boolean; boundingClientRect: { top: number } };
let ioCallback: ((entries: Entry[]) => void) | null = null;
let ioOptions: IntersectionObserverInit | undefined;

function bar() {
  return screen.getByRole('button', { name: 'Chip' }).parentElement!.parentElement as HTMLElement;
}

describe('FloatingFilterBar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays in flow when IntersectionObserver is missing (jsdom)', () => {
    render(
      <FloatingFilterBar>
        <button type="button">Chip</button>
      </FloatingFilterBar>,
    );
    expect(bar()).not.toHaveAttribute('data-floating');
    expect(bar().style.position).toBe('');
  });

  describe('with IntersectionObserver', () => {
    beforeEach(() => {
      ioCallback = null;
      vi.stubGlobal(
        'IntersectionObserver',
        vi.fn(function (this: unknown, cb: typeof ioCallback, opts?: IntersectionObserverInit) {
          ioCallback = cb;
          ioOptions = opts;
          return { observe: vi.fn(), disconnect: vi.fn() };
        }),
      );
    });

    it('floats fixed once scrolled past, not when the sentinel is below the fold', () => {
      render(
        <FloatingFilterBar>
          <button type="button">Chip</button>
        </FloatingFilterBar>,
      );
      // The test setup's matchMedia matches nothing: the phone offset under HubMobileNav.
      expect(ioOptions?.rootMargin).toBe('-70px 0px 0px 0px');
      act(() => ioCallback!([{ isIntersecting: false, boundingClientRect: { top: 900 } }]));
      expect(bar()).not.toHaveAttribute('data-floating');
      act(() => ioCallback!([{ isIntersecting: false, boundingClientRect: { top: -40 } }]));
      expect(bar()).toHaveAttribute('data-floating');
      expect(bar().style.position).toBe('fixed');
      expect(bar().style.top).toBe('70px');
      act(() => ioCallback!([{ isIntersecting: true, boundingClientRect: { top: 40 } }]));
      expect(bar()).not.toHaveAttribute('data-floating');
    });
  });
});
