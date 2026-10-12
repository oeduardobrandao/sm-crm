import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { AdminFormSheet } from '../AdminFormSheet';
import { mockPhone } from '../../../__tests__/phone';

function Harness(props: { submitting?: boolean; canClose?: () => boolean; onSubmit?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter>
      <p>{open ? 'aberto' : 'fechado'}</p>
      <AdminFormSheet
        open={open}
        onOpenChange={setOpen}
        title="Editar: Pro"
        formId="plan-form"
        submitting={props.submitting}
        canClose={props.canClose}
      >
        <form
          id="plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit?.();
          }}
        >
          <label>
            Nome <input defaultValue="Pro" />
          </label>
        </form>
      </AdminFormSheet>
    </MemoryRouter>
  );
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('AdminFormSheet (%s)', (_name, phone) => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());
  const setup = () => {
    if (phone) restore = mockPhone();
  };

  it('the header submit submits the page form (one form, no nesting)', () => {
    setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Editar: Pro' });
    expect(dialog.querySelectorAll('form')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Cancelar closes', () => {
    setup();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('fechado')).toBeInTheDocument();
  });

  it('while submitting, Cancelar and Escape do not close', () => {
    setup();
    render(<Harness submitting />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('aberto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/ })).toBeDisabled();
  });

  it('while submitting, canClose is never consulted', () => {
    setup();
    const canClose = vi.fn(() => true);
    render(<Harness submitting canClose={canClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(canClose).not.toHaveBeenCalled();
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });

  it('Escape with canClose returning false keeps it open, and true closes', () => {
    setup();
    const canClose = vi.fn(() => false);
    render(<Harness canClose={canClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(canClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('aberto')).toBeInTheDocument();
    canClose.mockReturnValue(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('fechado')).toBeInTheDocument();
  });

  it('an outside press respects submitting and canClose', async () => {
    setup();
    const canClose = vi.fn(() => false);
    const { rerender } = render(<Harness canClose={canClose} />);
    // Radix registers its outside-press listener on a timer.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const outside = () => {
      const overlay = document.querySelector('.phone-sheet-overlay, .fixed.inset-0');
      fireEvent.pointerDown(overlay ?? document.body);
    };
    outside();
    expect(canClose).toHaveBeenCalled();
    expect(screen.getByText('aberto')).toBeInTheDocument();
    canClose.mockClear();
    rerender(<Harness canClose={canClose} submitting />);
    outside();
    expect(canClose).not.toHaveBeenCalled();
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });

  it('canClose returning false keeps it open', () => {
    setup();
    render(<Harness canClose={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });
});

describe('Back on the phone sheet with a refused close', () => {
  const idx = () => (window.history.state as { idx: number }).idx;
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  /** The controls the test flips while the sheet is open. */
  const ctl: { submitting: boolean; canClose: boolean; rerender: () => void } = {
    submitting: false,
    canClose: true,
    rerender: () => {},
  };

  function BackHarness() {
    const [open, setOpen] = useState(false);
    const [, setTick] = useState(0);
    useEffect(() => {
      ctl.rerender = () => setTick((n) => n + 1);
    }, []);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
        <AdminFormSheet
          open={open}
          onOpenChange={setOpen}
          title="Editar: Pro"
          formId="plan-form"
          submitting={ctl.submitting}
          canClose={() => ctl.canClose}
        >
          <form id="plan-form">
            <input defaultValue="Pro" />
          </form>
        </AdminFormSheet>
      </>
    );
  }

  function setupBrowser() {
    restore = mockPhone();
    ctl.submitting = false;
    ctl.canClose = true;
    // createMemoryRouter never writes window.history, so no entry would be pushed.
    window.history.replaceState(null, '', '/admin/plans');
    const router = createBrowserRouter([{ path: '*', element: <BackHarness /> }]);
    render(<RouterProvider router={router} />);
    const start = idx();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(idx()).toBe(start + 1);
    return { router, start };
  }

  const back = async () => {
    act(() => window.history.back());
    // The pop is async; the refused-close re-push follows it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  };

  it('a save in flight swallows Back, the sheet keeps its entry, and the next Back closes only the sheet', async () => {
    const { router, start } = setupBrowser();
    ctl.submitting = true;
    act(() => ctl.rerender());
    await back();
    expect(screen.getByRole('dialog', { name: 'Editar: Pro' })).toBeInTheDocument();
    expect(idx()).toBe(start + 1);

    ctl.submitting = false;
    act(() => ctl.rerender());
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(idx()).toBe(start);
    expect(router.state.location.pathname).toBe('/admin/plans');
  });

  it('a refused canClose keeps the sheet open and the next Back still closes only the sheet', async () => {
    const { router, start } = setupBrowser();
    ctl.canClose = false;
    await back();
    expect(screen.getByRole('dialog', { name: 'Editar: Pro' })).toBeInTheDocument();
    expect(idx()).toBe(start + 1);

    ctl.canClose = true;
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(idx()).toBe(start);
    expect(router.state.location.pathname).toBe('/admin/plans');
  });
});
