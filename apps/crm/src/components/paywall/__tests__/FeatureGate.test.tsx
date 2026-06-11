import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeatureGate } from '../FeatureGate';

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ hasFeature: (f: string) => f === 'feature_on', isLoading: false }),
}));

describe('FeatureGate', () => {
  it('renders children when feature is on', () => {
    render(
      <MemoryRouter>
        <FeatureGate flag="feature_on">
          <span>inside</span>
        </FeatureGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('renders the nudge when feature is off', () => {
    render(
      <MemoryRouter>
        <FeatureGate flag="feature_off" label="Leads">
          <span>inside</span>
        </FeatureGate>
      </MemoryRouter>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.getByText(/Leads/)).toBeTruthy();
  });
});
