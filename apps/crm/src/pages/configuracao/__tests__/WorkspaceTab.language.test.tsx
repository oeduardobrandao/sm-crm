import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, storeMock, changeLanguageMock, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(),
    updateWorkspace: vi.fn(async () => {}),
    setWorkspaceLanguage: vi.fn(),
  },
  changeLanguageMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../store', () => storeMock);
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@mesaas/i18n', async (orig) => ({
  ...(await orig<typeof import('@mesaas/i18n')>()),
  changeLanguage: changeLanguageMock,
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({}) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }),
  },
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
// Radix Select needs pointer APIs jsdom lacks; a native select keeps the test on behavior.
vi.mock('@/components/ui/select', () => {
  const React = require('react');
  return {
    Select: ({ value, onValueChange, disabled, children }: any) =>
      React.createElement(
        'select',
        {
          'aria-label': 'Idioma do workspace',
          value,
          disabled,
          onChange: (e: any) => onValueChange(e.target.value),
        },
        children,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => children,
    SelectItem: ({ value, children }: any) => React.createElement('option', { value }, children),
  };
});

import WorkspaceTab from '../tabs/WorkspaceTab';

function renderTab(role: 'owner' | 'admin') {
  useAuthMock.mockReturnValue({
    profile: { id: 'u1', conta_id: 'ws-1' },
    role,
    can: makeCan(fakeMembership({ role })),
    membership: fakeMembership({ role }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkspaceTab language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'WS',
      logo_url: null,
      language: 'pt',
    });
  });

  it('owner sees an enabled select', async () => {
    renderTab('owner');
    const select = await screen.findByLabelText('Idioma do workspace');
    expect(select).toBeEnabled();
    expect(select).toHaveValue('pt');
  });

  it('admin sees read-only value', async () => {
    renderTab('admin');
    await screen.findByText('Português (Brasil)');
    expect(screen.queryByLabelText('Idioma do workspace')).toBeNull();
  });

  it('choosing English calls the RPC and switches the UI', async () => {
    storeMock.setWorkspaceLanguage.mockResolvedValue('en');
    renderTab('owner');
    const select = await screen.findByLabelText('Idioma do workspace');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => expect(storeMock.setWorkspaceLanguage).toHaveBeenCalledWith('en'));
    await waitFor(() => expect(changeLanguageMock).toHaveBeenCalledWith('en'));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('RPC failure shows an error toast and keeps the old value', async () => {
    storeMock.setWorkspaceLanguage.mockRejectedValue(new Error('42501'));
    renderTab('owner');
    const select = await screen.findByLabelText('Idioma do workspace');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(changeLanguageMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Idioma do workspace')).toHaveValue('pt');
  });
});
