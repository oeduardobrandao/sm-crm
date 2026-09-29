import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter, RouterProvider, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayHistoryEntry } from '../useOverlayHistoryEntry';

function Page({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [, setSearchParams] = useSearchParams();
  // Closes and reopens across two commits, before the close's async pop lands (what
  // revealPostProcesses does when the revealed post is already on the board).
  useEffect(() => {
    if (!reopen) return;
    setReopen(false);
    setOpen(true);
  }, [reopen]);
  useOverlayHistoryEntry(open, () => {
    onClosed();
    setOpen(false);
  });
  return (
    <div>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
      <button
        onClick={() => {
          setOpen(false);
          setReopen(true);
        }}
      >
        reopen
      </button>
      <button onClick={() => setSearchParams({ filtro: 'x' }, { replace: true })}>filter</button>
    </div>
  );
}

function renderAt(path: string, onClosed = vi.fn()) {
  window.history.replaceState(null, '', path);
  const router = createBrowserRouter([{ path: '*', element: <Page onClosed={onClosed} /> }]);
  render(<RouterProvider router={router} />);
  return { router, onClosed };
}

const idx = () => (window.history.state as { idx: number }).idx;

describe('useOverlayHistoryEntry', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('abrir empilha uma entrada com a mesma URL', () => {
    renderAt('/entregas?view=kanban');
    const start = idx();
    fireEvent.click(screen.getByText('open'));
    expect(idx()).toBe(start + 1);
    expect(window.location.pathname + window.location.search).toBe('/entregas?view=kanban');
  });

  it('Voltar fecha o overlay e permanece na página', async () => {
    const { onClosed } = renderAt('/entregas');
    const start = idx();
    fireEvent.click(screen.getByText('open'));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(idx()).toBe(start);
    expect(window.location.pathname).toBe('/entregas');
  });

  it('fechar pela UI remove a entrada empilhada', async () => {
    const { onClosed } = renderAt('/entregas');
    const start = idx();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(idx()).toBe(start));
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('replace com o overlay aberto não o fecha, e fechar ainda remove só uma entrada', async () => {
    const { onClosed } = renderAt('/entregas');
    const start = idx();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('filter'));
    expect(screen.getByTestId('state').textContent).toBe('open');
    expect(window.location.search).toBe('?filtro=x');
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(idx()).toBe(start));
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('fechar e reabrir antes do pop chegar mantém o overlay aberto com uma entrada', async () => {
    const { onClosed } = renderAt('/entregas');
    const start = idx();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('reopen'));
    await waitFor(() => expect(idx()).toBe(start + 1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('state').textContent).toBe('open');
    expect(idx()).toBe(start + 1);
    expect(onClosed).not.toHaveBeenCalled();

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(idx()).toBe(start);
  });
});
