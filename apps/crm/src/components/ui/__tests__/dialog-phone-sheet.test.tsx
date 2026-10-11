import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import { GroupedList, PickerCell } from '@/components/mobile';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog';

const idx = () => (window.history.state as { idx: number }).idx;

function renderInShell(element: React.ReactNode, isPhone = true) {
  const router = createBrowserRouter([
    { path: '*', element: <PhoneLayoutProvider isPhone={isPhone}>{element}</PhoneLayoutProvider> },
  ]);
  return render(<RouterProvider router={router} />);
}

/** A form dialog with an open button, like most callers. */
function FormDialog({
  dirty = false,
  onOpenChangeSpy,
  refuseClose = false,
  ...contentProps
}: {
  dirty?: boolean;
  onOpenChangeSpy?: (open: boolean) => void;
  refuseClose?: boolean;
} & Partial<React.ComponentProps<typeof DialogContent>>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <button onClick={() => setOpen(true)}>abrir</button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChangeSpy?.(next);
          if (!next && refuseClose) return;
          setOpen(next);
        }}
      >
        <DialogContent
          className="max-w-lg"
          style={{ maxWidth: 600 }}
          confirmClose={dirty}
          onConfirmClose={dirty ? () => setOpen(false) : undefined}
          {...contentProps}
        >
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <input aria-label="Nome" />
          <DialogFooter>
            <button>Salvar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const dialogEl = () => screen.getByRole('dialog');

