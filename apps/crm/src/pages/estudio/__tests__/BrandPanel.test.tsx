import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const importBrandLogo = vi.fn();
vi.mock('../hooks/usePostDesignQuery', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePostDesignQuery')>(
    '../hooks/usePostDesignQuery',
  );
  return {
    ...actual,
    importBrandLogo: (...args: unknown[]) =>
      (importBrandLogo as (...a: unknown[]) => unknown)(...args),
  };
});

const useFileUrl = vi.fn(() => ({ data: 'https://signed.example/logo.png' }));
vi.mock('../hooks/useImageUrls', () => ({
  useFileUrl: (...args: unknown[]) => useFileUrl(...(args as [])),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { BrandPanel, importLogoReasonKey } from '../components/Dock/BrandPanel';
import type { PostBrand } from '../hooks/usePostBrand';

function makeBrand(overrides: Partial<PostBrand> = {}): PostBrand {
  return {
    clienteId: 7,
    brand: { cliente_id: 7 },
    brandColors: ['#eab308', '#12151a'],
    brandFonts: [
      { raw: 'Playfair', key: 'playfair-display' },
      { raw: 'Comic Sans MS', key: null },
    ],
    logoFileId: null,
    logoUrl: null,
    ...overrides,
  };
}

function renderPanel(
  brand: PostBrand,
  props: Partial<React.ComponentProps<typeof BrandPanel>> = {},
) {
  const onApplyColor = vi.fn();
  const onApplyFont = vi.fn();
  const onInsertLogo = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <BrandPanel
        brand={brand}
        selectedLayerType="text"
        onApplyColor={onApplyColor}
        onApplyFont={onApplyFont}
        onInsertLogo={onInsertLogo}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onApplyColor, onApplyFont, onInsertLogo, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  useFileUrl.mockReturnValue({ data: 'https://signed.example/logo.png' });
});

describe('importLogoReasonKey', () => {
  it('groups the /brand-logo reasons by user remedy', () => {
    expect(importLogoReasonKey('no_logo_url')).toBe('brandPanel.importReason.noLogoUrl');
    expect(importLogoReasonKey('not_https')).toBe('brandPanel.importReason.invalidUrl');
    expect(importLogoReasonKey('private_address')).toBe('brandPanel.importReason.blocked');
    expect(importLogoReasonKey('timeout')).toBe('brandPanel.importReason.unreachable');
    expect(importLogoReasonKey('too_large')).toBe('brandPanel.importReason.tooLarge');
    expect(importLogoReasonKey('quota_exceeded')).toBe('brandPanel.importReason.quota');
    expect(importLogoReasonKey('anything_else')).toBe('brandPanel.importReason.generic');
  });
});

describe('BrandPanel', () => {
  it('renders the empty state when the client has no brand row', () => {
    renderPanel(makeBrand({ brand: null }));
    expect(screen.getByText(/nenhuma marca cadastrada/i)).toBeInTheDocument();
    expect(screen.queryByText('Cores')).not.toBeInTheDocument();
  });

  it('applies a brand color to the selected layer', () => {
    const { onApplyColor } = renderPanel(makeBrand());
    fireEvent.click(screen.getByRole('button', { name: '#eab308' }));
    expect(onApplyColor).toHaveBeenCalledWith('#eab308');
  });

  it('disables color apply when no text/shape layer is selected', () => {
    const { onApplyColor } = renderPanel(makeBrand(), { selectedLayerType: null });
    const swatch = screen.getByRole('button', { name: '#eab308' });
    expect(swatch).toBeDisabled();
    fireEvent.click(swatch);
    expect(onApplyColor).not.toHaveBeenCalled();
    expect(screen.getByText(/selecione um texto ou forma/i)).toBeInTheDocument();
  });

  it('matched brand font shows Aplicar → onApplyFont; unmatched shows the not-included note', () => {
    const { onApplyFont } = renderPanel(makeBrand());
    expect(screen.getByText('Playfair Display')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApplyFont).toHaveBeenCalledWith('playfair-display');
    expect(screen.getByText('Comic Sans MS')).toBeInTheDocument();
    expect(screen.getByText(/não incluída no Estúdio/i)).toBeInTheDocument();
  });

  it('materialized logo: shows the thumbnail and inserts via onInsertLogo', () => {
    const { onInsertLogo } = renderPanel(makeBrand({ logoFileId: 501 }));
    expect(screen.getByRole('img', { name: 'Logo' })).toHaveAttribute(
      'src',
      'https://signed.example/logo.png',
    );
    fireEvent.click(screen.getByTestId('estudio-brand-insert-logo'));
    expect(onInsertLogo).toHaveBeenCalledTimes(1);
    expect(onInsertLogo.mock.calls[0][0]).toBe(501);
  });

  it('logo_url only: Importar logo calls the route, invalidates the SHARED hub-brand key on success', async () => {
    importBrandLogo.mockResolvedValue({ logo_file_id: 88 });
    const { invalidateSpy } = renderPanel(makeBrand({ logoUrl: 'https://cdn.example.com/l.png' }));
    fireEvent.click(screen.getByTestId('estudio-brand-import-logo'));
    await waitFor(() => expect(importBrandLogo).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-brand-crm', 7] }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('a soft-fail reason surfaces as a translated error toast, no invalidation', async () => {
    importBrandLogo.mockResolvedValue({ logo_file_id: null, reason: 'too_large' });
    const { invalidateSpy } = renderPanel(makeBrand({ logoUrl: 'https://cdn.example.com/l.png' }));
    fireEvent.click(screen.getByTestId('estudio-brand-import-logo'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/5 MB/);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('neither file nor URL: renders the no-logo empty state', () => {
    renderPanel(makeBrand());
    expect(screen.getByText(/nenhum logo cadastrado/i)).toBeInTheDocument();
    expect(screen.queryByTestId('estudio-brand-import-logo')).not.toBeInTheDocument();
  });
});
