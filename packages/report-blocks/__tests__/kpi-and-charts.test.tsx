import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const l = (blocks: ReportLayout['blocks']): ReportLayout => ({ version: 1, blocks });

describe('KpiCardBlock', () => {
  it('mostra label, valor formatado pt-BR e chip de delta quando há prev', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Alcance acumulado')).toBeInTheDocument();
    expect(screen.getByText('45.200')).toBeInTheDocument();
    expect(screen.getByText('+13,6%')).toBeInTheDocument(); // (45200-39800)/39800
  });

  it('formata pct e delta negativo', () => {
    render(
      <BlockRenderer
        layout={l([
          { id: 'k1', type: 'kpi_engagement_rate', size: 'third' },
          { id: 'k2', type: 'kpi_website_clicks', size: 'third' },
        ])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('4,7%')).toBeInTheDocument();
    expect(screen.getByText('-3,3%')).toBeInTheDocument(); // (87-90)/90
  });

  it('valor null: o card some; prev null: sem chip', () => {
    const snap = makeSnapshotFixture();
    snap.kpis.profile_views = { value: null, unit: 'count', prev: null };
    snap.kpis.saves = { value: 310, unit: 'count', prev: null };
    const { container } = render(
      <BlockRenderer
        layout={l([
          { id: 'k1', type: 'kpi_profile_views', size: 'third' },
          { id: 'k2', type: 'kpi_saves', size: 'third' },
        ])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(screen.queryByText('Visitas ao perfil')).not.toBeInTheDocument();
    expect(screen.getByText('Salvamentos')).toBeInTheDocument();
    expect(container.querySelector('.rb-kpi-delta')).toBeNull();
    expect(container.querySelector('.rb-kpi-prev')).toBeNull();
  });

  it('valor do período anterior aparece por extenso (padrão da página de Analytics)', () => {
    render(
      <BlockRenderer
        layout={l([
          { id: 'k1', type: 'kpi_reach', size: 'third' },
          { id: 'k2', type: 'kpi_engagement_rate', size: 'third' },
        ])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Anterior: 39.800')).toBeInTheDocument();
    expect(screen.getByText('Anterior: 4,1%')).toBeInTheDocument();
  });

  it('KPI usa .rb-card com padding padrao e sem chrome inline', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const card = container.querySelector('.rb-kpi') as HTMLElement;
    expect(card.classList.contains('rb-card')).toBe(true);
    expect(card.classList.contains('rb-card--pad')).toBe(true);
    expect(card.style.border).toBe('');
    expect(card.style.borderRadius).toBe('');
  });

  it('kpi_views renderiza com label Visualizações e delta', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_views', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Visualizações')).toBeInTheDocument();
    expect(screen.getByText('88.400')).toBeInTheDocument();
    expect(screen.getByText('Anterior: 74.100')).toBeInTheDocument();
  });

  it('snapshot antigo sem a chave views: kpi_views some sem quebrar', () => {
    const snap = makeSnapshotFixture();
    delete (snap.kpis as Partial<typeof snap.kpis>).views;
    render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_views', size: 'third' }])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(screen.queryByText('Visualizações')).not.toBeInTheDocument();
  });

  it('estampa o período completo quando effectiveEnd cobre o mês inteiro', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={makeSnapshotFixture()} // effectiveEnd = 2026-07-31, último dia de julho
        mode="view"
      />,
    );
    expect(screen.getByText('01–31 de julho')).toBeInTheDocument();
  });

  it('estampa o período parcial quando effectiveEnd não cobre o mês inteiro', () => {
    const snap = makeSnapshotFixture({
      period: {
        month: '2026-08',
        label: 'Agosto de 2026',
        start: '2026-08-01T00:00:00.000Z',
        endExclusive: '2026-09-01T00:00:00.000Z',
        effectiveEnd: '2026-08-15T00:00:00.000Z',
      },
    });
    render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(screen.getByText('01–15 de agosto · parcial')).toBeInTheDocument();
  });

  it('snapshot antigo sem effectiveEnd: nenhuma estampa de período (guard)', () => {
    const snap = makeSnapshotFixture();
    delete (snap.period as Partial<typeof snap.period>).effectiveEnd;
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-kpi-period')).toBeNull();
  });

  it('kpi_engagement_rate traz tooltip explicando a fórmula', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_engagement_rate', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const card = container.querySelector('.rb-kpi') as HTMLElement;
    expect(card.getAttribute('title')).toBe(
      'Contas engajadas ÷ alcance acumulado · análise Mesaas',
    );
  });

  it('kpi_reach traz tooltip explicando a diferença do app do Instagram', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const card = container.querySelector('.rb-kpi') as HTMLElement;
    expect(card.getAttribute('title')).toBe(
      'Soma do alcance diário do mês. O app do Instagram mostra visitantes únicos, um número menor.',
    );
  });

  it('cards sem tooltip dedicado não ganham title', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'k1', type: 'kpi_views', size: 'third' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const card = container.querySelector('.rb-kpi') as HTMLElement;
    expect(card.hasAttribute('title')).toBe(false);
  });
});

describe('FollowerChartBlock', () => {
  it('desenha a polyline e os extremos da série', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(screen.getByText('12.320')).toBeInTheDocument();
    expect(screen.getByText('12.450')).toBeInTheDocument();
  });

  it('mostra as datas do primeiro e do último ponto (dd/mm, sem pisão de timezone)', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('01/07')).toBeInTheDocument();
    expect(screen.getByText('31/07')).toBeInTheDocument();
  });

  it('série vazia: bloco some', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])}
        snapshot={makeSnapshotFixture({ follower_trend: [] })}
        mode="view"
      />,
    );
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('FormatCardsBlock', () => {
  it('mostra os 3 formatos com contagem e chip de líder', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'f1', type: 'chart_formats', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Reels')).toBeInTheDocument();
    expect(screen.getByText('Carrosséis')).toBeInTheDocument();
    expect(screen.getByText('Imagens')).toBeInTheDocument();
    expect(screen.getByText('Formato líder')).toBeInTheDocument();
  });

  it('líder decidido por visualizações médias, não por alcance', () => {
    const snap = makeSnapshotFixture({
      content_breakdown: {
        // Alcance elegeria reels; views elegem carrosséis.
        reels: { count: 4, avg_reach: 9000, avg_engagement: 0.05, avg_views: 3000 },
        carousels: { count: 4, avg_reach: 2000, avg_engagement: 0.05, avg_views: 7000 },
      },
    });
    render(
      <BlockRenderer
        layout={l([{ id: 'f1', type: 'chart_formats', size: 'full' }])}
        snapshot={snap}
        mode="view"
      />,
    );
    const carousels = screen.getByText('Carrosséis');
    expect(carousels.parentElement).toHaveTextContent('Formato líder');
    expect(screen.getByText(/média de 7\.000 visualizações/)).toBeInTheDocument();
  });

  it('snapshot antigo sem avg_views: líder e texto caem no alcance médio', () => {
    const snap = makeSnapshotFixture();
    snap.content_breakdown = {
      reels: { count: 4, avg_reach: 9000, avg_engagement: 0.05 },
      carousels: { count: 4, avg_reach: 2000, avg_engagement: 0.05 },
    } as typeof snap.content_breakdown;
    render(
      <BlockRenderer
        layout={l([{ id: 'f1', type: 'chart_formats', size: 'full' }])}
        snapshot={snap}
        mode="view"
      />,
    );
    const reels = screen.getByText('Reels');
    expect(reels.parentElement).toHaveTextContent('Formato líder');
    expect(screen.getByText(/alcance médio 9\.000/)).toBeInTheDocument();
  });
});
