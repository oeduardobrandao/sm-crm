import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard onClick', () => {
  it('renders a button with active state and fires onClick', () => {
    const onClick = vi.fn();
    render(<StatCard label="Atrasadas" value={5} onClick={onClick} active />);
    const btn = screen.getByRole('button', { name: /Atrasadas/ });
    expect(btn).toHaveAttribute('data-active', 'true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
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
