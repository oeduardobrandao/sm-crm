import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { StatusPill } from '../StatusPill';

const pauta = (ui: React.ReactNode) => (
  <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
    {ui}
  </HubContext.Provider>
);

describe('StatusPill', () => {
  it.each([
    ['accent', 'hub-pill-accent'],
    ['danger', 'hub-pill-danger'],
    ['neutral', 'hub-pill-neutral'],
  ] as const)('renders the %s tone with the %s class', (tone, expectedClass) => {
    render(<StatusPill tone={tone}>Label</StatusPill>);
    expect(screen.getByText('Label')).toHaveClass('hub-pill', expectedClass);
  });

  it('classic ignores semantic', () => {
    render(
      <StatusPill tone="accent" semantic="ok">
        X
      </StatusPill>,
    );
    expect(screen.getByText('X')).toHaveClass('hub-pill', 'hub-pill-accent');
  });
  it('pauta uses semantic', () => {
    render(
      pauta(
        <StatusPill tone="accent" semantic="ok">
          X
        </StatusPill>,
      ),
    );
    expect(screen.getByText('X')).toHaveClass('hub-pill', 'hub-pill-st-ok');
  });
  it('pauta falls back from tone', () => {
    render(pauta(<StatusPill tone="danger">X</StatusPill>));
    expect(screen.getByText('X')).toHaveClass('hub-pill-st-fix');
  });
});
