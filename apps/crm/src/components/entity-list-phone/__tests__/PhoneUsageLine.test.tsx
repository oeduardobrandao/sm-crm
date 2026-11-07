import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PhoneUsageLine } from '../PhoneUsageLine';

function renderLine(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('PhoneUsageLine', () => {
  it('offers the owner the upgrade link near the limit on the web', () => {
    renderLine(<PhoneUsageLine label="clientes" used={14} limit={15} showUpgradeCta />);
    expect(screen.getByText('14 de 15 clientes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('never renders the upgrade link inside the native app', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    };
    renderLine(<PhoneUsageLine label="clientes" used={15} limit={15} showUpgradeCta />);
    expect(screen.getByText('15 de 15 clientes')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });
});
