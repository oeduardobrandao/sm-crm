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

  it('the value never wraps or widens the tile (B1): nowrap, ellipsis, tabular, min-w-0', () => {
    render(
      <KpiGrid>
        <KpiTile label="ARR" value="R$ 234.000,00" />
        <KpiTile label="MRR" value="R$ 19.500,00" compact />
      </KpiGrid>,
    );
    const value = screen.getByText('R$ 234.000,00');
    expect(value).toHaveAttribute('data-kpi-value');
    expect(value).toHaveClass('admin-kpi-value', 'truncate', 'tabular-nums', 'min-w-0');
    expect(value).toHaveAttribute('title', 'R$ 234.000,00');
    expect(value.parentElement).toHaveClass('admin-kpi-tile', 'min-w-0');
    const compact = screen.getByText('R$ 19.500,00');
    expect(compact).toHaveClass('admin-kpi-value--compact', 'text-[22px]');
    expect(compact).not.toHaveClass('text-[28px]');
  });
});
