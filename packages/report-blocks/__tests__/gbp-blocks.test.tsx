import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { blockHasData } from '../data-presence';
import { makeSnapshotFixture } from '../fixtures';
import { BLOCK_TYPES } from '../types';
import type { ReportBlock, ReportDocSnapshot, ReportLayout } from '../types';
import { daysInclusive, fmtRating, fmtWindowStamp } from '../blocks/gbp/format';

const GBP_TYPES = BLOCK_TYPES.filter((t) => t.startsWith('gbp_'));

const blk = (type: string): ReportBlock => ({ id: 'x', type, size: 'full' }) as ReportBlock;
const l = (types: string[]): ReportLayout => ({
  version: 1,
  blocks: types.map((t, i) => ({ id: `b${i}`, type: t, size: 'full' }) as ReportBlock),
});

function renderBlocks(types: string[], snapshot: ReportDocSnapshot = makeSnapshotFixture()) {
  return render(<BlockRenderer layout={l(types)} snapshot={snapshot} mode="view" />);
}

/** Fixture com a seção Google alterada (cópia rasa da seção). */
function withGoogle(over: Partial<NonNullable<ReportDocSnapshot['google']>>): ReportDocSnapshot {
  const snap = makeSnapshotFixture();
  return { ...snap, google: { ...snap.google!, ...over } };
}

