import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { AccountHealthBlock } from '../blocks/AccountHealthBlock';
import { blockHasData } from '../data-presence';
import { FULL_WIDTH_ONLY_TYPES, WIDGET_CATALOG, isFullWidthOnly } from '../catalog';
import { makeSnapshotFixture } from '../fixtures';
import { safeHttpsUrl } from '../format';
import { percentileFromCuts, readInstagramHealth, type InstagramHealthSnapshot } from '../health';
import { BLOCK_TYPES } from '../types';
import type { ReportBlock, ReportDocSnapshot, ReportLayout } from '../types';

const block = { id: 'h', type: 'account_health', size: 'full' } as ReportBlock;

function baseHealth(): InstagramHealthSnapshot {
  const h = readInstagramHealth(makeSnapshotFixture());
  if (!h) throw new Error('fixture sem instagram_health');
  return h;
}

function withHealth(health: InstagramHealthSnapshot | null | undefined): ReportDocSnapshot {
  const snap = makeSnapshotFixture() as ReportDocSnapshot & {
    instagram_health?: InstagramHealthSnapshot | null;
  };
  if (health === undefined) {
    const copy = { ...snap };
    delete copy.instagram_health;
    return copy;
  }
  return { ...snap, instagram_health: health } as ReportDocSnapshot;
}

function renderBlock(snapshot: ReportDocSnapshot = makeSnapshotFixture()) {
  return render(<AccountHealthBlock block={block} snapshot={snapshot} />);
}

describe('fixture da saúde do Instagram', () => {
  it('cortes levam aos percentis do mockup (41, 44, 96, 46)', () => {
    const h = baseHealth();
    const pct = (k: keyof typeof h.metrics) =>
      percentileFromCuts(h.metrics[k] as number, h.benchmarks[k]!.cuts);
    expect(pct('engagement_rate')).toBe(41);
    expect(pct('posts_30d')).toBe(44);
    expect(pct('reel_views')).toBe(96);
    expect(pct('reels_share')).toBe(46);
    for (const b of Object.values(h.benchmarks)) {
      expect(b!.cuts).toHaveLength(99);
      for (let i = 1; i < 99; i++) expect(b!.cuts[i]).toBeGreaterThanOrEqual(b!.cuts[i - 1]);
    }
  });
});

