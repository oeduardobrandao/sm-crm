import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from '../StatusPill';

describe('StatusPill', () => {
  it.each([
    ['accent', 'hub-pill-accent'],
    ['danger', 'hub-pill-danger'],
    ['neutral', 'hub-pill-neutral'],
  ] as const)('renders the %s tone with the %s class', (tone, expectedClass) => {
    render(<StatusPill tone={tone}>Label</StatusPill>);
    expect(screen.getByText('Label')).toHaveClass('hub-pill', expectedClass);
  });
});
