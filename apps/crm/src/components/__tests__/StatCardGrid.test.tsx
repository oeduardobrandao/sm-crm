import { fireEvent, render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatCard } from '../StatCard';
import { StatCardGrid } from '../StatCardGrid';

let desktop = false;
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop }));

function Grid(props: { className?: string; phoneLayout?: 'grid' | 'scroll' }) {
  return (
    <StatCardGrid id="kpis" style={{ marginBottom: 8 }} {...props}>
      <StatCard label="Membros" value={5} icon={Users} tone="blue" sub="2 freelancers" />
      <StatCard
        label="Tempo médio"
        value="5d"
        delta={{ direction: 'down', percent: 12.34, caption: 'vs período anterior' }}
        invertDelta
        sub="não aparece com delta"
        footNote="Anterior: 6d"
      />
      <StatCard
        label="Pontualidade"
        value="82%"
        delta={{ direction: 'up', percent: 4, caption: 'vs período anterior' }}
        unit="pts"
      />
    </StatCardGrid>
  );
}

describe('StatCardGrid below 768px', () => {
  beforeEach(() => {
    desktop = false;
  });

  it('renders compact tiles with every fact of the card, without fillers', () => {
    const { container } = render(<Grid />);
    const grid = container.querySelector('#kpis')!;
    expect(grid).toHaveClass('phone-kit', 'phone-stat-grid');
    expect(grid).not.toHaveClass('kpi-grid');
    expect(grid).toHaveStyle({ marginBottom: '8px' });
    expect(container.querySelector('.kpi-card')).toBeNull();
    const tiles = container.querySelectorAll('.phone-stat-tile');
    expect(tiles).toHaveLength(3);

    // Sub line when there is no delta.
    expect(tiles[0]).toHaveTextContent('Membros');
    expect(tiles[0]).toHaveTextContent('5');
    expect(tiles[0]).toHaveTextContent('2 freelancers');

    // Delta, caption and footnote; the sub line yields to the delta, as on desktop.
    const delta = tiles[1].querySelector('.phone-stat-tile__delta')!;
    expect(delta).toHaveTextContent('12.3%');
    expect(delta.getAttribute('data-direction')).toBe('down');
    expect(delta.getAttribute('data-good')).toBe('true');
    expect(tiles[1]).toHaveTextContent('vs período anterior');
    expect(tiles[1]).toHaveTextContent('Anterior: 6d');
    expect(tiles[1]).not.toHaveTextContent('não aparece com delta');

    // Non-% units stay whole numbers.
    expect(tiles[2].querySelector('.phone-stat-tile__delta')).toHaveTextContent('4pts');
  });

  it('keeps clickable tiles as toggle buttons', () => {
    const onClick = vi.fn();
    render(
      <StatCardGrid>
        <StatCard label="Atrasadas" value={3} onClick={onClick} active />
        <StatCard label="Em dia" value={9} onClick={onClick} />
      </StatCardGrid>,
    );
    const on = screen.getByRole('button', { name: /Atrasadas/ });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('phone-stat-tile--active');
    expect(screen.getByRole('button', { name: /Em dia/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(on);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the swipe strip for analytics-kpi-scroll, or on request', () => {
    const { container, rerender } = render(<Grid className="analytics-kpi-scroll" />);
    expect(container.querySelector('#kpis')).toHaveClass('phone-stat-grid--scroll');
    rerender(<Grid phoneLayout="scroll" />);
    expect(container.querySelector('#kpis')).toHaveClass('phone-stat-grid--scroll');
    rerender(<Grid />);
    expect(container.querySelector('#kpis')).not.toHaveClass('phone-stat-grid--scroll');
  });

  it('leaves a StatCard outside a grid as the desktop card', () => {
    const { container } = render(<StatCard label="Solta" value={1} />);
    expect(container.querySelector('.kpi-card')).not.toBeNull();
    expect(container.querySelector('.phone-stat-tile')).toBeNull();
  });
});

describe('StatCardGrid at 768px and up', () => {
  beforeEach(() => {
    desktop = true;
  });

  it('keeps the fused KPI block with fillers', () => {
    const { container } = render(<Grid />);
    const grid = container.querySelector('#kpis')!;
    expect(grid).toHaveClass('kpi-grid');
    expect(grid).not.toHaveClass('phone-stat-grid');
    expect(container.querySelectorAll('.kpi-card:not(.kpi-card--filler)')).toHaveLength(3);
    expect(container.querySelector('.phone-stat-tile')).toBeNull();
    expect(container.querySelector('.kpi-icon')).not.toBeNull();
  });
});
