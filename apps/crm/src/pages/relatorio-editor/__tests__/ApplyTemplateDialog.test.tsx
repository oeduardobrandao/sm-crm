import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import type { ReportTemplateRow } from '../../../services/reportTemplates';

const { listReportTemplatesMock, deleteReportTemplateMock, setDefaultReportTemplateMock } =
  vi.hoisted(() => ({
    listReportTemplatesMock: vi.fn(),
    deleteReportTemplateMock: vi.fn(),
    setDefaultReportTemplateMock: vi.fn(),
  }));
vi.mock('../../../services/reportTemplates', () => ({
  listReportTemplates: listReportTemplatesMock,
  deleteReportTemplate: deleteReportTemplateMock,
  setDefaultReportTemplate: setDefaultReportTemplateMock,
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { ApplyTemplateDialog } from '../ApplyTemplateDialog';

const layout: ReportLayout = {
  version: 1,
  blocks: [{ id: 'a', type: 'divider', size: 'full' }],
};

const template = (overrides: Partial<ReportTemplateRow> = {}): ReportTemplateRow => ({
  id: 'tpl-1',
  name: 'Modelo mensal',
  layout,
  is_default: false,
  created_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

function renderDialog(props: Partial<ComponentProps<typeof ApplyTemplateDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onApply = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ApplyTemplateDialog open onOpenChange={onOpenChange} onApply={onApply} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onApply, qc };
}

describe('ApplyTemplateDialog', () => {
  beforeEach(() => {
    listReportTemplatesMock.mockResolvedValue([
      template({ id: 'tpl-1', name: 'Modelo mensal', is_default: false }),
      template({ id: 'tpl-2', name: 'Modelo padrão', is_default: true }),
    ]);
    deleteReportTemplateMock.mockResolvedValue(undefined);
    setDefaultReportTemplateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lista os templates de useQuery(["report-templates"]) com badge Padrão no is_default', async () => {
    renderDialog();
    expect(await screen.findByText('Modelo mensal')).toBeInTheDocument();
    expect(screen.getByText('Modelo padrão')).toBeInTheDocument();
    expect(listReportTemplatesMock).toHaveBeenCalled();
    expect(screen.getByText('Padrão')).toBeInTheDocument();
  });

  it('clicar em Aplicar chama onApply com o template e fecha o dialog', async () => {
    const { onApply, onOpenChange } = renderDialog();
    const row = (await screen.findByText('Modelo mensal')).closest(
      '[data-testid="template-row"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tpl-1', name: 'Modelo mensal' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('botão de excluir pede confirmação e, confirmado, chama deleteReportTemplate e invalida a lista', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDialog();
    await screen.findByText('Modelo mensal');
    fireEvent.click(screen.getAllByLabelText('Excluir template')[0]);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(deleteReportTemplateMock).toHaveBeenCalledWith('tpl-1'));
    await waitFor(() => expect(listReportTemplatesMock).toHaveBeenCalledTimes(2));
  });

  it('botão de excluir cancelado no confirm NÃO chama deleteReportTemplate', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDialog();
    await screen.findByText('Modelo mensal');
    fireEvent.click(screen.getAllByLabelText('Excluir template')[0]);
    expect(deleteReportTemplateMock).not.toHaveBeenCalled();
  });

  it('botão de tornar padrão chama setDefaultReportTemplate e invalida a lista', async () => {
    renderDialog();
    await screen.findByText('Modelo mensal');
    fireEvent.click(screen.getByLabelText('Definir como padrão'));
    await waitFor(() => expect(setDefaultReportTemplateMock).toHaveBeenCalledWith('tpl-1'));
    await waitFor(() => expect(listReportTemplatesMock).toHaveBeenCalledTimes(2));
  });

  it('estado vazio mostra texto claro', async () => {
    listReportTemplatesMock.mockResolvedValue([]);
    renderDialog();
    expect(
      await screen.findByText('Nenhum template salvo ainda. Use Salvar como template no editor.'),
    ).toBeInTheDocument();
  });
});
