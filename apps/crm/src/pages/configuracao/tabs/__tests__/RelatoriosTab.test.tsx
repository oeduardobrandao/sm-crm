import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
      <RelatoriosTab />
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

  it('seeds the accent picker from the saved brand colour', async () => {
    renderTab();
    await waitFor(() => {
      const el = document.querySelector('input[type="color"]') as HTMLInputElement;
      expect(el.value).toBe('#111111');
    });
  });

  it('saves the accent colour and e-mail toggle via updateWorkspaceBranding', async () => {
    renderTab();

    const colorInput = await waitFor(() => {
      const el = document.querySelector('input[type="color"]') as HTMLInputElement;
      expect(el.value).toBe('#111111');
      return el;
    });

    fireEvent.change(colorInput, { target: { value: '#abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(storeMock.updateWorkspaceBranding).toHaveBeenCalledWith({
        brand_color: '#abcdef',
        send_report_email: false,
      });
    });
  });

  it('keeps an unsaved accent-colour edit after a splash upload', async () => {
    renderTab();

    // Wait for the branding query to load and seed the colour picker.
    const colorInput = await waitFor(() => {
      const el = document.querySelector('input[type="color"]') as HTMLInputElement;
      expect(el.value).toBe('#111111');
      return el;
    });

    // User picks a new accent colour but has NOT pressed "Salvar" yet.
    fireEvent.change(colorInput, { target: { value: '#abcdef' } });
    expect(colorInput.value).toBe('#abcdef');

    // User uploads cover art before saving.
    const splashInput = document.querySelector(
      'input[type="file"][accept="image/jpeg,image/png,image/webp"]',
    ) as HTMLInputElement;
    const file = new File(['x'], 'capa.png', { type: 'image/png' });
    fireEvent.change(splashInput, { target: { files: [file] } });

    // Wait for the upload flow to complete (splash preview image appears).
    await screen.findByAltText('Arte da capa');

    // The unsaved accent-colour edit must survive the upload.
    expect(colorInput.value).toBe('#abcdef');
  });
});
