import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScrollableTabs } from '../ScrollableTabs';

/**
 * jsdom has no layout engine, so scrollWidth/clientWidth are always 0 and the
 * strip would never look overflowing. Fake the metrics, then fire a scroll
 * event to make the component re-measure.
 */
function fakeMetrics(el: HTMLElement, metrics: { scrollLeft: number; clientWidth: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: metrics.clientWidth, configurable: true });
  // Writable: the component moves the strip by assigning scrollLeft, and jsdom
  // ignores those assignments on its own (no layout).
  Object.defineProperty(el, 'scrollLeft', {
    value: metrics.scrollLeft,
    writable: true,
    configurable: true,
  });
  fireEvent.scroll(el);
}

/** Wait out N animation frames so the component's rAF fallback can run. */
function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : resolve());
    requestAnimationFrame(tick);
  });
}

function renderStrip() {
  render(
    <ScrollableTabs label="Seções do briefing" activeKey={0}>
      <button data-active="true">Fase 1</button>
      <button data-active="false">Fase 2</button>
      <button data-active="false">Fase 3</button>
    </ScrollableTabs>,
  );
  return screen.getByRole('tablist', { name: 'Seções do briefing' });
}

describe('ScrollableTabs', () => {
  it('shows no scroll affordance when the tabs fit', () => {
    const scroller = renderStrip();
    fakeMetrics(scroller, { scrollLeft: 0, clientWidth: 900 });

    expect(screen.queryByLabelText('Ver mais seções')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ver seções anteriores')).not.toBeInTheDocument();
    expect(document.querySelector('.hub-tabs-fade')).toBeNull();
  });

  it('cues the forward direction while there is more to the right', () => {
    const scroller = renderStrip();
    fakeMetrics(scroller, { scrollLeft: 0, clientWidth: 300 });

    expect(screen.getByLabelText('Ver mais seções')).toBeInTheDocument();
    expect(document.querySelector('.hub-tabs-fade-right')).not.toBeNull();
    // Nothing hidden to the left yet.
    expect(screen.queryByLabelText('Ver seções anteriores')).not.toBeInTheDocument();
    expect(document.querySelector('.hub-tabs-fade-left')).toBeNull();
  });

  it('cues the back direction once scrolled to the end', () => {
    const scroller = renderStrip();
    fakeMetrics(scroller, { scrollLeft: 600, clientWidth: 300 });

    expect(screen.getByLabelText('Ver seções anteriores')).toBeInTheDocument();
    expect(document.querySelector('.hub-tabs-fade-left')).not.toBeNull();
    expect(screen.queryByLabelText('Ver mais seções')).not.toBeInTheDocument();
  });

  it('scrolls smoothly by roughly a page when an arrow is clicked', () => {
    const scroller = renderStrip();
    const calls: ScrollToOptions[] = [];
    (scroller as HTMLElement & { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) =>
      void calls.push(o);
    fakeMetrics(scroller, { scrollLeft: 0, clientWidth: 300 });

    fireEvent.click(screen.getByLabelText('Ver mais seções'));

    expect(calls).toEqual([{ left: 225, behavior: 'smooth' }]);
  });

  it('falls back to an instant scroll where smooth scrolling is dropped', async () => {
    const scroller = renderStrip();
    // No scrollTo at all — the harshest version of an engine that ignores it.
    fakeMetrics(scroller, { scrollLeft: 0, clientWidth: 300 });

    fireEvent.click(screen.getByLabelText('Ver mais seções'));
    expect(scroller.scrollLeft).toBe(0); // nothing moved yet

    await act(() => nextFrames(2));
    expect(scroller.scrollLeft).toBe(225);
  });

  it('clamps the fallback scroll to the end of the strip and re-reads the edges', async () => {
    const scroller = renderStrip();
    fakeMetrics(scroller, { scrollLeft: 500, clientWidth: 300 });

    fireEvent.click(screen.getByLabelText('Ver mais seções'));
    await act(() => nextFrames(2));

    // 500 + 225 would overshoot; the strip stops at scrollWidth - clientWidth.
    expect(scroller.scrollLeft).toBe(600);
    // Cues follow without waiting for a `scroll` event.
    expect(screen.queryByLabelText('Ver mais seções')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ver seções anteriores')).toBeInTheDocument();
  });

  it('keeps the arrows out of the tab order so keyboard users reach the tabs', () => {
    const scroller = renderStrip();
    fakeMetrics(scroller, { scrollLeft: 0, clientWidth: 300 });

    expect(screen.getByLabelText('Ver mais seções')).toHaveAttribute('tabindex', '-1');
  });
});
