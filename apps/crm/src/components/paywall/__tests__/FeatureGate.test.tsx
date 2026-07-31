import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeatureGate } from '../FeatureGate';
import { useEntitlements } from '../../../hooks/useEntitlements';
import { AuthContext } from '../../../context/AuthContext';
import { reportPaywallHit } from '../../../lib/paywall-report';

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: vi.fn(),
}));

vi.mock('../../../lib/paywall-report', () => ({
  reportPaywallHit: vi.fn(),
}));

const mockedUseEntitlements = vi.mocked(useEntitlements);
const mockedReportPaywallHit = vi.mocked(reportPaywallHit);

function renderWithWorkspace(ui: ReactElement, workspaceId: string | null) {
  const authValue = workspaceId ? ({ profile: { conta_id: workspaceId } } as never) : null;
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

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
  mockedReportPaywallHit.mockReset();
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

  it('reports the paywall hit once a workspace is known and the feature is locked', () => {
    setEntitlements({ enabledFlag: 'feature_on' });
    renderWithWorkspace(
      <FeatureGate flag="feature_off" label="Leads">
        <span>inside</span>
      </FeatureGate>,
      'ws-1',
    );
    expect(mockedReportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_off',
    });
  });

  it('does not report when there is no AuthContext workspace to attribute the hit to', () => {
    setEntitlements({ enabledFlag: 'feature_on' });
    renderWithWorkspace(
      <FeatureGate flag="feature_off" label="Leads">
        <span>inside</span>
      </FeatureGate>,
      null,
    );
    expect(mockedReportPaywallHit).not.toHaveBeenCalled();
  });

  it('reports an upgrade click as a distinct, always-sent signal', () => {
    setEntitlements({ enabledFlag: 'feature_on' });
    renderWithWorkspace(
      <FeatureGate flag="feature_off" label="Leads">
        <span>inside</span>
      </FeatureGate>,
      'ws-1',
    );
    mockedReportPaywallHit.mockClear();
    fireEvent.click(screen.getByText('Fazer upgrade'));
    expect(mockedReportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_off',
      clickedUpgrade: true,
    });
  });
});
