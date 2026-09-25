import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no scrollIntoView; editing a template scrolls the form into view.
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

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
  saveWorkflowTemplate: vi.fn(),
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

vi.mock('../SortableEtapaList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../SortableEtapaList')>();
  return { ...actual, SortableEtapaList: () => <div>SortableEtapaList</div> };
});

vi.mock('../MigrateTemplateDialog', () => ({
  MigrateTemplateDialog: () => null,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ClientApprovalChoiceDialog,
  RecurringWorkflowDialog,
  RevertConfirmDialog,
  TemplatesModal,
} from '../WorkflowModals';
import { saveWorkflowTemplate } from '../../../../store';

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
          entityTitle="Fluxo Editorial"
          onConfirm={onConfirmRevert}
          onCancel={onCancelRevert}
        />
        <ClientApprovalChoiceDialog
          open={true}
          entityTitle="Fluxo Editorial"
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
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para o cliente aprovar' }));

    expect(onConfirmRecurring).toHaveBeenCalled();
    expect(onCancelRevert).toHaveBeenCalled();
    expect(onConfirmRevert).toHaveBeenCalled();
    expect(onCancelApproval).toHaveBeenCalled();
    expect(onApproveInternally).toHaveBeenCalled();
    expect(onSendToPortal).toHaveBeenCalled();
  });

  describe('TemplatesModal edit save', () => {
    const template = {
      id: 5,
      nome: 'Posts',
      modo_prazo: 'padrao' as const,
      etapas: [
        {
          nome: 'Copy',
          prazo_dias: 1,
          tipo_prazo: 'corridos' as const,
          responsavel_id: 7,
          tipo: 'padrao' as const,
        },
      ],
    };

    function renderModal(onRefresh = vi.fn()) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <TemplatesModal
            open
            onClose={vi.fn()}
            templates={[template]}
            membros={[]}
            onRefresh={onRefresh}
          />
        </QueryClientProvider>,
      );
      return onRefresh;
    }

    beforeEach(() => {
      vi.mocked(saveWorkflowTemplate).mockReset();
    });

    it('saves an edited template with one saveWorkflowTemplate call', async () => {
      vi.mocked(saveWorkflowTemplate).mockResolvedValue(undefined);
      const onRefresh = renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Editar template Posts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(onRefresh).toHaveBeenCalled());
      expect(toastSuccessMock).toHaveBeenCalledWith('Template atualizado!');
      expect(saveWorkflowTemplate).toHaveBeenCalledTimes(1);
      expect(saveWorkflowTemplate).toHaveBeenCalledWith(5, {
        nome: 'Posts',
        etapas: [
          {
            nome: 'Copy',
            prazo_dias: 1,
            tipo_prazo: 'corridos',
            responsavel_id: 7,
            tipo: 'padrao',
          },
        ],
        modo_prazo: 'padrao',
      });
    });

    it('shows the mapped error message when the save fails', async () => {
      vi.mocked(saveWorkflowTemplate).mockRejectedValue(
        new Error('Um dos responsáveis não faz mais parte da equipe.'),
      );
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Editar template Posts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Um dos responsáveis não faz mais parte da equipe.',
        ),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeDisabled(),
      );
    });
  });
});
