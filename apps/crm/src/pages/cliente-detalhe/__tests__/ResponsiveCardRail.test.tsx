import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

describe('ResponsiveCardRail', () => {
  it('marks multiple children as a discoverable rail', () => {
    render(
      <ResponsiveCardRail>
        <div>A</div>
        <div>B</div>
      </ResponsiveCardRail>,
    );

    expect(screen.getByTestId('responsive-card-rail')).toHaveClass(
      'cliente-card-rail--multiple',
    );
    expect(screen.getAllByTestId('responsive-card-rail-item')).toHaveLength(2);
  });

  it('keeps a single child full width', () => {
    render(
      <ResponsiveCardRail>
        <div>A</div>
      </ResponsiveCardRail>,
    );

    expect(screen.getByTestId('responsive-card-rail')).not.toHaveClass(
      'cliente-card-rail--multiple',
    );
  });
});