describe('DialogContent phone sheet', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/clientes');
  });

  it('outside the shell keeps the desktop box', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(dialogEl().className).not.toContain('phone-dialog');
    expect(dialogEl().className).toContain('max-w-lg');
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });

  it('inside the shell on desktop widths keeps the desktop box', () => {
    renderInShell(<FormDialog />, false);
    fireEvent.click(screen.getByText('abrir'));
    expect(dialogEl().className).not.toContain('phone-dialog');
  });

  it('inside the phone shell renders the kit sheet', () => {
    renderInShell(<FormDialog />);
    fireEvent.click(screen.getByText('abrir'));
    const el = dialogEl();
    expect(el.className).toContain('phone-kit');
    expect(el.className).toContain('phone-sheet');
    expect(el.className).toContain('phone-dialog');
    expect(el.getAttribute('data-detent')).toBe('large');
    // Desktop inline widths are dropped; the caller's class stays (CSS outranks it).
    expect(el.getAttribute('style') ?? '').not.toContain('max-width');
    expect(el.querySelector('[data-dialog-scroll]')).toBeTruthy();
    expect(el.querySelector('[data-dialog-footer]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
    // The sheet takes focus, not the first field (no keyboard on open).
    expect(document.activeElement).toBe(el);
  });

  it('phoneDetent="fit" sizes the sheet to its content', () => {
    renderInShell(<FormDialog phoneDetent="fit" />);
    fireEvent.click(screen.getByText('abrir'));
    expect(dialogEl().getAttribute('data-detent')).toBe('fit');
  });

  it('phoneSheet={false} opts out', () => {
    renderInShell(<FormDialog phoneSheet={false} />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    expect(dialogEl().className).not.toContain('phone-dialog');
    expect(idx()).toBe(start);
  });

  it('layout="fullscreen" is left as it is, with no history entry', () => {
    renderInShell(<FormDialog layout="fullscreen" />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    expect(dialogEl().className).not.toContain('phone-dialog');
    expect(dialogEl().className).toContain('h-[100dvh]');
    expect(idx()).toBe(start);
  });

  it('opening pushes an entry; the X pops it', async () => {
    renderInShell(<FormDialog />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    expect(idx()).toBe(start + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(idx()).toBe(start));
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });

  it('Back closes a clean dialog through onOpenChange and stays on the page', async () => {
    const spy = vi.fn();
    renderInShell(<FormDialog onOpenChangeSpy={spy} />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(spy).toHaveBeenLastCalledWith(false);
    expect(idx()).toBe(start);
    expect(window.location.pathname).toBe('/clientes');
  });

  it('Back on a dirty dialog asks first; "Continuar editando" keeps it open with its entry', async () => {
    renderInShell(<FormDialog dirty />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('Fechar sem salvar?')).toBeTruthy());
    expect(screen.getByTestId('state').textContent).toBe('open');
    // The dialog's entry is back, and the confirm stacked its own on top.
    await waitFor(() => expect(idx()).toBe(start + 2));

    fireEvent.click(screen.getByText('Continuar editando'));
    await waitFor(() => expect(idx()).toBe(start + 1));
    expect(screen.queryByText('Fechar sem salvar?')).toBeNull();
    expect(screen.getByTestId('state').textContent).toBe('open');

    // The next Back asks again instead of leaving the page.
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('Fechar sem salvar?')).toBeTruthy());
    expect(window.location.pathname).toBe('/clientes');
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('Back while the confirm is up cancels the confirm only', async () => {
    renderInShell(<FormDialog dirty />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(idx()).toBe(start + 2));
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByText('Fechar sem salvar?')).toBeNull());
    expect(screen.getByTestId('state').textContent).toBe('open');
    expect(idx()).toBe(start + 1);
  });

  it('"Fechar mesmo assim" closes both layers and pops both entries', async () => {
    renderInShell(<FormDialog dirty />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(idx()).toBe(start + 2));
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    await waitFor(() => expect(idx()).toBe(start));
    await new Promise((r) => setTimeout(r, 30));
    expect(idx()).toBe(start);
    expect(window.location.pathname).toBe('/clientes');
  });

  it('a close the parent refuses re-pushes the entry', async () => {
    renderInShell(<FormDialog refuseClose />);
    const start = idx();
    fireEvent.click(screen.getByText('abrir'));
    act(() => window.history.back());
    await waitFor(() => expect(idx()).toBe(start + 1));
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('a dialog closed by unmounting pops its entry', async () => {
    function Conditional() {
      const [editing, setEditing] = useState(false);
      return (
        <>
          <button onClick={() => setEditing(true)}>editar</button>
          {editing && (
            <Dialog open onOpenChange={() => setEditing(false)}>
              <DialogContent>
                <DialogTitle>Editar</DialogTitle>
                <button onClick={() => setEditing(false)}>pronto</button>
              </DialogContent>
            </Dialog>
          )}
        </>
      );
    }
    renderInShell(<Conditional />);
    const start = idx();
    fireEvent.click(screen.getByText('editar'));
    expect(idx()).toBe(start + 1);
    fireEvent.click(screen.getByText('pronto'));
    await waitFor(() => expect(idx()).toBe(start));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the confirm renders after its dialog in the DOM, so it sits on top', async () => {
    renderInShell(<FormDialog dirty />);
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    const confirm = await screen.findByRole('alertdialog');
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confirm.className).toContain('phone-alert');
    // Overlays sit at the content's z-index so the confirm's dims the sheet under it.
    const overlays = document.querySelectorAll('.phone-dialog-overlay');
    expect(overlays).toHaveLength(2);
    expect(
      dialog.compareDocumentPosition(overlays[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('kit sheets opened from a phone dialog', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/clientes');
  });

  it('a PickerSheet layers above the dialog and picking returns to it', async () => {
    function StatusForm() {
      const [status, setStatus] = useState<string | null>('ativo');
      return (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Novo lead</DialogTitle>
            <GroupedList>
              <PickerCell
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'ativo', label: 'Ativo' },
                  { value: 'pausado', label: 'Pausado' },
                ]}
              />
            </GroupedList>
          </DialogContent>
        </Dialog>
      );
    }
    renderInShell(<StatusForm />);
    const start = idx();
    const dialog = screen.getByRole('dialog', { name: 'Novo lead' });
    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    const picker = await screen.findByRole('dialog', { name: 'Status' });
    expect(picker).not.toBe(dialog);
    // Later in the DOM at the same z-index (9011): the picker and its overlay cover the
    // dialog, so the dialog dims under the picker.
    const overlays = [...document.querySelectorAll('.phone-sheet-overlay')];
    const pickerOverlay = overlays[overlays.length - 1];
    expect(
      dialog.compareDocumentPosition(pickerOverlay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      pickerOverlay.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(idx()).toBe(start + 1);

    fireEvent.click(within(picker).getByRole('button', { name: 'Pausado' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Novo lead' })).toBeTruthy();
    await waitFor(() => expect(idx()).toBe(start));
  });
});

function DeleteConfirm({
  onDelete = vi.fn(),
  ...contentProps
}: { onDelete?: () => void } & Partial<React.ComponentProps<typeof AlertDialogContent>>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span data-testid="alert-state">{open ? 'open' : 'closed'}</span>
      <button onClick={() => setOpen(true)}>excluir</button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent {...contentProps}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

describe('AlertDialogContent phone action sheet', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/clientes');
  });

  it('outside the shell keeps the centered box', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Excluir?</AlertDialogTitle>
          <AlertDialogDescription>Tem certeza?</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const el = screen.getByRole('alertdialog');
    expect(el.className).not.toContain('phone-alert');
    expect(el.className).toContain('max-w-lg');
  });

  it('inside the phone shell renders the action sheet with its markers', () => {
    renderInShell(<DeleteConfirm />);
    fireEvent.click(screen.getByText('excluir'));
    const el = screen.getByRole('alertdialog');
    expect(el.className).toContain('phone-kit');
    expect(el.className).toContain('phone-alert');
    expect(el.querySelector('[data-alert-header]')).toBeTruthy();
    expect(el.querySelector('[data-alert-footer]')).toBeTruthy();
    expect(screen.getByText('Cancelar').hasAttribute('data-alert-cancel')).toBe(true);
    // Radix focuses Cancelar: Enter never confirms the destructive choice by accident.
    expect(document.activeElement).toBe(screen.getByText('Cancelar'));
  });

  it('Back cancels the confirm and stays on the page', async () => {
    const onDelete = vi.fn();
    renderInShell(<DeleteConfirm onDelete={onDelete} />);
    const start = idx();
    fireEvent.click(screen.getByText('excluir'));
    expect(idx()).toBe(start + 1);
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId('alert-state').textContent).toBe('closed'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(idx()).toBe(start);
  });

  it('confirming runs the action and pops the entry', async () => {
    const onDelete = vi.fn();
    renderInShell(<DeleteConfirm onDelete={onDelete} />);
    const start = idx();
    fireEvent.click(screen.getByText('excluir'));
    fireEvent.click(screen.getByText('Excluir'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(idx()).toBe(start));
  });

  it('phoneSheet={false} opts out', () => {
    renderInShell(<DeleteConfirm phoneSheet={false} />);
    const start = idx();
    fireEvent.click(screen.getByText('excluir'));
    expect(screen.getByRole('alertdialog').className).not.toContain('phone-alert');
    expect(idx()).toBe(start);
  });
});
