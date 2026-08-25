import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoverBlock } from '../blocks/CoverBlock';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportBlock } from '../types';

const coverBlock = (config?: Record<string, unknown>): ReportBlock =>
  config
    ? { id: 'c', type: 'cover', size: 'full', config }
    : { id: 'c', type: 'cover', size: 'full' };

describe('CoverBlock', () => {
  it('sem config: usa os valores computados do snapshot', () => {
    render(<CoverBlock block={coverBlock()} snapshot={makeSnapshotFixture()} />);
    expect(screen.getByText('Relatório mensal · Instagram')).toBeInTheDocument();
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
    expect(screen.getByText('@dra.exemplo · Dermatologia · São Paulo')).toBeInTheDocument();
  });

  it('config.title não-string: cai no default computado em vez de renderizar o valor cru', () => {
    render(<CoverBlock block={coverBlock({ title: 42 })} snapshot={makeSnapshotFixture()} />);
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('config presente: sobrescreve kicker, título e subtítulo', () => {
    render(
      <CoverBlock
        block={coverBlock({
          kicker: 'Relatório especial',
          title: 'Julho turbinado',
          subtitle: '@outra',
        })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    expect(screen.getByText('Relatório especial')).toBeInTheDocument();
    expect(screen.getByText('Julho turbinado')).toBeInTheDocument();
    expect(screen.getByText('@outra')).toBeInTheDocument();
    expect(screen.queryByText('Relatório mensal · Instagram')).not.toBeInTheDocument();
  });

  it('sem cor própria: usa as CSS vars do tema (comportamento atual)', () => {
    const { container } = render(
      <CoverBlock block={coverBlock()} snapshot={makeSnapshotFixture()} />,
    );
    const header = container.querySelector('.rb-cover') as HTMLElement;
    expect(header.style.background).toBe('var(--rb-cover-bg, var(--rb-accent))');
    expect(header.style.color).toBe('var(--rb-cover-fg, var(--rb-accent-fg))');
  });

  it('cor própria: aplica a cor e calcula o contraste do texto', () => {
    const { container } = render(
      <CoverBlock block={coverBlock({ color: '#0f172a' })} snapshot={makeSnapshotFixture()} />,
    );
    const header = container.querySelector('.rb-cover') as HTMLElement;
    // jsdom's CSSOM (like real browsers) serializes inline hex colors back as
    // rgb() -- same normalization apps/crm's CalendarGrid.test.tsx already
    // relies on (`.style.background).toBe('rgb(225, 48, 108)')` for #E1306C).
    // #0f172a -> rgb(15, 23, 42); pickAccentFg's '#ffffff' -> rgb(255, 255, 255).
    expect(header.style.background).toBe('rgb(15, 23, 42)');
    expect(header.style.color).toBe('rgb(255, 255, 255)');
  });

  it('logoSize aplica na altura da logo', () => {
    const snap = makeSnapshotFixture({
      branding: {
        workspace_name: 'DK Marketing',
        logo_url: 'https://x/logo.png',
        splash_url: null,
        accent_color: '#7c3aed',
      },
    });
    const { container } = render(
      <CoverBlock block={coverBlock({ logoSize: 60 })} snapshot={snap} />,
    );
    const logo = container.querySelector('img[src="https://x/logo.png"]') as HTMLImageElement;
    expect(logo.style.height).toBe('60px');
  });

  it('avatar com foto: renderiza a imagem do cliente pela URL do snapshot', () => {
    const snap = makeSnapshotFixture({
      account: {
        handle: 'dra.exemplo',
        specialty: 'Dermatologia',
        profile_picture_url: 'https://x/avatar.jpg',
        client_name: 'Dra. Exemplo',
      },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(container.querySelector('img[src="https://x/avatar.jpg"]')).toBeInTheDocument();
  });

  it('avatar sem foto: mostra a inicial do nome do cliente', () => {
    const snap = makeSnapshotFixture({
      account: {
        handle: 'dra.exemplo',
        specialty: 'Dermatologia',
        profile_picture_url: null,
        client_name: 'Beatriz',
      },
    });
    render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('avatar sem client_name (snapshot antigo): cai pra inicial do handle', () => {
    const snap = makeSnapshotFixture({
      account: { handle: 'dra.exemplo', specialty: 'Dermatologia' },
    });
    render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('avatar com erro de carregamento: reverte pra inicial', () => {
    const snap = makeSnapshotFixture({
      account: {
        handle: 'dra.exemplo',
        specialty: 'Dermatologia',
        profile_picture_url: 'https://x/quebrada.jpg',
        client_name: 'Beatriz',
      },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    const img = container.querySelector('img[src="https://x/quebrada.jpg"]') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('splash: ganha a classe de teto de altura', () => {
    const snap = makeSnapshotFixture({
      branding: {
        workspace_name: 'DK',
        logo_url: null,
        splash_url: 'https://x/splash.jpg',
        accent_color: '#7c3aed',
      },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(container.querySelector('img.rb-cover-splash')).toBeInTheDocument();
  });
});
