import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SwipeRow, SWIPE_ACTION_WIDTH } from '../SwipeRow';
import { installPointerEvent, pointerDown, pointerMove, pointerUp } from './pointer';

beforeAll(installPointerEvent);

function renderRow() {
  const onOpen = vi.fn();
  const onAdvance = vi.fn();
  const onMore = vi.fn();
  const onPin = vi.fn();
  render(
    <SwipeRow
      leadingActions={[{ label: 'Fixar', onAction: onPin, tone: 'ink' }]}
      trailingActions={[
        { label: 'Mais', onAction: onMore },
        { label: 'Avançar', onAction: onAdvance, tone: 'success' },
      ]}
    >
      <button type="button" onClick={onOpen}>
        Posts de outubro
      </button>
    </SwipeRow>,
  );
  const content = document.querySelector('.phone-swipe-row__content') as HTMLElement;
  const root = document.querySelector('.phone-swipe-row') as HTMLElement;
  return { onOpen, onAdvance, onMore, onPin, content, root };
}

describe('SwipeRow', () => {
  it('opens the trailing actions on a left swipe past half their width and swallows that click', () => {
    const { content, root, onOpen } = renderRow();
    pointerDown(content, { x: 300, y: 20 });
    pointerMove(content, { x: 290, y: 21 });
    pointerMove(content, { x: 200, y: 22 });
    expect(content.style.transform).toBe('translateX(-100px)');
    pointerUp(content, { x: 200, y: 22 });
    expect(root).toHaveAttribute('data-open', 'trailing');
    expect(content.style.transform).toBe(`translateX(${-2 * SWIPE_ACTION_WIDTH}px)`);
    fireEvent.click(screen.getByRole('button', { name: 'Posts de outubro' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('springs back on a short swipe', () => {
    const { content, root } = renderRow();
    pointerDown(content, { x: 300, y: 20 });
    pointerMove(content, { x: 260, y: 20 });
    pointerUp(content, { x: 260, y: 20 });
    expect(root).not.toHaveAttribute('data-open');
    expect(content.style.transform).toBe('');
  });

  it('leaves a vertical move to the page scroll', () => {
    const { content, root, onOpen } = renderRow();
    pointerDown(content, { x: 300, y: 20 });
    pointerMove(content, { x: 296, y: 60 });
    pointerMove(content, { x: 150, y: 90 });
    expect(content.style.transform).toBe('');
    pointerUp(content, { x: 150, y: 90 });
    expect(root).not.toHaveAttribute('data-open');
    fireEvent.click(screen.getByRole('button', { name: 'Posts de outubro' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens the leading actions on a right swipe; a tap on the open row closes it without activating', () => {
    const { content, root, onOpen } = renderRow();
    pointerDown(content, { x: 20, y: 20 });
    pointerMove(content, { x: 40, y: 20 });
    pointerMove(content, { x: 80, y: 20 });
    pointerUp(content, { x: 80, y: 20 });
    expect(root).toHaveAttribute('data-open', 'leading');

    pointerDown(content, { x: 200, y: 20 });
    pointerUp(content, { x: 200, y: 20 });
    fireEvent.click(screen.getByRole('button', { name: 'Posts de outubro' }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(root).not.toHaveAttribute('data-open');
  });

  it('runs an action and closes; tabbing to an action slides its side open', () => {
    const { root, onAdvance } = renderRow();
    const advance = screen.getByRole('button', { name: 'Avançar' });
    fireEvent.focus(advance);
    expect(root).toHaveAttribute('data-open', 'trailing');
    fireEvent.click(advance);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(root).not.toHaveAttribute('data-open');
  });

  it('closes when the user taps outside the row', () => {
    const { content, root } = renderRow();
    pointerDown(content, { x: 300, y: 20 });
    pointerMove(content, { x: 290, y: 20 });
    pointerMove(content, { x: 150, y: 20 });
    pointerUp(content, { x: 150, y: 20 });
    expect(root).toHaveAttribute('data-open', 'trailing');
    fireEvent.pointerDown(document.body);
    expect(root).not.toHaveAttribute('data-open');
  });
});
