import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HubPreview, type HubPreviewDraft } from '../HubPreview';

const BASE_DRAFT: HubPreviewDraft = {
  brandColor: '#eab308',
  surface: 'neutral',
  fontDisplay: 'fraunces',
  fontBody: 'instrument-sans',
  radius: 'soft',
  cardStyle: 'filled',
  logoStyle: 'round',
  logoDarkUrl: null,
  hideBranding: false,
  defaultAppearance: 'light',
};

function renderPreview(overrides: Partial<HubPreviewDraft> = {}, customized = true) {
  return render(
    <HubPreview
      draft={{ ...BASE_DRAFT, ...overrides }}
      workspaceName="Agência Teste"
      workspaceLogoUrl="https://cdn.example.com/logo.png"
      customized={customized}
    />,
  );
}

afterEach(() => {
  document.getElementById('crm-hub-preview-fonts')?.remove();
});

describe('HubPreview', () => {
  it('resolves the warm surface in dark mode to the real resolver bg (pinning the integration)', () => {
    renderPreview({ surface: 'warm', defaultAppearance: 'dark' });
    const wrapper = screen.getByTestId('hub-preview-wrapper');
    expect(wrapper.style.getPropertyValue('--hub-bg')).toBe('#151210');
  });

  it('renders a non-circular logo image when logoStyle is wordmark', () => {
    renderPreview({ logoStyle: 'wordmark' });
    const img = screen.getByTestId('preview-logo') as HTMLImageElement;
    expect(img.style.borderRadius).not.toBe('50%');
  });

  it('renders a circular logo image when logoStyle is round', () => {
    renderPreview({ logoStyle: 'round' });
    const img = screen.getByTestId('preview-logo') as HTMLImageElement;
    expect(img.style.borderRadius).toBe('50%');
  });

  it('hides the powered-by line when hideBranding is true', () => {
    renderPreview({ hideBranding: true });
    expect(screen.queryByText(/powered by mesaas/i)).not.toBeInTheDocument();
  });

  it('shows the powered-by line when hideBranding is false', () => {
    renderPreview({ hideBranding: false });
    expect(screen.getByText(/powered by mesaas/i)).toBeInTheDocument();
  });

  it('renders the neutral default bg when the workspace is not entitled, regardless of the draft surface pick', () => {
    renderPreview({ surface: 'cool' }, false);
    const wrapper = screen.getByTestId('hub-preview-wrapper');
    expect(wrapper.style.getPropertyValue('--hub-bg')).toBe('#FAFAFA');
  });

  it('still applies the brand_color accent when un-entitled (accent editing is ungated)', () => {
    renderPreview({ brandColor: '#3984ff' }, false);
    const wrapper = screen.getByTestId('hub-preview-wrapper');
    expect(wrapper.style.getPropertyValue('--hub-acc').toLowerCase()).toBe('#3984ff');
  });

  it('loads the picked Google Fonts href into a dedicated link tag', () => {
    renderPreview({ fontDisplay: 'sora', fontBody: 'manrope' });
    const link = document.getElementById('crm-hub-preview-fonts') as HTMLLinkElement;
    expect(link).toBeTruthy();
    expect(link.href).toContain('Sora');
    expect(link.href).toContain('Manrope');
  });

  it('removes the font link when both fonts are the defaults', () => {
    renderPreview({ fontDisplay: 'fraunces', fontBody: 'instrument-sans' });
    expect(document.getElementById('crm-hub-preview-fonts')).toBeNull();
  });

  it('defaults the light/dark toggle from hub_default_appearance', () => {
    renderPreview({ surface: 'warm', defaultAppearance: 'dark' });
    const wrapper = screen.getByTestId('hub-preview-wrapper');
    // dark warm bg pins the same value asserted in the first test — confirms the
    // toggle actually started dark instead of defaulting to light.
    expect(wrapper.style.getPropertyValue('--hub-bg')).toBe('#151210');
    expect(screen.getByRole('button', { name: 'Escuro' })).toHaveAttribute('aria-pressed', 'true');
  });
});
