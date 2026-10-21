import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// No useIsDesktop mock: jsdom's matchMedia never matches, so the tab renders its phone branch.

const { useAuthMock, useWorkspaceLimitsMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useWorkspaceLimitsMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(),
    updateWorkspace: vi.fn(async () => {}),
    getWorkspaceBranding: vi.fn(),
    updateWorkspaceBranding: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: useWorkspaceLimitsMock,
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
vi.mock('../ReportTemplatesCard', () => ({
  ReportTemplatesCard: () => <div data-testid="report-templates-card" />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
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

describe('RelatoriosTab on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'owner' })) });
    useWorkspaceLimitsMock.mockReturnValue({
      features: { feature_analytics_reports: true },
      isLoading: false,
      isUnlimited: false,
    });
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
    storeMock.getWorkspaceBranding.mockResolvedValue({
      brand_color: '#111111',
      report_splash_url: 'https://cdn.example.com/old.jpg',
      send_report_email: false,
    });
  });

  it('renders the screen title, the brand colour row linking to Hub and the templates list', async () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeInTheDocument();
    await screen.findByText('#111111');
    expect(screen.getByTestId('relatorios-brand-color')).toHaveAttribute(
      'href',
      '/configuracao/hub',
    );
    expect(screen.getByTestId('report-templates-card')).toBeInTheDocument();
    // The desktop card never mounts on phones.
    expect(screen.queryByText('Relatório Mensal')).not.toBeInTheDocument();
  });

  it('cover art: the action sheet opens the same file picker, and an upload saves it', async () => {
    const { container } = renderTab();
    await screen.findByText('Arte enviada');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    fireEvent.click(screen.getByRole('button', { name: /arte da capa/i }));
    const sheet = await screen.findByRole('dialog', { name: 'Arte da capa' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Substituir arte' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File(['img'], 'capa.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(storeMock.updateWorkspace).toHaveBeenCalledWith('ws-1', {
        report_splash_url: expect.stringContaining('https://cdn.example.com/report-splash.jpg'),
      }),
    );
  });

  it('cover art: Remover asks with the desktop copy and clears the art on confirm', async () => {
    renderTab();
    await screen.findByText('Arte enviada');
    fireEvent.click(screen.getByRole('button', { name: /arte da capa/i }));
    const sheet = await screen.findByRole('dialog', { name: 'Arte da capa' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remover arte' }));

    const confirm = await screen.findByRole('dialog', { name: 'Remover a arte da capa?' });
    expect(
      within(confirm).getByText(/A capa dos próximos relatórios volta a ser apenas tipográfica/),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover arte' }));

    await waitFor(() =>
      expect(storeMock.updateWorkspace).toHaveBeenCalledWith('ws-1', { report_splash_url: null }),
    );
    expect(await screen.findByText('Apenas tipográfica')).toBeInTheDocument();
  });

  it('the e-mail switch feeds the nav bar Salvar, which saves through updateWorkspaceBranding', async () => {
    renderTab();
    const toggle = await screen.findByRole('switch', { name: 'Enviar relatórios por e-mail' });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(storeMock.updateWorkspaceBranding).toHaveBeenCalledWith({ send_report_email: true }),
    );
  });

  it('blocks Salvar and shows the alert when the branding query failed', async () => {
    storeMock.getWorkspaceBranding.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível carregar as configurações de relatório/,
    );
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('opens the preview in a sheet', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /pré-visualização/i }));
    const sheet = await screen.findByRole('dialog', { name: 'Prévia' });
    expect(within(sheet).getByTestId('report-preview')).toBeInTheDocument();
  });
});
