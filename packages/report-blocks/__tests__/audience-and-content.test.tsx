import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const l = (blocks: ReportLayout['blocks']): ReportLayout => ({ version: 1, blocks });
const allAudience: ReportLayout['blocks'] = [
  { id: 'a1', type: 'audience_gender', size: 'half' },
  { id: 'a2', type: 'audience_age', size: 'half' },
  { id: 'a3', type: 'audience_cities', size: 'half' },
  { id: 'a4', type: 'audience_countries', size: 'half' },
];

describe('widgets de audiência', () => {
  it('renderizam gênero, faixas, cidades e países do fixture', () => {
    render(<BlockRenderer layout={l(allAudience)} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Feminino')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('25-34')).toBeInTheDocument();
    expect(screen.getByText('São Paulo')).toBeInTheDocument();
    expect(screen.getByText('Brasil')).toBeInTheDocument();
  });

  it('audience null: todos somem', () => {
    const { container } = render(<BlockRenderer layout={l(allAudience)} snapshot={makeSnapshotFixture({ audience: null })} mode="view" />);
    expect(container.querySelectorAll('.rb-panel').length).toBe(0);
  });
});

describe('BestTimesBlock', () => {
  it('mostra o heatmap com os top horários', () => {
    render(<BlockRenderer layout={l([{ id: 'h1', type: 'chart_best_times', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Melhores horários para publicar')).toBeInTheDocument();
    expect(screen.getByText(/Qua · 19h/)).toBeInTheDocument();
  });
});

describe('TopPostsBlock', () => {
  it('respeita config.count e mostra métricas', () => {
    render(<BlockRenderer layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Mitos sobre protetor solar')).toBeInTheDocument();
    expect(screen.queryByText('5 sinais de alerta na pele')).not.toBeInTheDocument();
  });

  it('sem thumbnail: placeholder, nunca img quebrada', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'p1', type: 'top_posts', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('.rb-thumb-placeholder').length).toBeGreaterThan(0);
  });
});

describe('TagsTableBlock', () => {
  it('mostra a tabela de tópicos', () => {
    render(<BlockRenderer layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Educativo')).toBeInTheDocument();
    expect(screen.getByText('5.100')).toBeInTheDocument();
  });

  it('sem tags: some', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])} snapshot={makeSnapshotFixture({ tags_performance: [] })} mode="view" />);
    expect(container.querySelector('table')).toBeNull();
  });
});
