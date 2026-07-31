import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('wordmark with no uploaded logo renders the workspace name as the mark', () => {
    render(
      <HubPreview
        draft={{ ...BASE_DRAFT, logoStyle: 'wordmark' }}
        workspaceName="Agência Teste"
        workspaceLogoUrl={null}
        customized
      />,
    );
    const mark = screen.getByTestId('preview-wordmark-name');
    expect(mark.textContent).toBe('Agência Teste');
    // The mark carries the name, so the separate sidebar name label is dropped.
    expect(screen.queryAllByText('Agência Teste')).toHaveLength(1);
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

  it('un-entitled: still shows the powered-by line even with a stored hideBranding:true', () => {
    // hub-bootstrap only honors hub_hide_branding when the workspace is entitled --
    // a downgraded workspace with the column still set true gets the mark forced
    // back on by the real hub, so the preview must not misrepresent that.
    renderPreview({ hideBranding: true }, false);
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

  it('un-entitled: ignores stored wordmark/dark-logo picks, always renders the round light logo', () => {
    // A downgraded workspace can still have wordmark + a dark logo URL sitting in
    // the row (nothing clears them on downgrade) -- the preview must not show a
    // portal the client can't actually get. Mirrors WorkspaceMark, which only
    // reads logo_style/logo_dark_url off hub_theme, itself null when hub-bootstrap
    // resolves the workspace as un-entitled.
    renderPreview(
      {
        logoStyle: 'wordmark',
        logoDarkUrl: 'https://cdn.example.com/dark-logo.png',
        defaultAppearance: 'dark',
      },
      false,
    );
    const img = screen.getByTestId('preview-logo') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.example.com/logo.png');
    expect(img.style.borderRadius).toBe('50%');
  });

  it('entitled: does use the wordmark style and dark logo in dark mode', () => {
    renderPreview(
      {
        logoStyle: 'wordmark',
        logoDarkUrl: 'https://cdn.example.com/dark-logo.png',
        defaultAppearance: 'dark',
      },
      true,
    );
    const img = screen.getByTestId('preview-logo') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.example.com/dark-logo.png');
    expect(img.style.borderRadius).not.toBe('50%');
  });

  it('defaults the light/dark toggle from hub_default_appearance', () => {
    renderPreview({ surface: 'warm', defaultAppearance: 'dark' });
    const wrapper = screen.getByTestId('hub-preview-wrapper');
    // dark warm bg pins the same value asserted in the first test — confirms the
    // toggle actually started dark instead of defaulting to light.
    expect(wrapper.style.getPropertyValue('--hub-bg')).toBe('#151210');
    expect(screen.getByRole('button', { name: 'Escuro' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to the desktop shell: sidebar present, no bottom nav', () => {
    renderPreview();
    expect(screen.getByTestId('hub-preview-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-preview-bottom-nav')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hub-preview-topbar')).not.toBeInTheDocument();
  });

  it('switches to the mobile shell: sidebar gone, top bar and bottom nav appear', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }));
    expect(screen.queryByTestId('hub-preview-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('hub-preview-topbar')).toBeInTheDocument();
    const bottomNav = screen.getByTestId('hub-preview-bottom-nav');
    expect(bottomNav).toBeInTheDocument();
    expect(within(bottomNav).getByText('Início')).toBeInTheDocument();
    expect(within(bottomNav).getByText('Aprovar')).toBeInTheDocument();
    expect(within(bottomNav).getByText('Posts')).toBeInTheDocument();
    expect(within(bottomNav).getByText('Mais')).toBeInTheDocument();
  });

  it('switching back to Computador restores the desktop shell', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Computador' }));
    expect(screen.getByTestId('hub-preview-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-preview-bottom-nav')).not.toBeInTheDocument();
  });

  it('mobile shows only 2 of the 3 KPI sparkline cards; desktop shows all 3', () => {
    renderPreview();
    expect(screen.getAllByTestId('preview-sparkline')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }));
    expect(screen.getAllByTestId('preview-sparkline')).toHaveLength(2);
  });

  it('renders the status pills row', () => {
    renderPreview();
    const pills = screen.getByTestId('preview-status-pills');
    expect(within(pills).getByText(/aprovado/i)).toBeInTheDocument();
    expect(within(pills).getByText(/em revisão/i)).toBeInTheDocument();
    expect(within(pills).getByText(/agendado/i)).toBeInTheDocument();
  });

  it('shows a "Ver tudo" link on the calendar block', () => {
    renderPreview();
    expect(screen.getByText('Ver tudo')).toBeInTheDocument();
  });
});
