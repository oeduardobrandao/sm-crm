import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(async () => ({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    })),
    updateWorkspace: vi.fn(async () => {}),
    getWorkspaceBranding: vi.fn(async () => ({
      brand_color: '#111111',
      report_splash_url: null,
      send_report_email: false,
    })),
    updateWorkspaceBranding: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', () => storeMock);

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://cdn.example.com/report-splash.jpg' },
        })),
      }),
    },
  },
}));

vi.mock('../../reportSplash', () => ({
  downscaleImage: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
}));

vi.mock('../../ReportPreview', () => ({
  ReportPreview: () => <div data-testid="report-preview" />,
}));

import RelatoriosTab from '../RelatoriosTab';

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RelatoriosTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RelatoriosTab — report branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', email: 'ana@exemplo.com' },
      profile: { id: 'user-1', nome: 'Ana' },
      role: 'owner',
      signOut: vi.fn(),
      refetchProfile: vi.fn(),
    });
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
    storeMock.getWorkspaceBranding.mockResolvedValue({
      brand_color: '#111111',
      report_splash_url: null,
      send_report_email: false,
    });
    storeMock.updateWorkspace.mockResolvedValue(undefined);
    storeMock.updateWorkspaceBranding.mockResolvedValue(undefined);
  });

  it('shows the saved brand colour as a read-only swatch, with a link to Configurações · Hub', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('#111111')).toBeInTheDocument();
    });
    // No editable colour control left on this tab (native picker, ColorPicker, etc).
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const link = screen.getByRole('link', { name: /editar em configurações · hub/i });
    expect(link).toHaveAttribute('href', '/configuracao/hub');
  });

  it('saves only the e-mail toggle via updateWorkspaceBranding, never brand_color', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('#111111')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(storeMock.updateWorkspaceBranding).toHaveBeenCalledWith({
        send_report_email: false,
      });
    });
  });

  it('refuses to save when the branding query failed, instead of writing defaults', async () => {
    storeMock.getWorkspaceBranding.mockRejectedValue(new Error('column does not exist'));
    renderTab();

    const salvar = await screen.findByRole('button', { name: /salvar/i });
    await waitFor(() => expect(salvar).toBeDisabled());

    fireEvent.click(salvar);
    expect(storeMock.updateWorkspaceBranding).not.toHaveBeenCalled();
    expect(screen.getByText(/não foi possível carregar as configurações/i)).toBeTruthy();
  });

  it('the preview still gets a colour, read from the shared workspace-branding query', async () => {
    renderTab();
    // ReportPreview itself is mocked out below — this only pins that RelatoriosTab
    // keeps resolving accentColor from `branding`, the query HubTab's save
    // invalidates, instead of a local draft this tab no longer owns.
    await waitFor(() => {
      expect(screen.getByText('#111111')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-preview')).toBeInTheDocument();
  });
});
