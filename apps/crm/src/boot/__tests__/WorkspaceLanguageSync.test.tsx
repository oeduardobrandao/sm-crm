import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, effectiveLanguage, setActiveWorkspaceLanguage } from '@mesaas/i18n';

const getCurrentWorkspace = vi.fn();
vi.mock('@/store/workspace', () => ({
  getCurrentWorkspace: (...a: unknown[]) => getCurrentWorkspace(...a),
}));

import { WorkspaceLanguageSync } from '../WorkspaceLanguageSync';

function renderSync() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceLanguageSync />
    </QueryClientProvider>,
  );
}

describe('WorkspaceLanguageSync', () => {
  afterEach(async () => {
    localStorage.clear();
    setActiveWorkspaceLanguage(null);
    getCurrentWorkspace.mockReset();
    await i18n.changeLanguage('pt');
  });

  it('en workspace with no explicit choice renders English', async () => {
    getCurrentWorkspace.mockResolvedValue({ id: 'w', name: 'W', logo_url: null, language: 'en' });
    renderSync();
    await waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('explicit pt wins over en workspace', async () => {
    changeLanguage('pt');
    getCurrentWorkspace.mockResolvedValue({ id: 'w', name: 'W', logo_url: null, language: 'en' });
    renderSync();
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('pt');
  });

  it('is a no-op without a workspace', async () => {
    getCurrentWorkspace.mockResolvedValue(null);
    renderSync();
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('pt');
  });

  it('clears the workspace language on unmount', async () => {
    getCurrentWorkspace.mockResolvedValue({ id: 'w', name: 'W', logo_url: null, language: 'en' });
    const { unmount } = renderSync();
    await waitFor(() => expect(effectiveLanguage()).toBe('en'));
    unmount();
    expect(effectiveLanguage()).toBe('pt');
  });
});
