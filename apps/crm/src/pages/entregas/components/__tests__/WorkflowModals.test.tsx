import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('../PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

vi.mock('../../../../store', () => ({
  getDeadlineInfo: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
}));

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

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div>Spinner {size}</div>,
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  function Dialog({
    open = false,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    return open ? <div>{children}</div> : null;
  }

  function DialogContent({ children }: { children: React.ReactNode }) {
    return <div role="dialog">{children}</div>;
  }

  function DialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  return {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  };
});

vi.mock('@/components/ui/alert-dialog', async () => {
  function AlertDialog({
    open = false,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    return open ? <div>{children}</div> : null;
  }

  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    return <div role="alertdialog">{children}</div>;
  }

  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  function AlertDialogDescription({ children }: { children: React.ReactNode }) {
    return <p>{children}</p>;
  }

  function AlertDialogAction({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    );
  }

  function AlertDialogCancel({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    );
  }

  return {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  };
});

import {
  ClientApprovalChoiceDialog,
  RecurringWorkflowDialog,
  RevertConfirmDialog,
} from '../WorkflowModals';

describe('WorkflowModals', () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('wires the lightweight confirmation dialogs to the provided callbacks', () => {
    const onConfirmRecurring = vi.fn();
    const onCancelRecurring = vi.fn();
    const onConfirmRevert = vi.fn();
    const onCancelRevert = vi.fn();
    const onApproveInternally = vi.fn();
    const onSendToPortal = vi.fn();
    const onCancelApproval = vi.fn();

    render(
      <>
        <RecurringWorkflowDialog
          open={true}
          onConfirm={onConfirmRecurring}
          onCancel={onCancelRecurring}
        />
        <RevertConfirmDialog
          open={true}
          workflowTitle="Fluxo Editorial"
          onConfirm={onConfirmRevert}
          onCancel={onCancelRevert}
        />
        <ClientApprovalChoiceDialog
          open={true}
          workflowTitle="Fluxo Editorial"
          onApproveInternally={onApproveInternally}
          onSendToPortal={onSendToPortal}
          onCancel={onCancelApproval}
        />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Criar novo ciclo' }));
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancelButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    fireEvent.click(cancelButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar internamente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ao portal do cliente' }));

    expect(onConfirmRecurring).toHaveBeenCalled();
    expect(onCancelRevert).toHaveBeenCalled();
    expect(onConfirmRevert).toHaveBeenCalled();
    expect(onCancelApproval).toHaveBeenCalled();
    expect(onApproveInternally).toHaveBeenCalled();
    expect(onSendToPortal).toHaveBeenCalled();
  });
});
