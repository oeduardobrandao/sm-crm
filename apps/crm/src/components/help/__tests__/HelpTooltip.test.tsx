import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpTooltip } from '../HelpTooltip';

let desktop = false;
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop }));

describe('HelpTooltip on phones', () => {
  beforeEach(() => {
    desktop = false;
  });

  it('shows a help button that opens the same content in a sheet', async () => {
    render(
      <MemoryRouter>
        <HelpTooltip content="Corridos = todos os dias do calendário." />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'Ajuda' });
    expect(button).toHaveClass('phone-info-button');
    fireEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Ajuda' });
    expect(within(sheet).getByText('Corridos = todos os dias do calendário.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('uses the title for the sheet and ignores a custom desktop trigger', async () => {
    render(
      <MemoryRouter>
        <HelpTooltip title="Importar CSV" content="Colunas CSV: nome*, cargo*">
          <span data-testid="desktop-trigger">?</span>
        </HelpTooltip>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('desktop-trigger')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Importar CSV' }));
    expect(await screen.findByRole('dialog', { name: 'Importar CSV' })).toHaveTextContent(
      'Colunas CSV: nome*, cargo*',
    );
  });
});

describe('HelpTooltip on desktop', () => {
  beforeEach(() => {
    desktop = true;
  });

  it('keeps the hover tooltip trigger and no sheet button', () => {
    render(
      <HelpTooltip content="Texto">
        <span data-testid="desktop-trigger">?</span>
      </HelpTooltip>,
    );
    expect(screen.getByTestId('desktop-trigger')).toBeInTheDocument();
    expect(document.querySelector('.phone-info-button')).toBeNull();
  });
});
