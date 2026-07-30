import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const { captureEventMock } = vi.hoisted(() => ({ captureEventMock: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ captureEvent: captureEventMock }));

import { useInstagramActivationEvent } from '../useInstagramActivationEvent';

function wrapper(entry: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
}

/** Runs the hook and reports the resulting query string, so URL cleanup is observable. */
function renderAt(entry: string, clienteId = 7) {
  return renderHook(
    () => {
      useInstagramActivationEvent(clienteId);
      return useLocation().search;
    },
    { wrapper: wrapper(entry) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useInstagramActivationEvent', () => {
  it('fires the milestone when the OAuth callback marker is present, then strips it', () => {
    const { result } = renderAt('/clientes/7?ig_connected=1');

    expect(captureEventMock).toHaveBeenCalledTimes(1);
    expect(captureEventMock).toHaveBeenCalledWith('instagram_connected', { cliente_id: 7 });
    // Stripped, so a refresh cannot count the same activation twice.
    expect(result.current).toBe('');
  });

  it('preserves unrelated query parameters when stripping the marker', () => {
    const { result } = renderAt('/clientes/7?tab=instagram&ig_connected=1');
    expect(result.current).toBe('?tab=instagram');
  });

  it('stays silent on an ordinary visit', () => {
    renderAt('/clientes/7');
    expect(captureEventMock).not.toHaveBeenCalled();
  });

  it('does not fire again when the component re-renders', () => {
    const { rerender } = renderAt('/clientes/7?ig_connected=1');
    rerender();
    rerender();

    expect(captureEventMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an unparseable client id rather than sending NaN', () => {
    renderAt('/clientes/abc?ig_connected=1', NaN);
    expect(captureEventMock).not.toHaveBeenCalled();
  });
});
