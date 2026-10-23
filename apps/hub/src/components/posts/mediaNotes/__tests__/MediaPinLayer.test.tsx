import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaPinLayer } from '../MediaPinLayer';
import type { HubMediaNote } from '../../../../types';

function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
  return {
    id: 1,
    post_id: 10,
    media_kind: 'image',
    link_id: 100,
    slide_index: 0,
    is_previous_version: false,
    t_seconds: null,
    x: 0.5,
    y: 0.5,
    author: 'client',
    author_name: null,
    body: 'Trocar a cor',
    status: 'open',
    resolved_at: null,
    created_at: '2026-10-23T00:00:00Z',
    replies: [],
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof MediaPinLayer>> = {}) {
  const onPlace = vi.fn();
  const utils = render(
    <MediaPinLayer
      notes={[]}
      naturalWidth={1080}
      naturalHeight={1350}
      placing
      pending={null}
      onPlace={onPlace}
      {...props}
    />,
  );
  return { onPlace, ...utils };
}

// jsdom has no PointerEvent: a MouseEvent named like one carries clientX/clientY through.
function pointer(el: Element, type: string, [x, y]: [number, number]) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

function tap(el: Element, from: [number, number], to: [number, number] = from) {
  pointer(el, 'pointerdown', from);
  pointer(el, 'pointerup', to);
}

describe('MediaPinLayer', () => {
  beforeEach(() => {
    // 400x400 box; a 1080x1350 image contained in it is 320 wide, centred (left 40).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('tap places a pin at relative coords', () => {
    const { onPlace } = setup();
    tap(screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' }), [200, 200]);
    expect(onPlace).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
  });

  it('tap in the letterbox places nothing', () => {
    const { onPlace } = setup();
    tap(screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' }), [10, 200]);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('drag beyond 8px places nothing', () => {
    const { onPlace } = setup();
    tap(
      screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' }),
      [200, 200],
      [230, 204],
    );
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('does not stop the pointer events, so the carousel can still swipe', () => {
    setup();
    const parentDown = vi.fn();
    const button = screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' });
    button.parentElement!.parentElement!.addEventListener('pointerdown', parentDown);
    pointer(button, 'pointerdown', [200, 200]);
    expect(parentDown).toHaveBeenCalled();
  });

  it('not placing renders no capture button', () => {
    setup({ placing: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders each spotted note as an image labelled by its body', () => {
    setup({
      placing: false,
      notes: [
        note({ id: 1, body: 'Trocar a cor' }),
        note({ id: 2, body: 'Sem ponto', x: null, y: null }),
        note({ id: 3, body: 'Antiga', link_id: null, is_previous_version: true }),
      ],
    });
    expect(screen.getByRole('img', { name: 'Trocar a cor' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Sem ponto' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Antiga' })).toBeNull();
  });

  it('positions a pin within the contained image rect', () => {
    setup({ placing: false, notes: [note({ x: 0, y: 0 })] });
    // rendered rect left = 40 of 400 => 10%, top = 0
    expect(screen.getByRole('img', { name: 'Trocar a cor' }).style.left).toBe('10%');
    expect(screen.getByRole('img', { name: 'Trocar a cor' }).style.top).toBe('0%');
  });

  it('calls onPinClick with the note id', () => {
    const onPinClick = vi.fn();
    setup({ placing: false, notes: [note({ id: 7 })], onPinClick });
    fireEvent.click(screen.getByRole('img', { name: 'Trocar a cor' }));
    expect(onPinClick).toHaveBeenCalledWith(7);
  });

  it('shows the pending marker', () => {
    setup({ pending: { x: 0.5, y: 0.5 } });
    expect(screen.getByTestId('media-pin-pending').textContent).toBe('+');
  });
});
