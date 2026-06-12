import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeatureGate } from '../FeatureGate';
import { useEntitlements } from '../../../hooks/useEntitlements';

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: vi.fn(),
}));

const mockedUseEntitlements = vi.mocked(useEntitlements);

function setEntitlements({
  enabledFlag,
  isLoading = false,
}: {
  enabledFlag?: string;
  isLoading?: boolean;
}) {
  mockedUseEntitlements.mockReturnValue({
    isLoading,
    hasFeature: (f: string) => f === enabledFlag,
  } as never);
}

beforeEach(() => {
  setEntitlements({ enabledFlag: 'feature_on' });
});

describe('FeatureGate', () => {
  it('renders children when feature is on', () => {
    setEntitlements({ enabledFlag: 'feature_on' });
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
    setEntitlements({ enabledFlag: 'feature_on' });
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

  it('renders children while entitlements are loading, even if the flag is off', () => {
    // FeatureGate returns children when `isLoading || hasFeature(flag)`.
    setEntitlements({ enabledFlag: 'something_else', isLoading: true });
    render(
      <MemoryRouter>
        <FeatureGate flag="feature_off" label="Leads">
          <span>inside</span>
        </FeatureGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('inside')).toBeInTheDocument();
    // The locked nudge is NOT shown during loading.
    expect(screen.queryByText(/não está disponível no seu plano/)).toBeNull();
  });
});
