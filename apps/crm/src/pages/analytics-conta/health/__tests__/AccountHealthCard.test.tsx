import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  percentileFromCuts,
  type BenchmarkSource,
  type HealthMetricKey,
  type PeerBenchmark,
} from '@mesaas/report-blocks/health';
import type { AccountHealth } from '@/services/analytics';
import { highlightLine } from '@mesaas/report-blocks/health';
import { AccountHealthCard } from '../AccountHealthCard';

/**
 * 99 cortes (p1..p99) estritamente crescentes, lineares por trechos, que passam por
 * (50, p50) e (target, value). Assim percentileFromCuts(value) === target e cuts[49] === p50.
 */
function buildCuts(value: number, target: number, p50: number): number[] {
  const top = Math.max(value, p50) * 3;
  const points: Array<[number, number]> = [
    [0, 0],
    [50, p50],
    [target, value],
    [100, top],
  ].sort((a, b) => a[0] - b[0]) as Array<[number, number]>;
  const cuts: number[] = [];
  for (let k = 1; k <= 99; k++) {
    let i = 0;
    while (points[i + 1][0] < k) i++;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    cuts.push(y0 + ((k - x0) / (x1 - x0)) * (y1 - y0));
  }
  return cuts;
}

const FIXTURE: Record<HealthMetricKey, { value: number; target: number; p50: number }> = {
  engagement_rate: { value: 0.0193, target: 96, p50: 0.002 },
  posts_30d: { value: 8, target: 34, p50: 12 },
  reel_views: { value: 3816, target: 81, p50: 1987 },
  reels_share: { value: 0.67, target: 71, p50: 0.5 },
};

const KEYS: HealthMetricKey[] = ['engagement_rate', 'posts_30d', 'reel_views', 'reels_share'];

function bench(key: HealthMetricKey, source: BenchmarkSource, sample = 344): PeerBenchmark {
  const f = FIXTURE[key];
  return {
    metric: key,
    source,
    sample_size: source === 'mesaas' ? sample : null,
    cuts: buildCuts(f.value, f.target, f.p50),
  };
}

function makeHealth(
  sources: Partial<Record<HealthMetricKey, BenchmarkSource | null>> = {},
  overrides: Partial<AccountHealth> = {},
): AccountHealth {
  const benchmarks: AccountHealth['benchmarks'] = {};
  for (const k of KEYS) {
    const s = k in sources ? sources[k] : 'mesaas';
    if (s) benchmarks[k] = bench(k, s);
  }
  return {
    followers: 9274,
    band: '5k_20k',
    metrics: {
      engagement_rate: FIXTURE.engagement_rate.value,
      posts_30d: FIXTURE.posts_30d.value,
      reel_views: FIXTURE.reel_views.value,
      reels_share: FIXTURE.reels_share.value,
    },
    bestPost: { id: 'post-uuid', ratio: 1.43 },
    benchmarks,
    ...overrides,
  };
}

function renderCard(
  health: AccountHealth | null | undefined,
  onOpenPost = vi.fn(),
  { expand = true }: { expand?: boolean } = {},
) {
  const result = render(
    <AccountHealthCard health={health} isLoading={false} onOpenPost={onOpenPost} />,
  );
  const more = screen.queryByRole('button', { name: 'Ver mais' });
  if (expand && more) fireEvent.click(more);
  return result;
}

describe('fixture helper', () => {
  it('builds cuts that yield the target percentiles and p50', () => {
    for (const k of KEYS) {
      const f = FIXTURE[k];
      const cuts = buildCuts(f.value, f.target, f.p50);
      expect(cuts).toHaveLength(99);
      expect(percentileFromCuts(f.value, cuts)).toBe(f.target);
      expect(cuts[49]).toBeCloseTo(f.p50, 10);
    }
  });
});

