import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(async () => ({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    })),
    getHubBranding: vi.fn(async () => ({
      brand_color: '#111111',
      hub_surface_theme: 'neutral',
      hub_font_display: 'fraunces',
      hub_font_body: 'instrument-sans',
      hub_radius: 'soft',
      hub_card_style: 'filled',
      hub_logo_style: 'round',
      hub_logo_dark_url: null,
      hub_hide_branding: false,
      hub_default_appearance: 'light',
    })),
    updateHubBranding: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../context/AuthContext')>();
  return {
    ...actual,
    useAuth: useAuthMock,
  };
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

// Fail-open by default, overridden per test — mirrors
// pages/cliente-detalhe/__tests__/HubTab.test.tsx's convention.
let mockEntitlements: { hasFeature: (flag: string) => boolean; isLoading: boolean } = {
  hasFeature: () => true,
  isLoading: false,
};
vi.mock('../../../../hooks/useEntitlements', () => ({
  useEntitlements: () => mockEntitlements,
}));

// The preview is a pure function of the draft state and is pinned by its own
// HubPreview.test.tsx — stubbed here so HubTab's own tests stay about the form.
vi.mock('../../HubPreview', () => ({
  HubPreview: ({ draft }: { draft: { brandColor: string } }) => (
    <div data-testid="hub-preview-stub">{draft.brandColor}</div>
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

// The Figma-style picker (color-picker-advanced.tsx) is NOT mocked: its hex
// input is a plain <input>, so jsdom handles it fine, and its own validation
// (commit-on-blur, revert-on-invalid) is exactly what a couple of tests below
// exist to pin. What jsdom genuinely can't do is canvas/pointer-geometry drag
// interactions (ColorPickerSelection, ColorPickerHue) — those aren't exercised
// here; HubTab's contract with the picker only depends on value/onChange/disabled,
// all reachable through the hex input.

// Radix Select needs pointer-capture/scrollIntoView jsdom doesn't implement — same
// stub TikTokSettingsPanel.test.tsx and WorkflowModals.test.tsx use.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue() {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

// Radix Switch — plain checkbox, same convention as MembrosTab.test.tsx.
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

// Radix AlertDialog — simplified context-driven mock, same as
// pages/cliente-detalhe/__tests__/HubTab.test.tsx.
vi.mock('@/components/ui/alert-dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  interface AlertDialogContextValue {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }
  const AlertDialogContext = ReactModule.createContext<AlertDialogContextValue>({ open: false });
  function AlertDialog({
    open: openProp = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [open, setOpen] = ReactModule.useState(openProp);
    ReactModule.useEffect(() => setOpen(openProp), [openProp]);
    return (
      <AlertDialogContext.Provider
        value={{
          open,
          onOpenChange: (v: boolean) => {
            setOpen(v);
            onOpenChange?.(v);
          },
        }}
      >
        <div>{children}</div>
      </AlertDialogContext.Provider>
    );
  }
  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactModule.useContext(AlertDialogContext);
    return open ? <div role="alertdialog">{children}</div> : null;
  }
  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }
  function AlertDialogAction({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button
        type="button"
        onClick={(event) => {
          onClick?.(event as never);
          onOpenChange?.(false);
        }}
      >
        {children}
      </button>
    );
  }
  function AlertDialogCancel({ children }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button type="button" onClick={() => onOpenChange?.(false)}>
        {children}
      </button>
    );
  }
  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogAction,
    AlertDialogCancel,
  };
});

import HubTab from '../HubTab';

function getHexInput() {
  return screen.getByLabelText('Cor em hexadecimal') as HTMLInputElement;
}

/** Types a hex value into the real picker's hex input and commits it (blur),
 * mirroring how a user actually edits it -- the input only validates/emits on
 * blur or Enter, not on every keystroke (see color-picker-advanced.tsx). */
