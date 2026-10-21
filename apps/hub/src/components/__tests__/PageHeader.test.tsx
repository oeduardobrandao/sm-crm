import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { PageHeader } from '../PageHeader';

const ctx = (extra: object) =>
  ({ bootstrap: { cliente_nome: 'Clínica Aurora', ...extra } }) as never;

describe('PageHeader', () => {
  it('classic: no eyebrow, title keeps font-medium', () => {
    render(
      <HubContext.Provider value={ctx({})}>
        <PageHeader title="Aprovações" />
      </HubContext.Provider>,
    );
    expect(screen.queryByText('Clínica Aurora')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Aprovações' })).toHaveClass('font-medium');
  });
  it('Pauta: client name as eyebrow and hub-display-title', () => {
    render(
      <HubContext.Provider value={ctx({ feature_hub_pauta: true })}>
        <PageHeader title="Aprovações" />
      </HubContext.Provider>,
    );
    expect(screen.getByText('Clínica Aurora')).toHaveClass('hub-eyebrow');
    expect(screen.getByRole('heading', { name: 'Aprovações' })).toHaveClass('hub-display-title');
  });
  it('Pauta: explicit eyebrow wins', () => {
    render(
      <HubContext.Provider value={ctx({ feature_hub_pauta: true })}>
        <PageHeader title="X" eyebrow="Outro" />
      </HubContext.Provider>,
    );
    expect(screen.getByText('Outro')).toHaveClass('hub-eyebrow');
  });
});
