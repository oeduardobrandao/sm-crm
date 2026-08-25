import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportPreview } from '../ReportPreview';

// ReportPreview now renders the real report-blocks CoverBlock (scaled down)
// instead of a hand-copied mockup — see packages/report-blocks/__tests__/
// CoverBlock.test.tsx for the cover's own rendering rules. These tests only
// cover ReportPreview's own wiring: does it thread the props into a snapshot
// and CSS theme vars correctly.
describe('ReportPreview', () => {
  it('renders workspace name and splash (the real CoverBlock splash element) when provided', () => {
    const { container } = render(
      <ReportPreview
        accentColor="#7C2D12"
        splashUrl="https://x/y.jpg"
        logoUrl={null}
        workspaceName="Agência Teste"
      />,
    );
    expect(screen.getByText('Agência Teste')).toBeInTheDocument();
    const splash = container.querySelector('img.rb-cover-splash') as HTMLImageElement;
    expect(splash).toHaveAttribute('src', 'https://x/y.jpg');
  });

  it('no splash art: no splash image renders', () => {
    const { container } = render(
      <ReportPreview accentColor="#171717" splashUrl={null} logoUrl={null} workspaceName="A" />,
    );
    expect(container.querySelector('img.rb-cover-splash')).not.toBeInTheDocument();
  });

  it('renders the logo when logoUrl is provided', () => {
    const { container } = render(
      <ReportPreview
        accentColor="#42c8f5"
        splashUrl={null}
        logoUrl="https://x/logo.png"
        workspaceName="Agência Logo"
      />,
    );
    expect(container.querySelector('img[src="https://x/logo.png"]')).toBeInTheDocument();
  });

  // Mirrors resolveReportTheme's herdado branch (packages/report-blocks/theme.ts):
  // --rb-accent carries the raw colour (light accents are no longer clamped to
  // near-black, unlike the legacy v2 pipeline), --rb-accent-fg is picked for
  // contrast against it. These assert ReportPreview passes the right accent
  // through, not resolveReportTheme's own math (covered by theme.test.ts).
  it('threads accentColor into --rb-accent and picks a contrasting --rb-accent-fg', () => {
    const { container } = render(
      <ReportPreview
        accentColor="#FFBF30"
        splashUrl={null}
        logoUrl={null}
        workspaceName="Agência Amarela"
      />,
    );
    const themed = container.querySelector('[style*="--rb-accent"]') as HTMLElement;
    expect(themed.style.getPropertyValue('--rb-accent')).toBe('#FFBF30');
    expect(themed.style.getPropertyValue('--rb-accent-fg')).toBe('#171717');
  });

  it('dark accent: --rb-accent-fg resolves to white', () => {
    const { container } = render(
      <ReportPreview
        accentColor="#7C2D12"
        splashUrl={null}
        logoUrl={null}
        workspaceName="Agência Escura"
      />,
    );
    const themed = container.querySelector('[style*="--rb-accent"]') as HTMLElement;
    expect(themed.style.getPropertyValue('--rb-accent-fg')).toBe('#ffffff');
  });

  it('the cover itself uses the theme vars, not a hardcoded colour', () => {
    const { container } = render(
      <ReportPreview
        accentColor="#7c3aed"
        splashUrl={null}
        logoUrl={null}
        workspaceName="Agência"
      />,
    );
    const cover = container.querySelector('.rb-cover') as HTMLElement;
    expect(cover.style.background).toBe('var(--rb-cover-bg, var(--rb-accent))');
  });
});
