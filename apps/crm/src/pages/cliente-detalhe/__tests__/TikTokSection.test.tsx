import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// TikTokSection is the testable seam for the feature_tiktok gate: it is a
// standalone component (unlike InstagramSection, which stays inline in
// ClienteDetalhePage.tsx) specifically so this gate is assertable in isolation.

let mockFeatures: { feature_tiktok?: boolean } | null | undefined = { feature_tiktok: false };

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

const { getTikTokSummaryMock } = vi.hoisted(() => ({ getTikTokSummaryMock: vi.fn() }));

vi.mock('../../../services/tiktok', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tiktok')>();
  return {
    ...actual,
    getTikTokSummary: (...args: unknown[]) => getTikTokSummaryMock(...args),
  };
});

import { TikTokSection } from '../TikTokSection';

function renderSection(clienteId = 1) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TikTokSection clienteId={clienteId} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockFeatures = { feature_tiktok: false };
});

describe('TikTokSection — feature_tiktok gate', () => {
  it('renders nothing and fetches nothing when feature_tiktok is off', () => {
    mockFeatures = { feature_tiktok: false };
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(getTikTokSummaryMock).not.toHaveBeenCalled();
  });

  it('renders nothing while entitlements are still loading (features undefined)', () => {
    mockFeatures = undefined;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(getTikTokSummaryMock).not.toHaveBeenCalled();
  });

  it('fetches the summary and renders the connect button once feature_tiktok is on', async () => {
    mockFeatures = { feature_tiktok: true };
    getTikTokSummaryMock.mockResolvedValue(null);
    const { container } = renderSection(7);

    await waitFor(() => expect(getTikTokSummaryMock).toHaveBeenCalledWith(7));
    await waitFor(() => expect(container.querySelector('#btn-tt-connect')).not.toBeNull());
  });
});
