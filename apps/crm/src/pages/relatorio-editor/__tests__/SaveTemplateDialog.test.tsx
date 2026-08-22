import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { stripAiTextForTemplate } from '../templateOps';

const { createReportTemplateMock, setDefaultReportTemplateMock } = vi.hoisted(() => ({
  createReportTemplateMock: vi.fn(),
  setDefaultReportTemplateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  createReportTemplate: createReportTemplateMock,
  setDefaultReportTemplate: setDefaultReportTemplateMock,
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { SaveTemplateDialog } from '../SaveTemplateDialog';

const doc = (label: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
});

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 't1', type: 'text', size: 'full', text: doc('autor') },
    { id: 's1', type: 'ai_summary', size: 'full', text: doc('ia') },
  ],
};

function renderDialog(props: Partial<ComponentProps<typeof SaveTemplateDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const getLayout = vi.fn(() => layout);
  render(
    <QueryClientProvider client={qc}>
      <SaveTemplateDialog open onOpenChange={onOpenChange} getLayout={getLayout} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, getLayout, qc };
}

describe('SaveTemplateDialog', () => {
  it('salva com nome preenchido: chama createReportTemplate com o layout stripado de texto de IA, e fecha com toast de sucesso', async () => {
    createReportTemplateMock.mockResolvedValue({
      id: 'tpl-1',
      name: 'Modelo mensal',
      layout,
      is_default: false,
      created_at: '2026-08-21T00:00:00Z',
    });
    const { onOpenChange, getLayout } = renderDialog();

    fireEvent.change(screen.getByLabelText('Nome do template'), {
      target: { value: 'Modelo mensal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(createReportTemplateMock).toHaveBeenCalledWith(
        'Modelo mensal',
        stripAiTextForTemplate(layout),
      );
    });
    expect(getLayout).toHaveBeenCalled();
    expect(setDefaultReportTemplateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Template salvo.'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('checkbox "Definir como padrão do workspace" marcado chama setDefaultReportTemplate com o id do template criado', async () => {
    createReportTemplateMock.mockResolvedValue({
      id: 'tpl-2',
      name: 'Modelo padrão',
      layout,
      is_default: false,
      created_at: '2026-08-21T00:00:00Z',
    });
    setDefaultReportTemplateMock.mockResolvedValue(undefined);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Nome do template'), {
      target: { value: 'Modelo padrão' },
    });
    fireEvent.click(screen.getByLabelText('Definir como padrão do workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(setDefaultReportTemplateMock).toHaveBeenCalledWith('tpl-2');
    });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Template salvo.'));
  });

  it('nome vazio desabilita o botão Salvar', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('erro do serviço mostra toast de erro e NÃO fecha o dialog', async () => {
    createReportTemplateMock.mockRejectedValue(new Error('Falha ao salvar template'));
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText('Nome do template'), {
      target: { value: 'Modelo com erro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Falha ao salvar template');
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(setDefaultReportTemplateMock).not.toHaveBeenCalled();
  });
});
