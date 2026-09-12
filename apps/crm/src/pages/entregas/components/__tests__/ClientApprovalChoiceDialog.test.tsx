import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ClientApprovalChoiceDialog } from '../WorkflowModals';

function setup(extraProps: { willRearm?: boolean } = {}) {
  const onApproveInternally = vi.fn();
  const onSendToPortal = vi.fn();
  const onAdvanceWithoutChanges = vi.fn();
  const onCancel = vi.fn();
  render(
    <ClientApprovalChoiceDialog
      open
      entityTitle="Campanha X"
      onApproveInternally={onApproveInternally}
      onSendToPortal={onSendToPortal}
      onAdvanceWithoutChanges={onAdvanceWithoutChanges}
      onCancel={onCancel}
      {...extraProps}
    />,
  );
  return { onApproveInternally, onSendToPortal, onAdvanceWithoutChanges, onCancel };
}

describe('ClientApprovalChoiceDialog', () => {
  it('renders the advance-without-changes button', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'Avançar etapa sem alterar posts' }),
    ).toBeInTheDocument();
  });

  it('fires only onAdvanceWithoutChanges when that button is clicked', () => {
    const { onAdvanceWithoutChanges, onApproveInternally, onSendToPortal } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa sem alterar posts' }));
    expect(onAdvanceWithoutChanges).toHaveBeenCalledTimes(1);
    expect(onApproveInternally).not.toHaveBeenCalled();
    expect(onSendToPortal).not.toHaveBeenCalled();
  });
});

describe('ClientApprovalChoiceDialog re-arm note', () => {
  it('shows the next-cycle note when willRearm', () => {
    setup({ willRearm: true });
    expect(screen.getByText(/voltarão para rascunho/i)).toBeInTheDocument();
  });

  it('hides the note when willRearm is false', () => {
    setup({ willRearm: false });
    expect(screen.queryByText(/voltarão para rascunho/i)).not.toBeInTheDocument();
  });

  it('hides the note when willRearm is absent', () => {
    setup();
    expect(screen.queryByText(/voltarão para rascunho/i)).not.toBeInTheDocument();
  });

  it('post individual: cópia no singular e botão do portal desabilitado com o motivo', () => {
    render(
      <ClientApprovalChoiceDialog
        open
        entityTitle="Post X"
        entityKind="post"
        willRearm
        withoutChangesLabel="Avançar etapa sem alterar o post"
        sendToPortalDisabledReason="Só posts aprovados internamente podem ser enviados ao cliente."
        onApproveInternally={vi.fn()}
        onSendToPortal={vi.fn()}
        onAdvanceWithoutChanges={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/o post aprovado voltará para rascunho/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar ao portal do cliente' })).toBeDisabled();
    expect(
      screen.getByText('Só posts aprovados internamente podem ser enviados ao cliente.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Avançar etapa sem alterar o post' }),
    ).toBeInTheDocument();
  });
});