describe('AccountHealthBlock', () => {
  it('com a fixture: cabeçalho, carimbo, veredito, resumo, métricas, rodapé e melhor post', () => {
    const { container } = renderBlock();
    expect(screen.getByText('Saúde do Instagram')).toBeInTheDocument();
    expect(screen.getByText('Até 31/07')).toBeInTheDocument();
    expect(screen.getByText('Seu Instagram está indo bem?')).toBeInTheDocument();
    // Média de 41, 44, 96 e 46 = 56,75 -> 57 = "Na média".
    const verdict = container.querySelector('.rb-health-verdict');
    expect(verdict?.textContent).toBe('Na média');
    expect(verdict?.className).toContain('rb-health-tone-avg');
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de cerca de 57% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
    // Destaque = métrica de maior percentil (reels, p96).
    expect(
      screen.getByText('Seus reels têm 3.885 visualizações; em contas do seu tamanho, 952.'),
    ).toBeInTheDocument();

    for (const title of [
      'Taxa de engajamento',
      'Posts em 30 dias',
      'Visualizações nos reels',
      'Reels no seu feed',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(
      screen.getByText('À frente de cerca de 41% das contas do seu tamanho'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('À frente de cerca de 96% das contas do seu tamanho'),
    ).toBeInTheDocument();
    expect(screen.getByText('1,13%')).toBeInTheDocument();
    expect(screen.getByText('1,65%')).toBeInTheDocument();
    expect(screen.getAllByText('3.885').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores.'),
    ).toBeInTheDocument();
    // Fonte única: sem etiqueta por métrica.
    expect(container.querySelector('.rb-health-src')).toBeNull();
    expect(
      screen.getByText(
        '†Estimativa de mercado para contas de 5 mil a 20 mil seguidores, a partir de estudos públicos com métricas parecidas.',
      ),
    ).toBeInTheDocument();

    const best = container.querySelector('.rb-health-best');
    expect(best?.textContent).toContain(
      'Seu melhor post do período teve 2,2x o resultado normal da conta.',
    );
    const link = screen.getByRole('link', { name: 'Ver no Instagram' });
    expect(link.getAttribute('href')).toBe(baseHealth().best_post!.permalink);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('.rb-health-best img')?.getAttribute('src')).toBe(
      baseHealth().best_post!.thumbnail_url,
    );
  });

  it('nenhum texto com travessão', () => {
    const { container } = renderBlock();
    expect(container.textContent).not.toContain('—');
  });

  it('snapshot sem instagram_health: render vazio e sem dado', () => {
    for (const h of [undefined, null]) {
      const snap = withHealth(h);
      const { container, unmount } = renderBlock(snap);
      expect(container.innerHTML).toBe('');
      expect(blockHasData(block, snap)).toBe(false);
      unmount();
    }
  });

  it('band nulo ou nenhuma métrica com valor e referência: sem dado', () => {
    const noBand = withHealth({ ...baseHealth(), band: null });
    expect(blockHasData(block, noBand)).toBe(false);
    const r1 = renderBlock(noBand);
    expect(r1.container.innerHTML).toBe('');
    r1.unmount();

    const h = baseHealth();
    const noRef = withHealth({
      ...h,
      metrics: { ...h.metrics, engagement_rate: null, posts_30d: null },
      benchmarks: { engagement_rate: h.benchmarks.engagement_rate },
    });
    expect(blockHasData(block, noRef)).toBe(false);
    expect(renderBlock(noRef).container.innerHTML).toBe('');
  });

  it('com a fixture tem dado', () => {
    expect(blockHasData(block, makeSnapshotFixture())).toBe(true);
  });

  it('Instagram desconectado: sem dado', () => {
    const snap = { ...makeSnapshotFixture(), instagram_connected: false } as ReportDocSnapshot;
    expect(blockHasData(block, snap)).toBe(false);
  });

  it('melhor post abaixo de 1x some; sem permalink a frase fica sem link', () => {
    const h = baseHealth();
    const low = renderBlock(withHealth({ ...h, best_post: { ...h.best_post!, ratio: 0.8 } }));
    expect(low.container.querySelector('.rb-health-best')).toBeNull();
    low.unmount();

    const noLink = renderBlock(
      withHealth({ ...h, best_post: { ...h.best_post!, permalink: null, thumbnail_url: null } }),
    );
    expect(noLink.container.querySelector('.rb-health-best')?.textContent).toContain('teve 2,2x');
    expect(screen.queryByRole('link')).toBeNull();
    expect(noLink.container.querySelector('.rb-health-best img')).toBeNull();
    noLink.unmount();

    const bad = renderBlock(
      withHealth({ ...h, best_post: { ...h.best_post!, permalink: 'javascript:alert(1)' } }),
    );
    expect(screen.queryByRole('link')).toBeNull();
    bad.unmount();

    const none = renderBlock(withHealth({ ...h, best_post: null }));
    expect(none.container.querySelector('.rb-health-best')).toBeNull();
  });

  it('fontes mistas: etiqueta por métrica e as duas notas de rodapé', () => {
    const h = baseHealth();
    const snap = withHealth({
      ...h,
      benchmarks: {
        ...h.benchmarks,
        posts_30d: { ...h.benchmarks.posts_30d!, source: 'mesaas', sample_size: 340 },
      },
    });
    const { container } = renderBlock(snap);
    expect(container.querySelectorAll('.rb-health-src').length).toBe(4);
    expect(screen.getByText('À frente de 44% das contas do seu tamanho')).toBeInTheDocument();
    expect(
      screen.getByText(
        '*Comparado com mais de 300 contas do seu tamanho no Mesaas (de 5 mil a 20 mil seguidores).',
      ),
    ).toBeInTheDocument();
    // Média sem "cerca de" quando as fontes se misturam.
    expect(
      screen.getByText(
        'Somando as 4 métricas, você está à frente de 57% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
  });

  it('métrica sem valor mostra "Sem dados suficientes" com o motivo', () => {
    const h = baseHealth();
    renderBlock(withHealth({ ...h, metrics: { ...h.metrics, reel_views: null } }));
    expect(screen.getByText('Sem dados suficientes.')).toBeInTheDocument();
    expect(
      screen.getByText('Precisa de pelo menos 3 reels nos últimos 90 dias.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Somando as 3 métricas, você está à frente de cerca de 44% das contas do seu tamanho.',
      ),
    ).toBeInTheDocument();
  });

  it('BlockRenderer: largura cheia mesmo com size persistido menor', () => {
    const layout: ReportLayout = {
      version: 1,
      blocks: [{ id: 'h', type: 'account_health', size: 'third' } as ReportBlock],
    };
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const cell = container.querySelector('[data-block-id="h"]');
    expect(cell?.className).toBe('rb-full');
    expect(cell?.textContent).toContain('Saúde do Instagram');
  });
});

describe('registro do tipo', () => {
  it('account_health é tipo de bloco, no catálogo como Conteúdo do Instagram, só largura cheia', () => {
    expect(BLOCK_TYPES).toContain('account_health');
    expect(WIDGET_CATALOG.find((w) => w.type === 'account_health')).toEqual({
      type: 'account_health',
      label: 'Saúde do Instagram',
      category: 'Conteúdo',
      platform: 'instagram',
    });
    expect(FULL_WIDTH_ONLY_TYPES).toEqual(['cover', 'account_health']);
    expect(isFullWidthOnly('account_health')).toBe(true);
    expect(isFullWidthOnly('top_posts')).toBe(false);
  });
});

describe('safeHttpsUrl', () => {
  it('aceita só https sem credenciais', () => {
    expect(safeHttpsUrl('https://www.instagram.com/p/abc/')).toBe(
      'https://www.instagram.com/p/abc/',
    );
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('http://www.instagram.com/p/abc/')).toBeNull();
    expect(safeHttpsUrl('https://user:pw@instagram.com/')).toBeNull();
    expect(safeHttpsUrl('not a url')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
    expect(safeHttpsUrl('')).toBeNull();
  });
});
