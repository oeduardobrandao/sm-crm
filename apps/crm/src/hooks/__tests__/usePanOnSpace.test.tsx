import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { usePanOnSpace } from '../usePanOnSpace';

function Board({ enabled = true, onCardPointerDown = () => {}, onCardClick = () => {} }) {
  const ref = useRef<HTMLDivElement>(null);
  usePanOnSpace(ref, { enabled });
  return (
    <div>
      <input aria-label="titulo" />
      <div data-testid="board" ref={ref}>
        <button data-testid="card" onPointerDown={onCardPointerDown} onClick={onCardClick}>
          card
        </button>
      </div>
    </div>
  );
}

function pointer(type: string, target: Element, init: Partial<PointerEventInit> = {}) {
  // jsdom has no PointerEvent constructor everywhere; MouseEvent + pointerId is enough here.
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  target.dispatchEvent(ev);
  return ev;
}

function setup(props: Parameters<typeof Board>[0] = {}) {
  const utils = render(<Board {...props} />);
  const board = utils.getByTestId('board');
  const card = utils.getByTestId('card');
  board.setPointerCapture = vi.fn();
  board.releasePointerCapture = vi.fn();
  board.hasPointerCapture = vi.fn(() => true);
  return { ...utils, board, card };
}

function hover(board: Element) {
  pointer('pointerenter', board);
}

function space(
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit = {},
  target: Element | Window = window,
) {
  const ev = new KeyboardEvent(type, {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(ev);
  return ev;
}

afterEach(() => cleanup());

describe('usePanOnSpace', () => {
  it('arms on Space while hovering and prevents the default', () => {
    const { board } = setup();
    hover(board);
    const ev = space('keydown');
    expect(ev.defaultPrevented).toBe(true);
    expect(board.getAttribute('data-panning')).toBe('ready');
    space('keyup');
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('does not arm when the pointer is not over the board', () => {
    const { board } = setup();
    const ev = space('keydown');
    expect(ev.defaultPrevented).toBe(false);
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('ignores Space while typing in a field', () => {
    const { board, getByLabelText } = setup();
    hover(board);
    const input = getByLabelText('titulo');
    input.focus();
    const ev = space('keydown', {}, input);
    expect(ev.defaultPrevented).toBe(false);
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('ignores key repeats and modifiers', () => {
    const { board } = setup();
    hover(board);
    space('keydown', { repeat: true });
    space('keydown', { metaKey: true });
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('does nothing when disabled', () => {
    const { board } = setup({ enabled: false });
    hover(board);
    space('keydown');
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('pans scrollLeft and keeps the pointerdown from reaching the card', () => {
    const onCardPointerDown = vi.fn();
    const onCardClick = vi.fn();
    const { board, card } = setup({ onCardPointerDown, onCardClick });
    board.scrollLeft = 200;
    hover(board);
    space('keydown');

    const down = pointer('pointerdown', card, { clientX: 500 });
    expect(down.defaultPrevented).toBe(true);
    expect(onCardPointerDown).not.toHaveBeenCalled();
    expect(board.setPointerCapture).toHaveBeenCalledWith(1);
    expect(board.getAttribute('data-panning')).toBe('dragging');

    pointer('pointermove', board, { clientX: 380 });
    expect(board.scrollLeft).toBe(320);
    pointer('pointermove', board, { clientX: 560 });
    expect(board.scrollLeft).toBe(140);

    pointer('pointerup', board, { clientX: 560 });
    fireEvent.click(card);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(board.getAttribute('data-panning')).toBe('ready');

    pointer('pointermove', board, { clientX: 0 });
    expect(board.scrollLeft).toBe(140);
  });

  it('lets the pointerdown through when Space is not held', () => {
    const onCardPointerDown = vi.fn();
    const { board, card } = setup({ onCardPointerDown });
    hover(board);
    pointer('pointerdown', card, { clientX: 500 });
    expect(onCardPointerDown).toHaveBeenCalled();
  });

  it('does not arm while a mouse button is already down (dnd drag in progress)', () => {
    const { board, card } = setup();
    hover(board);
    pointer('pointerdown', card);
    space('keydown');
    expect(board.hasAttribute('data-panning')).toBe(false);
  });

  it('releases on window blur', () => {
    const { board, card } = setup();
    hover(board);
    space('keydown');
    pointer('pointerdown', card, { clientX: 10 });
    window.dispatchEvent(new Event('blur'));
    expect(board.hasAttribute('data-panning')).toBe(false);
    expect(board.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
