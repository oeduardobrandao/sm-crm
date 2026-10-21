import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePreventStrayFileDrop } from '../usePreventStrayFileDrop';

// jsdom não tem DragEvent: Event com um dataTransfer de mentira basta para o
// listener, que só lê types e dropEffect.
function dispatchDrag(type: 'dragover' | 'drop', types: string[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types, dropEffect: 'copy' };
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  document.body.dispatchEvent(ev);
  return { ev, dataTransfer };
}

describe('usePreventStrayFileDrop', () => {
  it('cancela drop e dragover de arquivo fora de qualquer área', () => {
    renderHook(() => usePreventStrayFileDrop());
    expect(dispatchDrag('drop', ['Files']).ev.defaultPrevented).toBe(true);
    const over = dispatchDrag('dragover', ['Files']);
    expect(over.ev.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
  });

  it('não mexe em arrasto sem arquivo (texto do TipTap)', () => {
    renderHook(() => usePreventStrayFileDrop());
    expect(dispatchDrag('drop', ['text/plain', 'text/html']).ev.defaultPrevented).toBe(false);
    expect(dispatchDrag('dragover', ['text/plain']).ev.defaultPrevented).toBe(false);
  });

  it('dragover já aceito por uma área mantém o dropEffect dela', () => {
    renderHook(() => usePreventStrayFileDrop());
    const zone = (e: Event) => e.preventDefault();
    document.body.addEventListener('dragover', zone);
    try {
      const over = dispatchDrag('dragover', ['Files']);
      expect(over.ev.defaultPrevented).toBe(true);
      expect(over.dataTransfer.dropEffect).toBe('copy');
    } finally {
      document.body.removeEventListener('dragover', zone);
    }
  });

  it('remove os listeners ao desmontar', () => {
    const { unmount } = renderHook(() => usePreventStrayFileDrop());
    unmount();
    expect(dispatchDrag('drop', ['Files']).ev.defaultPrevented).toBe(false);
  });
});
