import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIsHydrated } from '../useIsHydrated';

function Probe() {
  return <span data-testid="probe">{String(useIsHydrated())}</span>;
}

describe('useIsHydrated', () => {
  it('is false on the server render', () => {
    expect(renderToString(<Probe />)).toContain('false');
  });

  it('is true on a client render', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });
});
