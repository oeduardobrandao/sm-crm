import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ImportBanner } from '../ImportBanner';

function renderBanner(clienteCount: number) {
  return render(
    <MemoryRouter>
      <ImportBanner clienteCount={clienteCount} />
    </MemoryRouter>,
  );
}

describe('ImportBanner', () => {
  it('shows the migration nudge when the workspace has zero clientes', () => {
    renderBanner(0);
    expect(screen.getByText('Migrando do Notion, Trello ou ClickUp?')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /importar dados/i });
    expect(link).toHaveAttribute('href', '/importar');
  });

  it('renders nothing once the workspace has any clientes', () => {
    const { container } = renderBanner(3);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a member restricted to assigned clients (no client import)', () => {
    const { container } = render(
      <MemoryRouter>
        <ImportBanner clienteCount={0} clientScoped />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('todos_unchanged: an unscoped member still sees the nudge', () => {
    render(
      <MemoryRouter>
        <ImportBanner clienteCount={0} clientScoped={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Migrando do Notion, Trello ou ClickUp?')).toBeInTheDocument();
  });
});