describe('AccountHealthCard', () => {
  it('starts collapsed: verdict, summary and highlight only, details behind Ver mais', () => {
    renderCard(makeHealth(), vi.fn(), { expand: false });
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de 71% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Taxa de engajamento')).not.toBeInTheDocument();
    expect(screen.queryByText(/resultado normal da sua conta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimativa de mercado|Comparado com/)).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Ver mais' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    const less = screen.getByRole('button', { name: 'Ver menos' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(less.getAttribute('aria-controls')!)).not.toBeNull();
    expect(screen.getByText('Taxa de engajamento')).toBeInTheDocument();

    fireEvent.click(less);
    expect(screen.queryByText('Taxa de engajamento')).not.toBeInTheDocument();
  });

  it('renders the print fixture (all mesaas)', () => {
    renderCard(makeHealth());
    expect(screen.getByText('Seu Instagram está indo bem?')).toBeInTheDocument();
    // overall 71 "Bom" + reels_share 71 "Bom"
    expect(screen.getAllByText('Bom')).toHaveLength(2);
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de 71% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Muito bom')).toHaveLength(2);
    expect(screen.getAllByText('Ruim')).toHaveLength(1);
    expect(
      screen.getByText('Seu engajamento é 1,93% por post; em contas do seu tamanho é 0,20%.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '*Comparado com mais de 300 contas do seu tamanho no Mesaas (de 5 mil a 20 mil seguidores).',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Mercado')).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimativa de mercado/)).not.toBeInTheDocument();
    expect(screen.getByText('Taxa de engajamento')).toBeInTheDocument();
    expect(screen.getByText('Posts em 30 dias')).toBeInTheDocument();
    expect(screen.getByText('Visualizações nos reels')).toBeInTheDocument();
    expect(screen.getByText('Reels no seu feed')).toBeInTheDocument();
    expect(screen.getByText('À frente de 96% das contas do seu tamanho')).toBeInTheDocument();
    expect(
      screen.getByText('Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores.'),
    ).toBeInTheDocument();
    // peer p50 values, posts rounded to an integer
    expect(screen.getByText('0,20%')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1.987')).toBeInTheDocument();
    expect(screen.getByText('3.816')).toBeInTheDocument();
    // overall bar + reels_share bar (both 71)
    expect(
      screen.getAllByRole('img', { name: 'À frente de 71% das contas do seu tamanho' }),
    ).toHaveLength(2);
    expect(
      screen.getByRole('img', { name: 'À frente de 96% das contas do seu tamanho' }),
    ).toBeInTheDocument();
  });

  it('says "cerca de" and shows the mercado footer when all sources are mercado', () => {
    renderCard(
      makeHealth({
        engagement_rate: 'mercado',
        posts_30d: 'mercado',
        reel_views: 'mercado',
        reels_share: 'mercado',
      }),
    );
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de cerca de 71% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('À frente de cerca de 96% das contas do seu tamanho'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '†Estimativa de mercado para contas de 5 mil a 20 mil seguidores, a partir de estudos públicos com métricas parecidas.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Comparado com/)).not.toBeInTheDocument();
    expect(screen.queryByText('Mercado')).not.toBeInTheDocument();
  });

  it('shows source badges and both footer lines when sources are mixed', () => {
    renderCard(makeHealth({ posts_30d: 'mercado', reels_share: 'mercado' }));
    expect(screen.getAllByText('Mesaas')).toHaveLength(2);
    expect(screen.getAllByText('Mercado')).toHaveLength(2);
    expect(
      screen.getByText(
        '*Comparado com mais de 300 contas do seu tamanho no Mesaas (de 5 mil a 20 mil seguidores).',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '†Estimativa de mercado para contas de 5 mil a 20 mil seguidores, a partir de estudos públicos com métricas parecidas.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de 71% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
  });

  it('handles a null metric', () => {
    const h = makeHealth();
    renderCard({ ...h, metrics: { ...h.metrics, reel_views: null } });
    expect(screen.getByText('Sem dados suficientes.')).toBeInTheDocument();
    expect(
      screen.getByText('Precisa de pelo menos 3 reels nos últimos 90 dias.'),
    ).toBeInTheDocument();
    // (96 + 34 + 71) / 3 = 67
    expect(
      screen.getByText(
        'Somando as 3 métricas, você está à frente de 67% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
  });

  it('handles a metric without benchmark', () => {
    renderCard(makeHealth({ reels_share: null }));
    expect(
      screen.getByText('Ainda sem referência para contas do seu tamanho.'),
    ).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/Somando as 3 métricas/)).toBeInTheDocument();
  });

  it('treats a malformed benchmark (fewer than 99 cuts) as missing', () => {
    const h = makeHealth();
    const share = h.benchmarks.reels_share!;
    renderCard({
      ...h,
      benchmarks: { ...h.benchmarks, reels_share: { ...share, cuts: share.cuts.slice(0, 10) } },
    });
    expect(
      screen.getByText('Ainda sem referência para contas do seu tamanho.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Somando as 3 métricas/)).toBeInTheDocument();
  });

  it('uses singular copy when only one metric is counted', () => {
    renderCard(makeHealth({ posts_30d: null, reel_views: null, reels_share: null }));
    expect(
      screen.getByText(
        'Pela métrica disponível, você está à frente de 96% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
  });

  it('omits the sample count in the Mesaas footer when sample_size is null', () => {
    const h = makeHealth();
    const benchmarks = Object.fromEntries(
      Object.entries(h.benchmarks).map(([k, b]) => [k, { ...b, sample_size: null }]),
    );
    renderCard({ ...h, benchmarks });
    expect(
      screen.getByText(
        '*Comparado com contas do seu tamanho no Mesaas (de 5 mil a 20 mil seguidores).',
      ),
    ).toBeInTheDocument();
  });

  it('renders the empty state', () => {
    renderCard(makeHealth({}, { followers: 0 }));
    expect(screen.getByText('Ainda não dá para comparar')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Publique alguns posts e sincronize. A comparação aparece quando a conta tiver posts de feed nos últimos 90 dias.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Somando/)).not.toBeInTheDocument();
    expect(screen.queryByText(/melhor post/)).not.toBeInTheDocument();
  });

  it('renders the empty state when band is null or all metrics are null', () => {
    const { unmount } = renderCard(makeHealth({}, { band: null }));
    expect(screen.getByText('Ainda não dá para comparar')).toBeInTheDocument();
    unmount();
    renderCard(
      makeHealth(
        {},
        {
          metrics: { engagement_rate: null, posts_30d: null, reel_views: null, reels_share: null },
        },
      ),
    );
    expect(screen.getByText('Ainda não dá para comparar')).toBeInTheDocument();
  });

  it('renders the empty state when no metric has a benchmark', () => {
    renderCard(
      makeHealth({ engagement_rate: null, posts_30d: null, reel_views: null, reels_share: null }),
    );
    expect(screen.getByText('Ainda não dá para comparar')).toBeInTheDocument();
  });

  it('renders nothing for a null health', () => {
    const { container } = renderCard(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the best post', () => {
    const onOpenPost = vi.fn();
    renderCard(makeHealth(), onOpenPost);
    expect(
      screen.getByText(
        /Seu melhor post dos últimos 30 dias teve 1,4x o resultado normal da sua conta\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver o post' }));
    expect(onOpenPost).toHaveBeenCalledWith('post-uuid');
  });

  it('omits the best post line when bestPost is null', () => {
    renderCard(makeHealth({}, { bestPost: null }));
    expect(screen.queryByText(/melhor post/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver o post' })).not.toBeInTheDocument();
  });

  it('omits the best post line when the best post is under 1x the normal', () => {
    renderCard(makeHealth({}, { bestPost: { id: 'post-uuid', ratio: 0.8 } }));
    expect(screen.queryByText(/melhor post/)).not.toBeInTheDocument();
  });

  it('shows the best post line at exactly 1x', () => {
    renderCard(makeHealth({}, { bestPost: { id: 'post-uuid', ratio: 1 } }));
    expect(screen.getByText(/teve 1,0x o resultado normal/)).toBeInTheDocument();
  });

  it('uses the singular for one post in the highlight line', () => {
    expect(highlightLine('posts_30d', '1', '12')).toBe(
      'Você publicou 1 post em 30 dias; contas do seu tamanho publicam 12.',
    );
    expect(highlightLine('posts_30d', '8', '12')).toBe(
      'Você publicou 8 posts em 30 dias; contas do seu tamanho publicam 12.',
    );
  });

  it('renders a skeleton while loading', () => {
    const { container } = render(
      <AccountHealthCard health={undefined} isLoading onOpenPost={vi.fn()} />,
    );
    expect(container.querySelector('.ig-health-skeleton')).not.toBeNull();
  });

  it('applies the phone layout modifier', () => {
    const { container } = render(
      <AccountHealthCard
        health={makeHealth()}
        isLoading={false}
        onOpenPost={vi.fn()}
        layout="phone"
      />,
    );
    expect(container.querySelector('.ig-health--phone')).not.toBeNull();
  });

  it('never renders an em-dash', () => {
    const allMercado = {
      engagement_rate: 'mercado',
      posts_30d: 'mercado',
      reel_views: 'mercado',
      reels_share: 'mercado',
    } as const;
    const partial = makeHealth({ posts_30d: 'mercado', reels_share: null });
    const cases: AccountHealth[] = [
      makeHealth(),
      makeHealth(allMercado),
      makeHealth({ posts_30d: 'mercado', reels_share: 'mercado' }),
      { ...partial, metrics: { ...partial.metrics, reel_views: null } },
      makeHealth({}, { followers: 0 }),
    ];
    for (const h of cases) {
      const { container, unmount } = renderCard(h);
      expect(container.textContent).not.toContain('—');
      unmount();
    }
  });

  it('uses headings for the question and metric titles', () => {
    renderCard(makeHealth());
    expect(
      screen.getByRole('heading', { level: 2, name: 'Seu Instagram está indo bem?' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });

  it('uses an h3 for the empty-state heading', () => {
    renderCard(makeHealth({}, { followers: 0 }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Ainda não dá para comparar' }),
    ).toBeInTheDocument();
  });
});
