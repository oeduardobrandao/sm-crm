import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(),
    getHubBranding: vi.fn(),
    updateHubBranding: vi.fn(),
  },
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));

vi.mock('../../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../../store', () => storeMock);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://cdn.example.com/logo-dark.png' },
        })),
      }),
    },
  },
}));

let mockEntitlements: {
  hasFeature: (f: string) => boolean;
  isLoading: boolean;
  features?: Record<string, boolean>;
} = { hasFeature: () => true, isLoading: false };
vi.mock('../../../../hooks/useEntitlements', () => ({
  useEntitlements: () => mockEntitlements,
}));

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

// Same stub as HubTab.test.tsx, plus the device the preview opens on.
vi.mock('../../HubPreview', () => ({
  HubPreview: ({
    draft,
    look,
    initialDevice,
  }: {
    draft: { brandColor: string; surface: string };
    look?: string;
    initialDevice?: string;
  }) => (
    <div data-testid="hub-preview-stub" data-look={look} data-initial-device={initialDevice}>
      {draft.brandColor} {draft.surface}
    </div>
  ),
  HUB_DISPLAY_FONTS: {
    fraunces: { label: 'Fraunces', css: 'serif', gf: 'Fraunces' },
    sora: { label: 'Sora', css: 'sans-serif', gf: 'Sora' },
  },
  HUB_BODY_FONTS: {
    'instrument-sans': { label: 'Instrument Sans', css: 'sans-serif', gf: 'Instrument+Sans' },
    manrope: { label: 'Manrope', css: 'sans-serif', gf: 'Manrope' },
  },
}));

import HubTab from '../HubTab';

const BRANDING = {
  brand_color: '#111111',
  hub_surface_theme: 'neutral',
  hub_font_display: 'fraunces',
  hub_font_body: 'instrument-sans',
  hub_radius: 'soft',
  hub_card_style: 'filled',
  hub_logo_style: 'round',
  hub_logo_dark_url: null as string | null,
  hub_hide_branding: false,
  hub_default_appearance: 'light',
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HubTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ready() {
  await screen.findByRole('button', { name: /Cor da marca/ });
  await waitFor(() => expect(screen.getByText('#111111')).toBeInTheDocument());
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
}

describe('HubTab on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ role: 'owner', can: () => true });
    mockEntitlements = { hasFeature: () => true, isLoading: false };
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
    storeMock.getHubBranding.mockResolvedValue({ ...BRANDING });
    storeMock.updateHubBranding.mockResolvedValue(undefined);
  });

  it('renders the Hub screen: nav bar, title, preview row and the five sections with values', async () => {
    renderTab();
    await ready();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Hub' })).toBeInTheDocument();
    expect(screen.getByText('Como o Hub aparece para os seus clientes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pré-visualização ao vivo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aparência.*Neutro · Claro/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Componentes.*Suave · Preenchido/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Identidade.*Redondo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tipografia/ })).toBeInTheDocument();
    // The desktop form (and its preview) is not mounted on phones.
    expect(screen.queryByText('Personalizar Hub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hub-preview-stub')).not.toBeInTheDocument();
  });

  it('the preview row opens a sheet with HubPreview on the Celular device, fed by the draft', async () => {
    renderTab();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualização ao vivo/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pré-visualização ao vivo' });
    const preview = within(sheet).getByTestId('hub-preview-stub');
    expect(preview).toHaveAttribute('data-initial-device', 'mobile');
    expect(preview).toHaveTextContent('#111111 neutral');
  });

  it('Aparência: opens as a pushed screen, a pick reaches the list and the save payload', async () => {
    renderTab();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Aparência' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quente' }));
    expect(screen.getByRole('button', { name: 'Quente' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Hub' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Hub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aparência.*Quente · Escuro/ })).toBeInTheDocument();

    save();
    await waitFor(() =>
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ hub_surface_theme: 'warm', hub_default_appearance: 'dark' }),
      ),
    );
  });

  it('Componentes: Salvar on the sub-screen saves the picks through the same store call', async () => {
    renderTab();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Componentes/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Componentes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pílula' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contorno' }));
    save();
    await waitFor(() =>
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ hub_radius: 'pill', hub_card_style: 'outline' }),
      ),
    );
  });

  it('Cor da marca: a preset lands in the list value and the payload', async () => {
    renderTab();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Cor da marca/ }));
    expect(screen.getByLabelText('Cor em hexadecimal')).toHaveValue('#111111');
    fireEvent.click(screen.getByRole('button', { name: '#42c8f5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Hub' }));
    expect(screen.getByText('#42C8F5')).toBeInTheDocument();
    save();
    await waitFor(() =>
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ brand_color: '#42c8f5' }),
      ),
    );
  });

  it('the powered-by switch toggles the same state the save sends', async () => {
    renderTab();
    await ready();
    const toggle = screen.getByRole('switch', { name: 'Ocultar "powered by mesaas"' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    save();
    await waitFor(() =>
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ hub_hide_branding: true }),
      ),
    );
  });

  it('Identidade: removing the dark logo confirms in an action sheet and runs the desktop handler', async () => {
    storeMock.getHubBranding.mockResolvedValue({
      ...BRANDING,
      hub_logo_dark_url: 'https://cdn.example.com/dark.png',
    });
    renderTab();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Identidade/ }));
    expect(screen.getByAltText('Logo para modo escuro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar logo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Remover a logo para modo escuro?',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith({ hub_logo_dark_url: null }),
    );
    await waitFor(() =>
      expect(screen.queryByAltText('Logo para modo escuro')).not.toBeInTheDocument(),
    );
  });

  it('keeps the feature_brand_customization gates: gated sections show the upsell, Cor da marca does not', async () => {
    mockEntitlements = { hasFeature: () => false, isLoading: false };
    renderTab();
    await ready();
    expect(screen.queryByRole('switch', { name: /powered by mesaas/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    expect(
      screen.getByText('Personalização do Hub não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quente' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Hub' }));
    fireEvent.click(screen.getByRole('button', { name: /Cor da marca/ }));
    expect(screen.getByLabelText('Cor em hexadecimal')).toBeInTheDocument();
  });

  it('a view-only role sees the controls disabled and Salvar off', async () => {
    useAuthMock.mockReturnValue({
      role: 'agent',
      can: (_m: string, action: string) => action === 'ver',
    });
    renderTab();
    await ready();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Componentes/ }));
    expect(screen.getByRole('button', { name: 'Pílula' })).toBeDisabled();
  });
});
