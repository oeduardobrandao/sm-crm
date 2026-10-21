import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  ClientApprovalChoiceDialog,
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

  it('client approval choice: three choices with their descriptions, the re-arm note in the message', () => {
    const onApproveInternally = vi.fn();
    const onSendToPortal = vi.fn();
    const onAdvanceWithoutChanges = vi.fn();
    const onCancel = vi.fn();
    render(
      <MemoryRouter>
        <ClientApprovalChoiceDialog
          open
          entityTitle="Campanha X"
          willRearm
          onApproveInternally={onApproveInternally}
          onSendToPortal={onSendToPortal}
          onAdvanceWithoutChanges={onAdvanceWithoutChanges}
          onCancel={onCancel}
        />
      </MemoryRouter>,
    );
    const sheet = screen.getByRole('dialog', {
      name: 'O cliente ainda não aprovou todos os posts',
    });
    expect(sheet).toHaveAccessibleDescription(
      /"Campanha X" está numa etapa que pede a aprovação do cliente\. Escolha como seguir: A próxima etapa também é de aprovação/,
    );
    expect(
      screen.getByRole('button', {
        name: /Enviar para o cliente aprovar.*A etapa não avança\./,
      }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Avançar sem aprovação/ }));
    expect(onAdvanceWithoutChanges).toHaveBeenCalledTimes(1);
    expect(onApproveInternally).not.toHaveBeenCalled();
    expect(onSendToPortal).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('client approval choice: a disabled send shows the reason and the post wording', () => {
    render(
      <MemoryRouter>
        <ClientApprovalChoiceDialog
          open
          entityKind="post"
          entityTitle="Post 1"
          withoutChangesLabel="Concluir sem aprovação"
          sendToPortalDisabledReason="O post já está com o cliente."
          onApproveInternally={vi.fn()}
          onSendToPortal={vi.fn()}
          onAdvanceWithoutChanges={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('dialog', { name: 'O cliente ainda não aprovou este post' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Enviar para o cliente aprovar.*já está com o cliente/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Concluir sem aprovação/ })).toBeEnabled();
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
