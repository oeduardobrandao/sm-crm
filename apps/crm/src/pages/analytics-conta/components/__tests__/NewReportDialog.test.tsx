import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { generateMock, navigateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock('../../../../services/reportDocs', () => ({ generateReportDoc: generateMock }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewReportDialog } from '../NewReportDialog';

describe('NewReportDialog', () => {
  it('gera com o mês selecionado e navega para o documento', async () => {
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [clientId, month] = generateMock.mock.calls[0];
    expect(clientId).toBe(42);
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/doc-9');
  });

  it('erro mostra toast e mantém o dialog aberto', async () => {
    const { toast } = await import('sonner');
    generateMock.mockRejectedValue(new Error('Seu plano não inclui relatórios.'));
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Seu plano não inclui relatórios.'),
    );
  });
});
