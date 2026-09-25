import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStuckHeader } from '../useStuckHeader';

let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
const disconnect = vi.fn();
let ioOptions: IntersectionObserverInit | undefined;

function Harness() {
  const { sentinelRef, headerRef, stuck } = useStuckHeader();
  return (
    <>
      <div ref={sentinelRef} />
      <header ref={headerRef} data-testid="h" data-stuck={stuck || undefined} />
    </>
  );
}

describe('useStuckHeader', () => {
  beforeEach(() => {
    ioCallback = null;
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(function (this: unknown, cb: typeof ioCallback, opts?: IntersectionObserverInit) {
        ioCallback = cb;
        ioOptions = opts;
        return { observe: vi.fn(), disconnect };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marca o cabeçalho como descolado quando a sentinela sai da tela, e volta', () => {
    render(<Harness />);
    const h = screen.getByTestId('h');
    expect(h).not.toHaveAttribute('data-stuck');
    act(() => ioCallback!([{ isIntersecting: false }]));
    expect(h).toHaveAttribute('data-stuck', 'true');
    act(() => ioCallback!([{ isIntersecting: true }]));
    expect(h).not.toHaveAttribute('data-stuck');
  });

  it('desconecta o observer no unmount', () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('observa no scroller, com o topo recuado até a linha em que o sticky prende', () => {
    function InScroller() {
      const { sentinelRef, headerRef } = useStuckHeader();
      return (
        <div data-testid="scroller" style={{ overflowY: 'auto', paddingTop: '36px' }}>
          <div ref={sentinelRef} />
          <header ref={headerRef} style={{ top: '-12px' }} />
        </div>
      );
    }
    render(<InScroller />);
    expect(ioOptions?.root).toBe(screen.getByTestId('scroller'));
    expect(ioOptions?.rootMargin).toBe('-24px 0px 0px 0px');
  });
});
