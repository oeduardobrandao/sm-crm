import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceMark } from '../WorkspaceMark';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

const BASE_BOOTSTRAP: HubBootstrap = {
  workspace: {
    name: 'Café da Manhã',
    logo_url: 'https://cdn.mesaas.com/light.png',
    brand_color: '#171717',
  },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
  feature_mensagens: true,
};

function renderMark(bootstrap: HubBootstrap, theme: 'light' | 'dark' = 'light') {
  return render(
    <HubContext.Provider
      value={{ bootstrap, token: 'tok', workspace: 'ws', theme, toggleTheme: vi.fn() }}
    >
      <WorkspaceMark />
    </HubContext.Provider>,
  );
}

describe('WorkspaceMark', () => {
  it('renders the light logo in light mode', () => {
    renderMark(BASE_BOOTSTRAP, 'light');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.mesaas.com/light.png');
  });

  it('renders the light logo in dark mode when no dark URL is configured', () => {
    renderMark(BASE_BOOTSTRAP, 'dark');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.mesaas.com/light.png');
  });

  it('picks the dark logo in dark mode when hub_theme.logo_dark_url is set', () => {
    const bootstrap: HubBootstrap = {
      ...BASE_BOOTSTRAP,
      hub_theme: {
        customized: true,
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
        logo_style: 'round',
        logo_dark_url: 'https://cdn.mesaas.com/dark.png',
        hide_branding: false,
        default_appearance: 'light',
      },
    };
    renderMark(bootstrap, 'dark');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.mesaas.com/dark.png');
  });

  it('stays on the light logo in light mode even when a dark URL is configured', () => {
    const bootstrap: HubBootstrap = {
      ...BASE_BOOTSTRAP,
      hub_theme: {
        customized: true,
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
        logo_style: 'round',
        logo_dark_url: 'https://cdn.mesaas.com/dark.png',
        hide_branding: false,
        default_appearance: 'light',
      },
    };
    renderMark(bootstrap, 'light');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn.mesaas.com/light.png');
  });

  it('resets the broken-image flag per URL: a failed dark logo does not block the light logo after switching modes', () => {
    const bootstrap: HubBootstrap = {
      ...BASE_BOOTSTRAP,
      hub_theme: {
        customized: true,
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
        logo_style: 'round',
        logo_dark_url: 'https://cdn.mesaas.com/dark.png',
        hide_branding: false,
        default_appearance: 'light',
      },
    };
    const { rerender } = renderMark(bootstrap, 'dark');
    const darkImg = screen.getByRole('img') as HTMLImageElement;
    expect(darkImg.src).toBe('https://cdn.mesaas.com/dark.png');

    fireEvent.error(darkImg);
    // Broken dark logo falls back to the monogram.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();

    rerender(
      <HubContext.Provider
        value={{ bootstrap, token: 'tok', workspace: 'ws', theme: 'light', toggleTheme: vi.fn() }}
      >
        <WorkspaceMark />
      </HubContext.Provider>,
    );

    // Switching to light mode retries the (different, working) light URL instead
    // of staying stuck on the monogram from the dark URL's failure.
    const lightImg = screen.getByRole('img') as HTMLImageElement;
    expect(lightImg.src).toBe('https://cdn.mesaas.com/light.png');
  });

  it('falls back to the monogram when there is no logo_url', () => {
    renderMark({ ...BASE_BOOTSTRAP, workspace: { ...BASE_BOOTSTRAP.workspace, logo_url: null } });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('falls back to the monogram when the image errors', () => {
    renderMark(BASE_BOOTSTRAP);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('logo_style "round" (default) keeps the exact circular crop rendering', () => {
    renderMark(BASE_BOOTSTRAP, 'light');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.className).toContain('rounded-full');
    expect(img.className).toContain('object-cover');
    expect(img.style.width).toBe('36px');
    expect(img.style.height).toBe('36px');
  });

  it('ignores logo_dark_url and logo_style when customized is false (client-side defense in depth)', () => {
    // Mirrors HubShell's gating: customized: false must read logo_dark_url as
    // null and logo_style as 'round', even if a malformed/stale payload carries
    // contrary values.
    const bootstrap: HubBootstrap = {
      ...BASE_BOOTSTRAP,
      hub_theme: {
        customized: false,
        surface: 'cool',
        font_display: 'space-grotesk',
        font_body: 'manrope',
        radius: 'pill',
        card_style: 'outline',
        logo_style: 'wordmark',
        logo_dark_url: 'https://cdn.mesaas.com/dark.png',
        hide_branding: true,
        default_appearance: 'dark',
      },
    };
    renderMark(bootstrap, 'dark');
    const img = screen.getByRole('img') as HTMLImageElement;
    // Stays on the light logo_url in dark mode — the (ignored) dark URL never wins.
    expect(img.src).toBe('https://cdn.mesaas.com/light.png');
    // Stays circular ('round') — the (ignored) 'wordmark' style never applies.
    expect(img.className).toContain('rounded-full');
    expect(img.className).toContain('object-cover');
  });

  it('logo_style "wordmark" renders at natural aspect ratio, no circular crop', () => {
    const bootstrap: HubBootstrap = {
      ...BASE_BOOTSTRAP,
      hub_theme: {
        customized: true,
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
        logo_style: 'wordmark',
        logo_dark_url: null,
        hide_branding: false,
        default_appearance: 'light',
      },
    };
    renderMark(bootstrap, 'light');
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.className).not.toContain('rounded-full');
    expect(img.className).toContain('rounded-md');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.width).toBe('auto');
    expect(img.style.height).toBe('36px');
    expect(img.style.maxWidth).toBe('126px');
  });
});