describe('format GMN', () => {
  it('fmtRating: uma casa decimal pt-BR', () => {
    expect(fmtRating(4.82)).toBe('4,8');
    expect(fmtRating(4.75)).toBe('4,8');
    expect(fmtRating(5)).toBe('5,0');
  });

  it('daysInclusive conta os dois extremos, atravessando o mês', () => {
    expect(daysInclusive('2026-05-31', '2026-06-30')).toBe(31);
    expect(daysInclusive('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('fmtWindowStamp: mês inteiro, parcial e sem janela', () => {
    const endExclusive = '2026-11-01T00:00:00.000Z';
    const win = { start: '2026-10-01', end: '2026-10-31', prevStart: 'x', prevEnd: 'x' };
    expect(fmtWindowStamp(win, endExclusive)).toBe('01–31 de outubro');
    expect(fmtWindowStamp({ ...win, end: '2026-10-29' }, endExclusive)).toBe(
      '01–29 de outubro · parcial',
    );
    expect(fmtWindowStamp(null, endExclusive)).toBe(null);
  });
});

describe('GbpKpiCardBlock', () => {
  it('rótulo, valor pt-BR, delta e comparação com os N dias anteriores', () => {
    const { container } = renderBlocks(['gbp_kpi_profile_views']);
    expect(screen.getByText('Visualizações do perfil')).toBeInTheDocument();
    expect(screen.getByText('11.840')).toBeInTheDocument();
    expect(screen.getByText('+12,5%')).toBeInTheDocument(); // (11840-10520)/10520
    expect(screen.getByText('vs. 31 dias anteriores: 10.520')).toBeInTheDocument();
    expect(screen.getByText('01–31 de julho')).toBeInTheDocument();
    // Tooltip da aba GMN.
    expect(container.querySelector('.rb-gbp-kpi')?.getAttribute('title')).toMatch(
      /^Soma das pessoas diferentes/,
    );
  });

  it('avg_rating com uma casa decimal, nunca como contagem', () => {
    renderBlocks(['gbp_kpi_avg_rating']);
    expect(screen.getByText('Nota média')).toBeInTheDocument();
    expect(screen.getByText('4,8')).toBeInTheDocument();
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.getByText('vs. 31 dias anteriores: 4,8')).toBeInTheDocument();
    // Como na aba GMN: diferença absoluta da nota (4,82 - 4,80 = +0,0), não percentual.
    expect(screen.getByText('0,0')).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('new_reviews mostra a diferença de contagem, como na aba GMN', () => {
    renderBlocks(['gbp_kpi_new_reviews']);
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('janela parcial estampa "· parcial"; valor null não renderiza', () => {
    const snap = withGoogle({
      window: {
        start: '2026-07-01',
        end: '2026-07-29',
        prevStart: '2026-06-02',
        prevEnd: '2026-06-30',
      },
    });
    snap.google!.kpis = { ...snap.google!.kpis, calls: { value: null, prev: null, unit: 'count' } };
    const { container } = renderBlocks(['gbp_kpi_messages', 'gbp_kpi_calls'], snap);
    expect(screen.getByText('01–29 de julho · parcial')).toBeInTheDocument();
    expect(screen.getByText('vs. 29 dias anteriores: 31')).toBeInTheDocument();
    expect(container.querySelector('[data-block-id="b1"]')?.childElementCount).toBe(0);
  });
});

describe('GbpSurfacesBlock', () => {
  it('superfícies da maior para a menor, total e nota de rodapé em inteiros', () => {
    const { container } = renderBlocks(['gbp_surfaces']);
    expect(screen.getByText('Onde viram o perfil')).toBeInTheDocument();
    expect(screen.getByText('11.840 visualizações no período')).toBeInTheDocument();
    expect(screen.getByText('5.208 · 44,0%')).toBeInTheDocument();
    const labels = [...container.querySelectorAll('.rb-gbp-row-line > span:first-child')].map(
      (e) => e.textContent,
    );
    expect(labels).toEqual([
      'Pesquisa Google no celular',
      'Google Maps no celular',
      'Pesquisa Google no computador',
      'Google Maps no computador',
    ]);
    // (5208+4026)/11840 = 78%; (4026+830)/11840 = 41%.
    expect(
      screen.getByText('78% pelo celular. Maps responde por 41% das visualizações.'),
    ).toBeInTheDocument();
  });
});

describe('GbpRatingBlock', () => {
  it('nota, estrelas, totais, distribuição e rodapé quando parcial', () => {
    const { container } = renderBlocks(['gbp_rating']);
    expect(screen.getByText('Avaliações')).toBeInTheDocument();
    expect(screen.getByText('Situação em 31 de julho')).toBeInTheDocument();
    expect(screen.getByText('4,8')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '5 de 5 estrelas' })).toBeInTheDocument();
    expect(screen.getByText('612 avaliações · +24 no período')).toBeInTheDocument();
    const counts = [...container.querySelectorAll('.rb-gbp-dist-count')].map((e) => e.textContent);
    expect(counts).toEqual(['438', '41', '8', '4', '9']);
    expect(
      screen.getByText('Distribuição das últimas 200 avaliações por unidade.'),
    ).toBeInTheDocument();
  });

  it('sem rodapé quando a distribuição não é parcial', () => {
    const base = makeSnapshotFixture().google!;
    renderBlocks(
      ['gbp_rating'],
      withGoogle({ rating_distribution: { ...base.rating_distribution!, partial: false } }),
    );
    expect(screen.queryByText(/últimas 200 avaliações/)).toBeNull();
  });
});

describe('GbpActionsChartBlock', () => {
  it('barras empilhadas, eixo dd/mm e legenda com os totais', () => {
    const snap = makeSnapshotFixture();
    const { container } = renderBlocks(['gbp_actions_chart'], snap);
    expect(screen.getByText('Ações por dia')).toBeInTheDocument();
    expect(screen.getByText('O que as pessoas fizeram depois de ver o perfil')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 640 170');
    expect(container.querySelectorAll('svg g')).toHaveLength(31);
    expect(screen.getByText('01/07')).toBeInTheDocument();
    expect(screen.getByText('31/07')).toBeInTheDocument();
    const legend = container.querySelector('.rb-gbp-legend') as HTMLElement;
    const total = (f: 'calls' | 'directions' | 'websiteClicks' | 'messages') =>
      snap.google!.daily.reduce((s, d) => s + d[f], 0).toLocaleString('pt-BR');
    for (const [label, f] of [
      ['Ligações', 'calls'],
      ['Rotas', 'directions'],
      ['Site', 'websiteClicks'],
      ['Mensagens', 'messages'],
    ] as const) {
      const item = within(legend).getByText(label).closest('li') as HTMLElement;
      expect(item.textContent).toBe(`${label}${total(f)}`);
    }
  });

  it('nenhuma ação no período: não renderiza', () => {
    const daily = makeSnapshotFixture().google!.daily.map((d) => ({
      ...d,
      calls: 0,
      directions: 0,
      websiteClicks: 0,
      messages: 0,
    }));
    const { container } = renderBlocks(['gbp_actions_chart'], withGoogle({ daily }));
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('GbpKeywordsBlock', () => {
  it('termos, "menos de N", mês e rodapé', () => {
    renderBlocks(['gbp_keywords']);
    expect(screen.getByText('O que buscaram no Google')).toBeInTheDocument();
    expect(screen.getByText('Termos que mostraram o perfil')).toBeInTheDocument();
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
    expect(screen.getByText('Busca')).toBeInTheDocument();
    expect(screen.getByText('Pessoas')).toBeInTheDocument();
    expect(screen.getByText('dermatologista')).toBeInTheDocument();
    expect(screen.getByText('1.240')).toBeInTheDocument();
    expect(screen.getByText('menos de 15')).toBeInTheDocument();
    expect(
      screen.getByText('O Google só mostra o número exato acima de 15 pessoas por mês.'),
    ).toBeInTheDocument();
  });

  it('no máximo 10 termos', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      keyword: `termo ${i}`,
      value: 100 - i,
      threshold: null,
    }));
    const { container } = renderBlocks(
      ['gbp_keywords'],
      withGoogle({ keywords: { month: '2026-07', rows } }),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
  });
});

describe('GbpReviewHighlightBlock', () => {
  it('estampa, estrelas, comentário entre aspas e autor · unidade', () => {
    renderBlocks(['gbp_review_highlight']);
    expect(screen.getByText('Avaliação em destaque')).toBeInTheDocument();
    expect(screen.getByText('Avaliação de 18 de julho')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '5 de 5 estrelas' })).toBeInTheDocument();
    expect(screen.getByText(/^“Atendimento impecável/)).toBeInTheDocument();
    expect(screen.getByText('Paula R. · Unidade Jardins')).toBeInTheDocument();
  });
});

describe('GbpUnitsBlock', () => {
  it('uma linha por unidade, nota "★ 4,9 (262)", "sem nota" e autorização expirada', () => {
    const base = makeSnapshotFixture().google!;
    const unit_rows = base.unit_rows.map((u, i) =>
      i === 2 ? { ...u, status: 'revoked' as const, rating: null, reviews: null } : u,
    );
    const { container } = renderBlocks(['gbp_units'], withGoogle({ unit_rows }));
    expect(screen.getByText('Comparar unidades')).toBeInTheDocument();
    for (const h of ['Unidade', 'Visualizações', 'Ligações', 'Rotas', 'Site', 'Nota'])
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByText('★ 4,9 (262)')).toBeInTheDocument();
    expect(screen.getByText('5.120')).toBeInTheDocument();
    expect(screen.getByText('sem nota')).toBeInTheDocument();
    const revoked = screen.getByText('Autorização expirada').closest('tr') as HTMLElement;
    expect(within(revoked).getByText('Unidade Moema')).toBeInTheDocument();
  });

  it('uma unidade só: não renderiza', () => {
    const one = makeSnapshotFixture().google!.unit_rows.slice(0, 1);
    const { container } = renderBlocks(['gbp_units'], withGoogle({ unit_rows: one }));
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('blocos GMN sem snapshot.google', () => {
  it('nenhum dos 14 tipos renderiza', () => {
    for (const google of [undefined, null]) {
      const { container, unmount } = renderBlocks(GBP_TYPES, {
        ...makeSnapshotFixture(),
        google,
      });
      for (const el of container.querySelectorAll('[data-block-id]'))
        expect(el.childElementCount).toBe(0);
      unmount();
    }
  });

  it('janela null (nada sincronizado no mês): nenhum dos 14 renderiza', () => {
    const base = makeSnapshotFixture().google!;
    const unit_rows = base.unit_rows.map((u) => ({
      ...u,
      views: 0,
      calls: 0,
      directions: 0,
      website_clicks: 0,
    }));
    const { container } = renderBlocks(GBP_TYPES, withGoogle({ window: null, unit_rows }));
    for (const el of container.querySelectorAll('[data-block-id]'))
      expect(el.childElementCount).toBe(0);
  });

  it('com a fixture, os 14 renderizam e nenhum texto tem travessão', () => {
    const { container } = renderBlocks(GBP_TYPES);
    const cells = container.querySelectorAll('[data-block-id]');
    expect(cells).toHaveLength(14);
    for (const el of cells) expect(el.childElementCount).toBe(1);
    expect(container.textContent).not.toContain('—');
  });
});

describe('blockHasData: gbp_*', () => {
  it('false para todos sem snapshot.google, true com a fixture', () => {
    const none = { ...makeSnapshotFixture(), google: null };
    const full = makeSnapshotFixture();
    expect(GBP_TYPES).toHaveLength(14);
    for (const t of GBP_TYPES) {
      expect(blockHasData(blk(t), none), t).toBe(false);
      expect(blockHasData(blk(t), full), t).toBe(true);
    }
  });

  it('janela null: false para todos (nem a tabela de unidades zerada)', () => {
    const snap = withGoogle({ window: null });
    for (const t of GBP_TYPES) expect(blockHasData(blk(t), snap), t).toBe(false);
  });

  it('não consulta o Instagram: relatório sem Instagram mantém os gbp_* com dado', () => {
    const snap = { ...makeSnapshotFixture(), instagram_connected: false };
    expect(blockHasData(blk('gbp_kpi_website_clicks'), snap)).toBe(true);
    expect(blockHasData(blk('kpi_website_clicks'), snap)).toBe(false);
  });

  it('matriz de vazios por tipo', () => {
    const base = makeSnapshotFixture().google!;
    const kpis = { ...base.kpis, calls: { value: null, prev: 3, unit: 'count' as const } };
    expect(blockHasData(blk('gbp_kpi_calls'), withGoogle({ kpis }))).toBe(false);
    expect(blockHasData(blk('gbp_kpi_directions'), withGoogle({ kpis }))).toBe(true);

    const zeroSurfaces = base.surfaces.map((s) => ({ ...s, value: 0, pct: 0 }));
    expect(blockHasData(blk('gbp_surfaces'), withGoogle({ surfaces: zeroSurfaces }))).toBe(false);

    const noRating = {
      ...base.kpis,
      avg_rating: { value: null, prev: null, unit: 'rating' as const },
    };
    expect(blockHasData(blk('gbp_rating'), withGoogle({ kpis: noRating }))).toBe(false);

    const zeroDaily = base.daily.map((d) => ({
      ...d,
      calls: 0,
      directions: 0,
      websiteClicks: 0,
      messages: 0,
    }));
    expect(blockHasData(blk('gbp_actions_chart'), withGoogle({ daily: zeroDaily }))).toBe(false);
    expect(blockHasData(blk('gbp_actions_chart'), withGoogle({ daily: [] }))).toBe(false);

    expect(
      blockHasData(blk('gbp_keywords'), withGoogle({ keywords: { month: null, rows: [] } })),
    ).toBe(false);
    expect(blockHasData(blk('gbp_review_highlight'), withGoogle({ highlight: null }))).toBe(false);
    expect(
      blockHasData(blk('gbp_units'), withGoogle({ unit_rows: base.unit_rows.slice(0, 1) })),
    ).toBe(false);
    expect(
      blockHasData(blk('gbp_units'), withGoogle({ unit_rows: base.unit_rows.slice(0, 2) })),
    ).toBe(true);
  });
});
