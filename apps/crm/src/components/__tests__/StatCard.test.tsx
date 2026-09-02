import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard onClick', () => {
  it('renders a button with active state and fires onClick', () => {
    const onClick = vi.fn();
    render(<StatCard label="Atrasadas" value={5} onClick={onClick} active />);
    const btn = screen.getByRole('button', { name: /Atrasadas/ });
    expect(btn).toHaveAttribute('data-active', 'true');
    // The ring is the sighted cue; aria-pressed is the same toggle state for AT.
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('reports the untoggled state when the card is clickable but not applied', () => {
    render(<StatCard label="Urgentes" value={1} onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Urgentes/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).not.toHaveAttribute('data-active');
  });
  it('renders a plain div without onClick', () => {
    render(<StatCard label="Em dia" value={2} />);
    expect(screen.queryByRole('button', { name: /Em dia/ })).toBeNull();
  });
});

describe('StatCard invertDelta', () => {
  it('marks a down delta as good when inverted', () => {
    render(
      <StatCard
        label="Tempo médio"
        value="5d"
        delta={{ direction: 'down', percent: 12, caption: 'vs período anterior' }}
        invertDelta
      />,
    );
    const delta = document.querySelector('.kpi-delta')!;
    expect(delta.getAttribute('data-direction')).toBe('down'); // arrow keeps real direction
    expect(delta.getAttribute('data-good')).toBe('true'); // color reads good
  });
  it('marks an up delta as good by default', () => {
    render(<StatCard label="Concluídos" value={4} delta={{ direction: 'up', percent: 33 }} />);
    expect(document.querySelector('.kpi-delta')!.getAttribute('data-good')).toBe('true');
  });
});

describe('StatCard unit', () => {
  it('defaults to a percentage with one decimal', () => {
    render(<StatCard label="Concluídos" value={4} delta={{ direction: 'up', percent: 33.333 }} />);
    expect(document.querySelector('.kpi-delta')!.textContent).toContain('33.3%');
  });

  it('renders a whole number for a non-percent unit', () => {
    // A difference between two percentages has no fractional part worth
    // printing, and "8.0pts" would invent one the data never had.
    render(
      <StatCard
        label="Pontualidade"
        value="61%"
        delta={{ direction: 'down', percent: 8, caption: 'vs período anterior (pp)' }}
        unit="pts"
      />,
    );
    const delta = document.querySelector('.kpi-delta')!;
    expect(delta.textContent).toContain('8pts');
    expect(delta.textContent).not.toContain('8.0');
  });

  it('rounds a fractional value down to the unit it is printed in', () => {
    render(
      <StatCard
        label="Retrabalho"
        value="18%"
        delta={{ direction: 'down', percent: 6.4 }}
        unit="pts"
      />,
    );
    expect(document.querySelector('.kpi-delta')!.textContent).toContain('6pts');
  });
});