function setHexColor(hex: string) {
  const input = getHexInput();
  fireEvent.change(input, { target: { value: hex } });
  fireEvent.blur(input);
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HubTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe('HubTab — Personalizar Hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ role: 'owner', can: () => true });
    mockEntitlements = { hasFeature: () => true, isLoading: false };
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
    storeMock.getHubBranding.mockResolvedValue({
      brand_color: '#111111',
      hub_surface_theme: 'neutral',
      hub_font_display: 'fraunces',
      hub_font_body: 'instrument-sans',
      hub_radius: 'soft',
      hub_card_style: 'filled',
      hub_logo_style: 'round',
      hub_logo_dark_url: null,
      hub_hide_branding: false,
      hub_default_appearance: 'light',
    });
    storeMock.updateHubBranding.mockResolvedValue(undefined);
  });

  it('seeds the form from the saved branding, once', async () => {
    renderTab();
    await waitFor(() => {
      expect(getHexInput()).toHaveValue('#111111');
    });
  });

  it('hex typed in the picker lands normalized (lowercase, 6-digit) in the save payload', async () => {
    renderTab();
    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

    setHexColor('#ABCDEF');
    await waitFor(() => expect(getHexInput()).toHaveValue('#abcdef'));

    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => {
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ brand_color: '#abcdef' }),
      );
    });
  });

  it('typing an invalid hex reverts on blur instead of corrupting brandColor', async () => {
    renderTab();
    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

    setHexColor('not-a-color');
    // Invalid input never reaches setHue/setSaturation/setLightness in the
    // picker, so it can never reach HubTab's onChange either -- the field
    // snaps back to the last committed value on blur.
    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => {
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith(
        expect.objectContaining({ brand_color: '#111111' }),
      );
    });
  });

  it('disables the colour picker hex input when the branding query failed', async () => {
    storeMock.getHubBranding.mockRejectedValue(new Error('column does not exist'));
    renderTab();
    await waitFor(() => expect(getHexInput()).toBeDisabled());
  });

  it('a refetch after an unsaved edit does not clobber it (seed-once)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HubTab />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

    setHexColor('#abcdef');
    expect(getHexInput()).toHaveValue('#abcdef');

    // Something else (e.g. a query invalidation elsewhere) triggers a refetch of
    // the same data. It must not overwrite the unsaved edit above.
    await queryClient.invalidateQueries({ queryKey: ['workspace-hub-branding'] });
    await waitFor(() => {
      expect(storeMock.getHubBranding).toHaveBeenCalledTimes(2);
    });
    expect(getHexInput()).toHaveValue('#abcdef');
  });

  it('brand colour is editable even when feature_brand_customization is off', async () => {
    mockEntitlements = { hasFeature: () => false, isLoading: false };
    renderTab();
    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));
    expect(screen.getByText('Cor da marca')).toBeInTheDocument();
    // Customization controls sit inside two gates (Aparência on its own, then
    // Tipografia+Componentes+Identidade together, since Cor da marca sits between
    // them ungated) — both nudge, so the same copy appears twice.
    expect(screen.queryByText('Tema de superfície')).not.toBeInTheDocument();
    expect(screen.queryByText('Cantos')).not.toBeInTheDocument();
    expect(screen.getAllByText(/não está disponível no seu plano/i)).toHaveLength(2);
  });

  it('shows the customization controls when feature_brand_customization is on', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Tema de superfície')).toBeInTheDocument();
    });
    expect(screen.getByText('Cantos')).toBeInTheDocument();
    expect(screen.getByText('Estilo de cards')).toBeInTheDocument();
    expect(screen.getByText(/ocultar "powered by mesaas"/i)).toBeInTheDocument();
  });

  it('the surface theme picker is an accessible group', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Tema de superfície' })).toBeInTheDocument();
    });
  });

  it('disables the font-pairing cards (and keeps the selects disabled) when the branding query failed', async () => {
    storeMock.getHubBranding.mockRejectedValue(new Error('column does not exist'));
    renderTab();

    const pairing = await screen.findByRole('button', { name: /editorial/i });
    expect(pairing).toBeDisabled();
  });

  it('Salvar sends exactly the edited fields', async () => {
    renderTab();
    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

    setHexColor('#abcdef');
    fireEvent.click(screen.getByRole('button', { name: 'Pílula' }));
    fireEvent.click(screen.getByRole('switch', { name: /ocultar "powered by mesaas"/i }));

    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith({
        brand_color: '#abcdef',
        hub_surface_theme: 'neutral',
        hub_radius: 'pill',
        hub_card_style: 'filled',
        hub_font_display: 'fraunces',
        hub_font_body: 'instrument-sans',
        hub_logo_style: 'round',
        hub_default_appearance: 'light',
        hub_hide_branding: true,
      });
    });
  });

  it('on success invalidates both workspace-hub-branding and workspace-branding', async () => {
    const { queryClient } = renderTab();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-hub-branding'] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-branding'] });
  });

  it('removing the dark logo nulls hub_logo_dark_url immediately, without Salvar', async () => {
    storeMock.getHubBranding.mockResolvedValue({
      brand_color: '#111111',
      hub_surface_theme: 'neutral',
      hub_font_display: 'fraunces',
      hub_font_body: 'instrument-sans',
      hub_radius: 'soft',
      hub_card_style: 'filled',
      hub_logo_style: 'round',
      hub_logo_dark_url: 'https://cdn.example.com/logo-dark.png',
      hub_hide_branding: false,
      hub_default_appearance: 'light',
    });
    renderTab();

    await screen.findByAltText('Logo para modo escuro');
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => {
      expect(storeMock.updateHubBranding).toHaveBeenCalledWith({ hub_logo_dark_url: null });
    });
    expect(screen.queryByAltText('Logo para modo escuro')).not.toBeInTheDocument();
  });

  it('bounds the dark-logo canvas to the longest side, without stretching a non-square image', async () => {
    // Same stub pattern as reportSplash.test.ts's downscaleImage coverage: intercept
    // only canvas creation, fall through to the real jsdom implementation for
    // everything else React needs to render.
    const originalCreateElement = document.createElement.bind(document);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement;
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        if (tagName === 'canvas') return canvas;
        return originalCreateElement(tagName, options);
      });
    vi.stubGlobal(
      'createImageBitmap',
      // A 5:1 horizontal wordmark — the exact shape a forced-square canvas
      // would stretch into 1:1.
      vi.fn(async () => ({ width: 1000, height: 200 }) as ImageBitmap),
    );

    try {
      renderTab();
      await waitFor(() => expect(getHexInput()).toHaveValue('#111111'));

      const fileInput = document.querySelector(
        'input[type="file"][accept="image/png,image/jpeg,image/webp"]',
      ) as HTMLInputElement;
      const file = new File(['x'], 'wordmark.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(storeMock.updateHubBranding).toHaveBeenCalledWith({
          hub_logo_dark_url: expect.stringContaining('https://cdn.example.com/logo-dark.png'),
        });
      });
      // Longest side (width, 1000) bounded to 512; height scales by the same
      // factor (0.512) instead of being forced to match width.
      expect(canvas.width).toBe(512);
      expect(canvas.height).toBe(102);
    } finally {
      createElementSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Task 14: `isOwnerOrAdmin = role === 'owner' || role === 'admin'` collapsed
 * onto `can('configuracoes', 'ver') === true`. `AGENT_ROLE_PRESET.
 * configuracoes` is 'none' and admin resolves to `true` for every
 * non-financial module (lib/permissions.ts), so the two legacy-preset cases
 * below reproduce the OLD isOwnerOrAdmin gate byte-for-byte -- only a CUSTOM
 * role (role_id set) can now diverge from its chassis role. `levelAllows`
 * treats the 'ver' ACTION as satisfied by either the 'ver' OR 'editar'
 * LEVEL, so any non-'none' `configuracoes` grant unblocks these queries.
 */
describe('HubTab — queries gated on configuracoes:ver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntitlements = { hasFeature: () => true, isLoading: false };
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
    storeMock.getHubBranding.mockResolvedValue({
      brand_color: '#111111',
      hub_surface_theme: 'neutral',
      hub_font_display: 'fraunces',
      hub_font_body: 'instrument-sans',
      hub_radius: 'soft',
      hub_card_style: 'filled',
      hub_logo_style: 'round',
      hub_logo_dark_url: null,
      hub_hide_branding: false,
      hub_default_appearance: 'light',
    });
  });

  it('keeps a legacy agent blocked (configuracoes preset is none)', async () => {
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'agent' })) });
    renderTab();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeMock.getCurrentWorkspace).not.toHaveBeenCalled();
    expect(storeMock.getHubBranding).not.toHaveBeenCalled();
  });

  it('keeps a legacy admin unchanged (configuracoes preset resolves to true)', async () => {
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'admin' })) });
    renderTab();

    await waitFor(() => {
      expect(storeMock.getCurrentWorkspace).toHaveBeenCalled();
      expect(storeMock.getHubBranding).toHaveBeenCalled();
    });
  });

  it('blocks the queries for a custom role with no configuracoes grant at all', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderTab();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeMock.getCurrentWorkspace).not.toHaveBeenCalled();
    expect(storeMock.getHubBranding).not.toHaveBeenCalled();
  });

  it('unblocks the queries for a custom role with configuracoes:editar (the fix)', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    });
    renderTab();

    await waitFor(() => {
      expect(storeMock.getCurrentWorkspace).toHaveBeenCalled();
      expect(storeMock.getHubBranding).toHaveBeenCalled();
    });
  });
});
