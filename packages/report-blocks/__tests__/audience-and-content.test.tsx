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
    const { container } = render(
      <BlockRenderer
        layout={l(allAudience)}
        snapshot={makeSnapshotFixture({ audience: null })}
        mode="view"
      />,
    );
    expect(container.querySelectorAll('.rb-panel').length).toBe(0);
  });
});

describe('BestTimesBlock', () => {
  it('mostra o heatmap com os top horários', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'h1', type: 'chart_best_times', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Melhores horários para publicar')).toBeInTheDocument();
    expect(screen.getByText(/Qua · 19h/)).toBeInTheDocument();
  });
});

describe('TopPostsBlock', () => {
  it('respeita config.count e mostra métricas', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Mitos sobre protetor solar')).toBeInTheDocument();
    expect(screen.queryByText('5 sinais de alerta na pele')).not.toBeInTheDocument();
    // Métrica principal do card = visualizações (Vis.), não alcance.
    expect(screen.getByText(/Vis\. 18\.400/)).toBeInTheDocument();
  });

  it('snapshot antigo (posts sem views): métrica cai no alcance (Alc.)', () => {
    const snap = makeSnapshotFixture();
    for (const post of snap.top_posts) {
      delete (post as Partial<(typeof snap.top_posts)[number]>).views;
    }
    render(
      <BlockRenderer
        layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(screen.getByText(/Alc\. 9\.800/)).toBeInTheDocument();
  });

  it('contagem par em largura cheia: colunas equilibradas (6->3, 8->4, 12->4; ímpar mantém auto-fill)', () => {
    const post = makeSnapshotFixture().top_posts[0];
    const grid = (n: number, size: 'full' | 'half' = 'full') => {
      const snap = makeSnapshotFixture({
        top_posts: Array.from({ length: n }, (_, i) => ({
          ...post,
          caption_preview: `post ${i}`,
        })),
      });
      const { container, unmount } = render(
        <BlockRenderer
          layout={l([{ id: 'p1', type: 'top_posts', size, config: { count: n } }])}
          snapshot={snap}
          mode="view"
        />,
      );
      const style = (container.querySelector('article')?.parentElement as HTMLElement).style
        .gridTemplateColumns;
      unmount();
      return style;
    };
    expect(grid(6)).toBe('repeat(3, minmax(0, 1fr))');
    expect(grid(8)).toBe('repeat(4, minmax(0, 1fr))');
    expect(grid(12)).toBe('repeat(4, minmax(0, 1fr))');
    expect(grid(5)).toBe('repeat(auto-fill, minmax(180px, 1fr))');
    // Meia largura não força colunas fixas: auto-fill se adapta ao espaço.
    expect(grid(6, 'half')).toBe('repeat(auto-fill, minmax(180px, 1fr))');
  });

  it('sem thumbnail: placeholder, nunca img quebrada', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'p1', type: 'top_posts', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('.rb-thumb-placeholder').length).toBeGreaterThan(0);
  });

  it('top posts: article e rb-card--flush (thumbnail encosta na borda)', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const article = container.querySelector('article') as HTMLElement;
    expect(article.classList.contains('rb-card')).toBe(true);
    expect(article.classList.contains('rb-card--flush')).toBe(true);
  });
});

describe('PostListBlock', () => {
  it('renderiza linhas compactas com rank, caption e visualizações', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'pl1', type: 'post_list', size: 'full', config: { count: 1 } }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Mitos sobre protetor solar')).toBeInTheDocument();
    expect(screen.getByText('1º')).toBeInTheDocument();
    expect(screen.getByText('18.400')).toBeInTheDocument();
    expect(screen.queryByText('5 sinais de alerta na pele')).not.toBeInTheDocument();
  });

  it('snapshot antigo (sem views): linha cai no alcance', () => {
    const snap = makeSnapshotFixture();
    for (const post of snap.top_posts) {
      delete (post as Partial<(typeof snap.top_posts)[number]>).views;
    }
    render(
      <BlockRenderer
        layout={l([{ id: 'pl1', type: 'post_list', size: 'full', config: { count: 1 } }])}
        snapshot={snap}
        mode="view"
      />,
    );
    expect(screen.getByText('9.800')).toBeInTheDocument();
  });

  it('sem posts: desaparece', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'pl1', type: 'post_list', size: 'full' }])}
        snapshot={makeSnapshotFixture({ top_posts: [] })}
        mode="view"
      />,
    );
    expect(container.querySelectorAll('[data-block-id]')[0]?.childNodes.length).toBe(0);
  });

  it('count fora dos limites: cai no padrão 12', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 'pl1', type: 'post_list', size: 'full', config: { count: 99 } }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Mitos sobre protetor solar')).toBeInTheDocument();
    expect(screen.getByText('5 sinais de alerta na pele')).toBeInTheDocument();
  });

  it('lista de publicacoes: rb-card--compact', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 'pl', type: 'post_list', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-card.rb-card--compact')).not.toBeNull();
  });
});

describe('TagsTableBlock', () => {
  it('mostra a tabela de tópicos', () => {
    render(
      <BlockRenderer
        layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Educativo')).toBeInTheDocument();
    expect(screen.getByText('5.100')).toBeInTheDocument();
    expect(screen.getByText('4,2%')).toBeInTheDocument();
  });

  it('sem tags: some', () => {
    const { container } = render(
      <BlockRenderer
        layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])}
        snapshot={makeSnapshotFixture({ tags_performance: [] })}
        mode="view"
      />,
    );
    expect(container.querySelector('table')).toBeNull();
  });
});
