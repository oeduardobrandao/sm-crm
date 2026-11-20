import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast } from 'sonner';
import { useTouchSafeToaster } from '../toast/touchSafeToaster';

function WithHook() {
  useTouchSafeToaster();
  return <Toaster />;
}

function pointer(type: string, pointerType: string, target: Element) {
  // jsdom has no PointerEvent; sonner and the hook only read pointerType.
  const e = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

/** What iOS dispatches for one tap on `el`, after the previous tap landed on body. */
function tap(el: Element, pointerType = 'touch') {
  pointer('pointerdown', pointerType, el);
  pointer('pointerup', pointerType, el);
  document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: el }));
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const toastEl = () => document.querySelector('[data-sonner-toast]');

async function showToast() {
  act(() => {
    toast.error('Erro ao baixar arquivo');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  const el = toastEl();
  expect(el).not.toBeNull();
  return el!;
}

async function waitPastDuration() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // sonner captures the pointer on pointerdown; jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  vi.useRealTimers();
});

describe('useTouchSafeToaster', () => {
  it('lets a tapped toast close on its own', async () => {
    render(<WithHook />);
    tap(await showToast());

    await waitPastDuration();

    expect(toastEl()).toBeNull();
  });

  it('still pauses a toast under a real mouse', async () => {
    render(<WithHook />);
    tap(await showToast(), 'mouse');

    await waitPastDuration();

    expect(toastEl()).not.toBeNull();
  });

  it('is what keeps the toast from freezing: without it the same tap pauses it', async () => {
    render(<Toaster />);
    tap(await showToast());

    await waitPastDuration();

    expect(toastEl()).not.toBeNull();
  });
});
