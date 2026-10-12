import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet, type SheetDetent } from '../src/BottomSheet';
import { useSheetActions } from '../src/sheetActions';
import { installPointerEvent, pointerDown, pointerMove, pointerUp } from './pointer';

beforeAll(installPointerEvent);

function GoRow() {
  const { closeThen } = useSheetActions();
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => closeThen(() => navigate('/configuracao'))}>
      Configurações
    </button>
  );
}

function Harness({
  detents,
  onOpenChange = () => {},
}: {
  detents?: SheetDetent[];
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <>
      <span data-testid="path">{location.pathname}</span>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir filtros
      </button>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange(next);
        }}
        title="Filtros"
        detents={detents}
      >
        <p>Conteúdo</p>
        <GoRow />
      </BottomSheet>
    </>
  );
}

function renderSheet(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <MemoryRouter>
      <Harness {...props} />
    </MemoryRouter>,
  );
}

describe('BottomSheet', () => {
  it('is not in the DOM while closed (no lingering role="dialog")', () => {
    renderSheet();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens as a titled dialog with a close button, and returns focus to the opener', async () => {
    renderSheet();
    const opener = screen.getByRole('button', { name: 'Abrir filtros' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Filtros' });
    expect(dialog).toHaveAttribute('data-detent', 'large');
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes on Escape', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dismisses when the handle is dragged down far enough', async () => {
    const onOpenChange = vi.fn();
    renderSheet({ onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const zone = document.querySelector('.phone-sheet__drag-zone')!;
    pointerDown(zone, { x: 100, y: 100 });
    pointerMove(zone, { x: 100, y: 200 });
    pointerMove(zone, { x: 100, y: 260 });
    pointerMove(zone, { x: 100, y: 260 });
    pointerUp(zone, { x: 100, y: 260 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('springs back after a short, slow drag', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const zone = document.querySelector('.phone-sheet__drag-zone')!;
    const dialog = screen.getByRole('dialog');
    pointerDown(zone, { x: 100, y: 100 });
    pointerMove(zone, { x: 100, y: 130 });
    expect(dialog.style.transform).toBe('translateY(30px)');
    pointerMove(zone, { x: 100, y: 130 });
    pointerUp(zone, { x: 100, y: 130 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(dialog.style.transform).toBe('');
  });

  it('steps between medium and large detents by drag and by the grabber button', () => {
    renderSheet({ detents: ['medium', 'large'] });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-detent', 'medium');

    const zone = document.querySelector('.phone-sheet__drag-zone')!;
    pointerDown(zone, { x: 100, y: 300 });
    pointerMove(zone, { x: 100, y: 200 });
    pointerMove(zone, { x: 100, y: 200 });
    pointerUp(zone, { x: 100, y: 200 });
    expect(dialog).toHaveAttribute('data-detent', 'large');

    // Dragging down from large lands on medium, not closed.
    pointerDown(zone, { x: 100, y: 100 });
    pointerMove(zone, { x: 100, y: 250 });
    pointerMove(zone, { x: 100, y: 250 });
    pointerUp(zone, { x: 100, y: 250 });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'medium');

    fireEvent.click(screen.getByRole('button', { name: 'Expandir' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    expect(screen.getByRole('button', { name: 'Recolher' })).toBeInTheDocument();
  });

  it('closes and navigates through useSheetActions().closeThen', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/configuracao'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('BottomSheet history (browser router)', () => {
  const idx = () => (window.history.state as { idx: number }).idx;

  function renderWithHistory() {
    window.history.replaceState(null, '', '/entregas');
    const router = createBrowserRouter([{ path: '*', element: <Harness /> }]);
    render(<RouterProvider router={router} />);
  }

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('Back closes the sheet and stays on the page', async () => {
    renderWithHistory();
    const start = idx();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    expect(idx()).toBe(start + 1);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(idx()).toBe(start);
    expect(window.location.pathname).toBe('/entregas');
  });

  it('a row that navigates replaces the sheet entry instead of stacking on it', async () => {
    renderWithHistory();
    const start = idx();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    await waitFor(() => expect(window.location.pathname).toBe('/configuracao'));
    // One step forward from where the sheet opened: the sheet's own entry is gone.
    expect(idx()).toBe(start + 1);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/entregas'));
    expect(idx()).toBe(start);
  });
});
