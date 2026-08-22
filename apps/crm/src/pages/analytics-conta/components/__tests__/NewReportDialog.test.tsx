import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, navigateMock, invalidateQueriesMock, queryState, listTemplatesMock } =
  vi.hoisted(() => {
    const queryState: Record<string, { data?: unknown; isLoading?: boolean }> = {};
    return {
      generateMock: vi.fn(),
      navigateMock: vi.fn(),
      invalidateQueriesMock: vi.fn(),
      queryState,
      listTemplatesMock: vi.fn(),
    };
  });
vi.mock('../../../../services/reportDocs', () => ({ generateReportDoc: generateMock }));
vi.mock('../../../../services/reportTemplates', () => ({ listReportTemplates: listTemplatesMock }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] }) => {
    const key = String(options.queryKey[0]);
    return queryState[key] ?? { data: undefined, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Select mockado no padrão da casa (ver AutomationFormDialog.test.tsx): o
// Radix real precisa de pointer events reais para abrir a listbox, que este
// repo não tem via @testing-library/user-event. O mock troca o listbox por
// botões clicáveis, mantendo value/onValueChange reais.
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

  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || (placeholder ?? '')}</span>;
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

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import { NewReportDialog } from '../NewReportDialog';

beforeEach(() => {
  for (const key of Object.keys(queryState)) delete queryState[key];
});

describe('NewReportDialog', () => {
  it('gera com o mês selecionado, invalida a lista e navega para o documento', async () => {
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [clientId, month] = generateMock.mock.calls[0];
    expect(clientId).toBe(42);
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    await waitFor(() =>
      expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['report-docs', 42] }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/doc-9');
  });

  it('erro mostra toast, mantém o dialog aberto e não invalida a lista', async () => {
    const { toast } = await import('sonner');
    generateMock.mockRejectedValue(new Error('Seu plano não inclui relatórios.'));
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Seu plano não inclui relatórios.'),
    );
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('lista os templates e usa o default (is_default) como seleção inicial', async () => {
    queryState['report-templates'] = {
      data: [
        { id: 'tpl-1', name: 'Mensal padrão', layout: {}, is_default: true, created_at: 'x' },
        { id: 'tpl-2', name: 'Trimestral', layout: {}, is_default: false, created_at: 'x' },
      ],
    };
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    expect(
      await screen.findByRole('button', { name: /Mensal padrão · padrão/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [, , templateId] = generateMock.mock.calls[0];
    expect(templateId).toBe('tpl-1');
  });

  it('sem template default, a seleção inicial é "Padrão do sistema" e templateId não é enviado', async () => {
    queryState['report-templates'] = {
      data: [{ id: 'tpl-2', name: 'Trimestral', layout: {}, is_default: false, created_at: 'x' }],
    };
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [, , templateId] = generateMock.mock.calls[0];
    expect(templateId).toBeUndefined();
  });

  // Achado 3: a inicialização do template selecionado rodava em [open,
  // templates] -- um refetch em segundo plano de ['report-templates']
  // enquanto o dialog seguia aberto (array com identidade nova, mesmo
  // conteúdo) disparava o efeito de novo e resetava a escolha manual do
  // usuário de volta pro default. Prova o fix: seleciona manualmente,
  // simula o refetch (rerender com um array NOVO) e confere que a escolha
  // sobrevive.
  it('template selecionado manualmente não é resetado por um refetch em segundo plano de report-templates', async () => {
    const templatesV1 = [
      { id: 'tpl-1', name: 'Mensal padrão', layout: {}, is_default: true, created_at: 'x' },
      { id: 'tpl-2', name: 'Trimestral', layout: {}, is_default: false, created_at: 'x' },
    ];
    queryState['report-templates'] = { data: templatesV1 };
    generateMock.mockResolvedValue({ id: 'doc-9' });
    const { rerender } = render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    await screen.findByRole('button', { name: /Mensal padrão · padrão/ });

    // Usuário troca manualmente para o outro template.
    fireEvent.click(screen.getByRole('button', { name: 'Trimestral' }));

    // Refetch em segundo plano: mesmo conteúdo, array com identidade NOVA.
    queryState['report-templates'] = { data: templatesV1.map((t) => ({ ...t })) };
    rerender(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);

    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [, , templateId] = generateMock.mock.calls[0];
    expect(templateId).toBe('tpl-2'); // segue Trimestral, não voltou pro default
  });

  it('permite trocar para outro template e passa o id escolhido em generateReportDoc', async () => {
    queryState['report-templates'] = {
      data: [
        { id: 'tpl-1', name: 'Mensal padrão', layout: {}, is_default: true, created_at: 'x' },
        { id: 'tpl-2', name: 'Trimestral', layout: {}, is_default: false, created_at: 'x' },
      ],
    };
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Trimestral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [, , templateId] = generateMock.mock.calls[0];
    expect(templateId).toBe('tpl-2');
  });
});
