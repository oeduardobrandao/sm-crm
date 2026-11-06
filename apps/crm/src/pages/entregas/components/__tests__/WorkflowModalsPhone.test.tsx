import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  ForwardConfirmDialog,
  RecurringWorkflowDialog,
  RevertConfirmDialog,
} from '../WorkflowModals';

// jsdom's matchMedia reports no match: useIsDesktop(768) is false, the phone branch.

function ForwardHarness({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter>
      <ForwardConfirmDialog
        open={open}
        entityTitle="Posts de outubro"
        nextEtapaName="Aprovação"
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
        onCancel={() => {
          setOpen(false);
          onCancel();
        }}
      />
    </MemoryRouter>
  );
}

describe('confirmations on phones (action sheets, same copy)', () => {
  it('Avançar etapa: confirming runs onConfirm only, never onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ForwardHarness onConfirm={onConfirm} onCancel={onCancel} />);
    const sheet = screen.getByRole('dialog', { name: 'Avançar etapa?' });
    expect(sheet).toHaveAccessibleDescription(
      'Isso vai mover "Posts de outubro" para a etapa "Aprovação". Deseja continuar?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Avançar etapa: Cancelar runs onCancel only', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ForwardHarness onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Reverter etapa keeps the desktop copy and the Reverter action', () => {
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <RevertConfirmDialog open entityTitle="Reels" onConfirm={onConfirm} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Reverter etapa?' })).toHaveAccessibleDescription(
      'Isso vai reverter "Reels" para a etapa anterior. Esta ação pode ser refeita arrastando para frente novamente.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('recurring cycle: Não dismisses', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MemoryRouter>
        <RecurringWorkflowDialog open onConfirm={onConfirm} onCancel={onCancel} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
