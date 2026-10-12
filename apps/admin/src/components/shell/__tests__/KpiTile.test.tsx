import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { KpiGrid, KpiTile } from '../KpiTile';

describe('KpiTile', () => {
  it('renders label, value and sub-line; a `to` tile is a link', () => {
    render(
      <MemoryRouter>
        <KpiGrid>
          <KpiTile label="MRR" value="R$ 9.870" sub="61 pagantes" to="/admin/metricas" />
          <KpiTile label="Em risco" value="6" tone="warning" />
        </KpiGrid>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /MRR.*R\$ 9\.870/ })).toHaveAttribute(
      'href',
      '/admin/metricas',
    );
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
