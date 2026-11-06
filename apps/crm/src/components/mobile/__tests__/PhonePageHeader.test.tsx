import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PhoneLayoutContext,
  usePhoneChromeController,
} from '@/components/layout/PhoneLayoutContext';
import { PhonePageHeader } from '../PhonePageHeader';

// The real actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => (
    <div className="phone-shell-actions" data-testid="shell-actions">
      <button type="button" aria-label="Notificações" />
    </div>
  ),
}));

function Shell({ children }: { children: React.ReactNode }) {
  const { contextValue, attributes } = usePhoneChromeController(true);
  return (
    <PhoneLayoutContext.Provider value={contextValue}>
      <div data-testid="container" {...attributes}>
        {children}
      </div>
    </PhoneLayoutContext.Provider>
  );
}

describe('PhonePageHeader', () => {
  it('renders the large title, subtitle and extra content', () => {
    render(
      <PhonePageHeader title="Clientes" subtitle="12 de 15 clientes">
        <div>Segmentos</div>
      </PhonePageHeader>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toHaveClass(
      'phone-large-title__title',
    );
    expect(screen.getByText('12 de 15 clientes')).toHaveClass('phone-large-title__subtitle');
    expect(screen.getByText('Segmentos')).toBeInTheDocument();
  });

  it('puts the page actions before the shell help links and bell in one row', () => {
    render(
      <PhonePageHeader
        title="Clientes"
        actions={
          <>
            <button type="button">Buscar</button>
            <button type="button">Novo cliente</button>
          </>
        }
      />,
    );
    const row = document.querySelector('.phone-large-title__trailing')!;
    const labels = Array.from(row.querySelectorAll('button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    );
    expect(labels).toEqual(['Buscar', 'Novo cliente', 'Notificações']);
    expect(row.lastElementChild).toHaveAttribute('data-testid', 'shell-actions');
  });

  it('shows the Mesaas mark at the left of the row, above the title, by default', () => {
    render(<PhonePageHeader title="Clientes" />);
    expect(document.querySelector('.phone-large-title__leading')).toContainElement(
      screen.getByRole('img', { name: 'Mesaas' }),
    );
  });

  it('lets a page replace the leading content', () => {
    render(<PhonePageHeader title="Clientes" leading={<button type="button">Voltar</button>} />);
    expect(document.querySelector('.phone-large-title__leading')).toContainElement(
      screen.getByRole('button', { name: 'Voltar' }),
    );
    expect(screen.queryByRole('img', { name: 'Mesaas' })).not.toBeInTheDocument();
  });

  it('renders the row even without page actions (help links and bell)', () => {
    render(<PhonePageHeader title="Central de Ajuda" />);
    expect(screen.getByTestId('shell-actions')).toBeInTheDocument();
  });

  it('hides the shell bar while mounted', () => {
    const { unmount } = render(
      <Shell>
        <PhonePageHeader title="Clientes" />
      </Shell>,
    );
    expect(screen.getByTestId('container')).toHaveAttribute('data-phone-page-header');
    expect(screen.getByTestId('container')).not.toHaveAttribute('data-phone-tab-bar');
    unmount();
  });
});
