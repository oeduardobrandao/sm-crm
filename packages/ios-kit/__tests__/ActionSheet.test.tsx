import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActionSheet } from '../src/ActionSheet';

function Harness({
  onAdvance,
  onDelete,
  onDismiss,
}: {
  onAdvance: () => void;
  onDelete: () => void;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setOpen(true)}>
        Avançar etapa
      </button>
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        onDismiss={onDismiss}
        title="Concluir Produção?"
        message="O fluxo vai para Aprovação."
        actions={[
          { label: 'Concluir e avançar', onSelect: onAdvance },
          { label: 'Excluir fluxo', onSelect: onDelete, destructive: true },
          { label: 'Indisponível', onSelect: () => {}, disabled: true },
        ]}
      />
    </MemoryRouter>
  );
}

describe('ActionSheet', () => {
  it('shows title, message and actions; focuses the sheet, not the first action', async () => {
    render(<Harness onAdvance={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    const dialog = screen.getByRole('dialog', { name: 'Concluir Produção?' });
    expect(dialog).toHaveAccessibleDescription('O fluxo vai para Aprovação.');
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Excluir fluxo' })).toHaveClass(
      'phone-action-sheet__action--destructive',
    );
    expect(screen.getByRole('button', { name: 'Indisponível' })).toBeDisabled();
  });

  it('runs the chosen action and closes, returning focus to the opener', async () => {
    const onAdvance = vi.fn();
    render(<Harness onAdvance={onAdvance} onDelete={vi.fn()} />);
    const opener = screen.getByRole('button', { name: 'Avançar etapa' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir e avançar' }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('Cancelar closes without running anything', async () => {
    const onAdvance = vi.fn();
    const onDelete = vi.fn();
    render(<Harness onAdvance={onAdvance} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onAdvance).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('onDismiss fires for Cancelar and Escape, never for a chosen action', async () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(<Harness onAdvance={onAdvance} onDelete={vi.fn()} onDismiss={onDismiss} />);
    const opener = screen.getByRole('button', { name: 'Avançar etapa' });

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir e avançar' }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
