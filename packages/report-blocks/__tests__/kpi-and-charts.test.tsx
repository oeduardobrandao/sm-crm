import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const l = (blocks: ReportLayout['blocks']): ReportLayout => ({ version: 1, blocks });

describe('KpiCardBlock', () => {
  it('mostra label, valor formatado pt-BR e chip de delta quando há prev', () => {
    render(<BlockRenderer layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Alcance')).toBeInTheDocument();
    expect(screen.getByText('45.200')).toBeInTheDocument();
    expect(screen.getByText('+13,6%')).toBeInTheDocument(); // (45200-39800)/39800
  });

  it('formata pct e delta negativo', () => {
    render(<BlockRenderer layout={l([
      { id: 'k1', type: 'kpi_engagement_rate', size: 'third' },
      { id: 'k2', type: 'kpi_website_clicks', size: 'third' },
    ])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('4,7%')).toBeInTheDocument();
    expect(screen.getByText('-3,3%')).toBeInTheDocument(); // (87-90)/90
  });

  it('valor null: o card some; prev null: sem chip', () => {
    const snap = makeSnapshotFixture();
    snap.kpis.profile_views = { value: null, unit: 'count', prev: null };
    snap.kpis.saves = { value: 310, unit: 'count', prev: null };
    const { container } = render(<BlockRenderer layout={l([
      { id: 'k1', type: 'kpi_profile_views', size: 'third' },
      { id: 'k2', type: 'kpi_saves', size: 'third' },
    ])} snapshot={snap} mode="view" />);
    expect(screen.queryByText('Visitas ao perfil')).not.toBeInTheDocument();
    expect(screen.getByText('Salvamentos')).toBeInTheDocument();
    expect(container.querySelector('.rb-kpi-delta')).toBeNull();
  });
});

describe('FollowerChartBlock', () => {
  it('desenha a polyline e os extremos da série', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(screen.getByText('12.320')).toBeInTheDocument();
    expect(screen.getByText('12.450')).toBeInTheDocument();
  });

  it('série vazia: bloco some', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])} snapshot={makeSnapshotFixture({ follower_trend: [] })} mode="view" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('FormatCardsBlock', () => {
  it('mostra os 3 formatos com contagem e chip de líder', () => {
    render(<BlockRenderer layout={l([{ id: 'f1', type: 'chart_formats', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Reels')).toBeInTheDocument();
    expect(screen.getByText('Carrosséis')).toBeInTheDocument();
    expect(screen.getByText('Imagens')).toBeInTheDocument();
    expect(screen.getByText('Formato líder')).toBeInTheDocument();
  });
});
