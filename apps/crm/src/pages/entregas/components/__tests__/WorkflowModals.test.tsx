import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
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
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input ref={ref} {...props} />
  )),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({
    children,
    htmlFor,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
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
      onChange={event => onCheckedChange?.(event.target.checked)}
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

  function AlertDialogAction({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    );
  }

  function AlertDialogCancel({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
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
  addWorkflow,
  addWorkflowEtapa,
  removeWorkflow,
} from '../../../../store';
import {
  ClientApprovalChoiceDialog,
  NewWorkflowModal,
  RecurringWorkflowDialog,
  RevertConfirmDialog,
} from '../WorkflowModals';

const mockedAddWorkflow = vi.mocked(addWorkflow);
const mockedAddWorkflowEtapa = vi.mocked(addWorkflowEtapa);
const mockedRemoveWorkflow = vi.mocked(removeWorkflow);

describe('WorkflowModals', () => {
  beforeEach(() => {
    mockedAddWorkflow.mockReset();
    mockedAddWorkflowEtapa.mockReset();
    mockedRemoveWorkflow.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('validates required fields before trying to create a workflow', async () => {
    render(
      <NewWorkflowModal
        open={true}
        onClose={vi.fn()}
        clientes={[{ id: 1, nome: 'Aurora', status: 'ativo' } as any]}
        membros={[]}
        templates={[]}
        onCreated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Criar Fluxo/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Título e cliente são obrigatórios.');
    });
    expect(mockedAddWorkflow).not.toHaveBeenCalled();
  });

  it('hydrates etapas from the selected template and creates the workflow successfully', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    mockedAddWorkflow.mockResolvedValue({ id: 77 } as never);
    mockedAddWorkflowEtapa.mockResolvedValue({} as never);

    render(
      <NewWorkflowModal
        open={true}
        onClose={onClose}
        onCreated={onCreated}
        clientes={[
          { id: 1, nome: 'Aurora', status: 'ativo' },
          { id: 2, nome: 'Inativo', status: 'inativo' },
        ] as any}
        membros={[{ id: 9, nome: 'Ana' } as any]}
        templates={[
          {
            id: 12,
            nome: 'Template social',
            etapas: [
              { nome: 'Briefing', prazo_dias: 2, tipo_prazo: 'corridos', responsavel_id: 9, tipo: 'padrao' },
              { nome: 'Aprovação final', prazo_dias: 1, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'aprovacao_cliente' },
            ],
          },
        ] as any}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Ex: Posts Instagram — Março 2026'), {
      target: { value: 'Fluxo Abril' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aurora' }));
    fireEvent.click(screen.getByRole('button', { name: /Template social \(2 etapas\)/i }));

    expect(screen.getByDisplayValue('Briefing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aprovação final')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Criar Fluxo/i }));

    await waitFor(() => {
      expect(mockedAddWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        cliente_id: 1,
        titulo: 'Fluxo Abril',
        template_id: 12,
        status: 'ativo',
      }));
    });
    expect(mockedAddWorkflowEtapa).toHaveBeenCalledTimes(2);
    expect(mockedAddWorkflowEtapa).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workflow_id: 77,
      ordem: 0,
      nome: 'Briefing',
      status: 'ativo',
      iniciado_em: expect.any(String),
    }));
    expect(mockedAddWorkflowEtapa).toHaveBeenNthCalledWith(2, expect.objectContaining({
      workflow_id: 77,
      ordem: 1,
      nome: 'Aprovação final',
      status: 'pendente',
      tipo: 'aprovacao_cliente',
    }));
    expect(toastSuccessMock).toHaveBeenCalledWith('Fluxo criado com sucesso!');
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('rolls back the workflow when etapa creation fails', async () => {
    mockedAddWorkflow.mockResolvedValue({ id: 45 } as never);
    mockedAddWorkflowEtapa.mockRejectedValue(new Error('Falha ao criar etapa'));

    render(
      <NewWorkflowModal
        open={true}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        clientes={[{ id: 1, nome: 'Aurora', status: 'ativo' } as any]}
        membros={[]}
        templates={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Ex: Posts Instagram — Março 2026'), {
      target: { value: 'Fluxo de Crise' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aurora' }));
    fireEvent.change(screen.getByPlaceholderText('Nome da etapa'), {
      target: { value: 'Briefing' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Criar Fluxo/i }));

    await waitFor(() => {
      expect(mockedRemoveWorkflow).toHaveBeenCalledWith(45);
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao criar etapa');
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
