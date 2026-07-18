import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ClienteFinanceEmptyState } from '../ClienteFinanceEmptyState';

describe('ClienteFinanceEmptyState', () => {
  it('renders descriptive copy and an accessible client-finance action link', () => {
    const { container } = render(
      <MemoryRouter>
        <ClienteFinanceEmptyState
          icon={FileText}
          title="Nenhum contrato cadastrado"
          description="Os contratos vinculados a este cliente aparecerão aqui."
          actionLabel="Gerenciar contratos"
          actionHref="/contratos"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Nenhum contrato cadastrado' })).toBeVisible();
    expect(
      screen.getByText('Os contratos vinculados a este cliente aparecerão aqui.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Gerenciar contratos' })).toHaveAttribute(
      'href',
      '/contratos',
    );
    expect(container.querySelector('.cliente-finance-empty__icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
