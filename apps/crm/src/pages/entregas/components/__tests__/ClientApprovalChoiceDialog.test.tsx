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

function setup() {
  const onApproveInternally = vi.fn();
  const onSendToPortal = vi.fn();
  const onAdvanceWithoutChanges = vi.fn();
  const onCancel = vi.fn();
  render(
    <ClientApprovalChoiceDialog
      open
      workflowTitle="Campanha X"
      onApproveInternally={onApproveInternally}
      onSendToPortal={onSendToPortal}
      onAdvanceWithoutChanges={onAdvanceWithoutChanges}
      onCancel={onCancel}
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
