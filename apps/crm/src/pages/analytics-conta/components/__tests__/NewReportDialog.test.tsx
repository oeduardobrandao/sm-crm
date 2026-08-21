import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { generateMock, navigateMock, invalidateQueriesMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  navigateMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
}));
vi.mock('../../../../services/reportDocs', () => ({ generateReportDoc: generateMock }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewReportDialog } from '../NewReportDialog';

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
});
