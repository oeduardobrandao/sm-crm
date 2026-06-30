import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renders a polyline for >= 2 points', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('uses an up color when trending up', () => {
    const { container } = render(<Sparkline values={[1, 5]} />);
    const stroke = container.querySelector('polyline')?.getAttribute('stroke');
    expect(stroke).toBe('var(--success)');
  });

  it('uses a down color when trending down', () => {
    const { container } = render(<Sparkline values={[5, 1]} />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--danger)');
  });

  it('renders no polyline for < 2 points', () => {
    const { container } = render(<Sparkline values={[1]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
