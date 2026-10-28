import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BLOCK_COMPONENTS, BlockRenderer, SIZE_CLASS } from '../BlockRenderer';
import { BLOCK_TYPES } from '../types';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';
import sectionFixtures from '../../../supabase/tests/fixtures/report_section_layouts.json';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'b1', type: 'cover', size: 'full' },
    { id: 'b2', type: 'section_header', size: 'full', config: { title: 'Métricas principais' } },
    {
      id: 'b3',
      type: 'text',
      size: 'full',
      text: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Análise do gestor' }] }],
      },
    },
    { id: 'b4', type: 'divider', size: 'full' },
    // Tipo fora do catálogo (futuro): ignorado em view/print, nunca quebra.
    { id: 'b5', type: 'unknown_widget' as never, size: 'full' },
  ],
};

describe('BlockRenderer', () => {
  it('renderiza capa, cabeçalho de seção e texto a partir do snapshot', () => {
    render(<BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument(); // branding.workspace_name
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument(); // period.label
    expect(screen.getByText('Métricas principais')).toBeInTheDocument();
    expect(screen.getByText('Análise do gestor')).toBeInTheDocument();
  });

  it('bloco desconhecido não renderiza nada e não explode', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelectorAll('[data-block-id]').length).toBe(4); // b5 fora
  });

  it('aplica o accent resolvido como CSS var no root', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const root = container.querySelector('.rb-grid') as HTMLElement;
    expect(root.style.getPropertyValue('--rb-accent')).not.toBe('');
    expect(root.style.getPropertyValue('--rb-accent-fg')).not.toBe('');
  });

  it('widget sem dados: o wrapper existe mas fica vazio (colapsa via CSS)', () => {
    const emptyLayout: ReportLayout = {
      version: 1,
      blocks: [
        // section_header sem config.title: SectionHeaderBlock rende null.
        { id: 'empty', type: 'section_header', size: 'full' },
        {
          id: 'filled',
          type: 'text',
          size: 'full',
          text: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }],
          },
        },
      ],
    };
    const { container } = render(
      <BlockRenderer layout={emptyLayout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const wrapper = container.querySelector('[data-block-id="empty"]') as HTMLElement;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.childNodes.length).toBe(0);
  });

  it('styles.css define a regra de colapso do wrapper vazio', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toContain('[data-block-id]:empty');
  });

  it('bloco com type "__proto__" ou "constructor" não explode e não renderiza nada (guard de prototype-pollution)', () => {
    // BLOCK_COMPONENTS é um objeto literal: sem o guard hasOwnProperty, o
    // lookup ["__proto__"] resolveria para Object.prototype (herdado,
    // truthy) e ["constructor"] resolveria para Object (também herdado,
    // truthy) -- o React tentaria renderizar um desses como componente e
    // explodiria, em vez de tratar o bloco como tipo desconhecido (mesmo
    // caminho do teste "bloco desconhecido não renderiza nada e não
    // explode" acima: nem o wrapper [data-block-id] chega a existir).
    const hostileLayout: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'hostile-proto', type: '__proto__' as never, size: 'full' },
        { id: 'hostile-ctor', type: 'constructor' as never, size: 'full' },
        {
          id: 'still-works',
          type: 'text',
          size: 'full',
          text: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }],
          },
        },
      ],
    };
    const { container } = render(
      <BlockRenderer layout={hostileLayout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelector('[data-block-id="hostile-proto"]')).toBeNull();
    expect(container.querySelector('[data-block-id="hostile-ctor"]')).toBeNull();
    expect(container.querySelector('[data-block-id="still-works"]')).toBeInTheDocument();
  });

  it('tema explicito: container ganha classe e vars de tema', () => {
    const { container } = render(
      <BlockRenderer
        layout={{ version: 1, theme: 'editorial', blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const grid = container.querySelector('.rb-grid') as HTMLElement;
    expect(grid.classList.contains('rb-theme-editorial')).toBe(true);
    expect(grid.style.getPropertyValue('--rb-bg')).toBe('#faf6ee');
  });

  it('modo herdado: sem classe de tema, sem var de fundo (byte-identico)', () => {
    const { container } = render(
      <BlockRenderer
        layout={{ version: 1, blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const grid = container.querySelector('.rb-grid') as HTMLElement;
    expect(grid.className).not.toContain('rb-theme-');
    expect(grid.style.getPropertyValue('--rb-bg')).toBe('');
    expect(grid.style.getPropertyValue('--rb-accent')).toBe('#7c3aed');
  });

  it('fonts definido: link do Google Fonts renderizado; ausente: nenhum link', () => {
    render(
      <BlockRenderer
        layout={{ version: 1, fonts: 'fraunces', blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(
      document.querySelector('link[href*="fonts.googleapis.com"][href*="Fraunces"]'),
    ).not.toBeNull();
  });

  it('SIZE_CLASS mapeia os três tamanhos', () => {
    expect(SIZE_CLASS).toEqual({ third: 'rb-third', half: 'rb-half', full: 'rb-full' });
  });

  it('styles.css tem as regras de modo edição', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toContain('.rb-grid.rb-mode-edit .rb-edit-body:empty');
    expect(css).toContain('Sem dados no período');
  });

  it('cover com size persistido != full: renderiza como largura cheia mesmo assim (defesa contra dado antigo/inválido)', () => {
    const badLayout: ReportLayout = {
      version: 1,
      blocks: [{ id: 'c', type: 'cover', size: 'third' }],
    };
    const { container } = render(
      <BlockRenderer layout={badLayout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const wrapper = container.querySelector('[data-block-id="c"]') as HTMLElement;
    expect(wrapper.className).toBe('rb-full');
  });
});

describe('BlockRenderer: tipos TikTok', () => {
  it("unknown type 'tiktok_future' renders nothing", () => {
    const { container } = render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'a', type: 'divider', size: 'full' },
            { id: 'f', type: 'tiktok_future' as never, size: 'full' },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('[data-block-id="f"]')).toBeNull();
    expect(container.querySelectorAll('[data-block-id]').length).toBe(1);
  });

  it('todo tipo tiktok_* do BLOCK_TYPES tem componente', () => {
    for (const t of BLOCK_TYPES.filter((x) => x.startsWith('tiktok_'))) {
      expect(BLOCK_COMPONENTS[t], t).toBeDefined();
    }
  });

  it("cover kicker 'Instagram e TikTok' when layout mixes", () => {
    render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'c', type: 'cover', size: 'full' },
            { id: 'k1', type: 'kpi_reach', size: 'third' },
            { id: 't1', type: 'tiktok_kpi_views', size: 'third' },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Relatório mensal · Instagram e TikTok')).toBeInTheDocument();
    // Handle da primeira plataforma do layout (Instagram aqui).
    expect(screen.getByText('@dra.exemplo · Dermatologia · São Paulo')).toBeInTheDocument();
  });

  it('cover de relatório só TikTok: kicker TikTok e handle do TikTok', () => {
    render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'c', type: 'cover', size: 'full' },
            { id: 't1', type: 'tiktok_kpi_views', size: 'third' },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Relatório mensal · TikTok')).toBeInTheDocument();
    expect(screen.getByText('@seucliente · Dermatologia · São Paulo')).toBeInTheDocument();
  });

  it('relatório só TikTok (instagram_connected false): bloco Instagram omitido, TikTok renderiza', () => {
    const { container } = render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'k1', type: 'kpi_views', size: 'third' },
            { id: 't1', type: 'tiktok_kpi_views', size: 'third' },
          ],
        }}
        snapshot={makeSnapshotFixture({ instagram_connected: false })}
        mode="view"
      />,
    );
    expect((container.querySelector('[data-block-id="k1"]') as HTMLElement).innerHTML).toBe('');
    expect(screen.queryByText('88.400')).not.toBeInTheDocument();
    expect(screen.getByText('152.300')).toBeInTheDocument();
  });
});

// Fixtures compartilhadas com o validador (Deno + SQL): uma cópia só de cada layout.
const FIXTURES = sectionFixtures as { name: string; valid: boolean; layout: ReportLayout }[];
function fixtureLayout(name: string): ReportLayout {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture ausente: ${name}`);
  return f.layout;
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Layouts legados cujo DOM foi gravado do renderer ANTERIOR às seções (spec §Rendering:
 * um grid só, sem wrapper, então a fronteira de seção no meio de uma linha não muda nada). */
const LEGACY_PARITY: Record<string, ReportLayout> = {
  // Layout padrão de hoje (só Instagram), com capa, resumo e "Próximos passos".
  'legacy-default': fixtureLayout('legacy: default Instagram layout'),
  // Texto em terço na Geral, cabeçalho sem título (colapsa) e Alcance em terço na seção do
  // Instagram: a fronteira Geral -> Instagram cai no meio da linha.
  'legacy-midrow-section-header': {
    version: 1,
    blocks: [
      { id: 'c', type: 'cover', size: 'full' },
      { id: 't', type: 'text', size: 'third', text: doc('Nota do gestor') },
      { id: 'h', type: 'section_header', size: 'full' },
      { id: 'r', type: 'kpi_reach', size: 'third' },
      { id: 'h2', type: 'section_header', size: 'full', config: { title: 'Publicações' } },
      { id: 'p', type: 'top_posts', size: 'full', config: { count: 3 } },
    ],
  },
  // Trecho misto TikTok -> Instagram: o corte cai antes de Alcance, no meio da linha.
  'legacy-midrow-mixed-platform': {
    version: 1,
    blocks: [
      { id: 'c', type: 'cover', size: 'full' },
      { id: 'h', type: 'section_header', size: 'full', config: { title: 'Números' } },
      { id: 'v', type: 'tiktok_kpi_views', size: 'third' },
      { id: 't', type: 'text', size: 'third', text: doc('Comentário') },
      { id: 'r', type: 'kpi_reach', size: 'third' },
      { id: 's', type: 'kpi_saves', size: 'third' },
    ],
  },
};

describe('BlockRenderer: paridade de DOM do legado', () => {
  for (const [name, legacy] of Object.entries(LEGACY_PARITY)) {
    for (const mode of ['view', 'print'] as const) {
      it(`${name} (${mode}): mesmo innerHTML de antes das seções`, async () => {
        const { container } = render(
          <BlockRenderer layout={legacy} snapshot={makeSnapshotFixture()} mode={mode} />,
        );
        await expect(container.innerHTML).toMatchFileSnapshot(
          `./__snapshots__/${name}.${mode}.html`,
        );
      });
    }
  }

  it('legado IG-TT-IG: a segunda sequência do Instagram vai para a seção do Instagram (reordenação documentada)', () => {
    // Não é regressão: spec 2026-10-28-report-platform-sections §Reading. toSections junta
    // trechos da mesma plataforma numa seção só, então kpi_saves sobe para antes do TikTok.
    // Nenhum dado de prod tem esse formato (só o editor do #766, não mergeado, escreveria).
    const { container } = render(
      <BlockRenderer
        layout={fixtureLayout('legacy: Instagram and TikTok mixed freely')}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const ids = [...container.querySelectorAll('.rb-grid > [data-block-id]')].map(
      (el) => (el as HTMLElement).dataset.blockId,
    );
    expect(ids).toEqual(['a', 'c', 'b']);
    // Seções inferidas do legado escondem o título.
    expect(container.querySelector('.rb-platform-heading')).toBeNull();
  });

  it('legado com Instagram desconectado: sub-cabeçalhos seguem como hoje (sem título de plataforma)', () => {
    const { container } = render(
      <BlockRenderer
        layout={fixtureLayout('legacy: default Instagram layout')}
        snapshot={makeSnapshotFixture({ instagram_connected: false })}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-platform-heading')).toBeNull();
    expect(screen.getByText('Métricas principais')).toBeInTheDocument();
    expect(screen.getByText('Audiência')).toBeInTheDocument();
  });
});

describe('BlockRenderer: seções de plataforma', () => {
  const canonical = fixtureLayout('canonical: default (Geral, Instagram, TikTok, Geral)');
  const contentCount = canonical.blocks.filter((b) => b.type !== 'section').length;

  it('um .rb-grid só; blocos seguem filhos diretos; um título por seção de plataforma', () => {
    const { container } = render(
      <BlockRenderer layout={canonical} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const grids = container.querySelectorAll('.rb-grid');
    expect(grids.length).toBe(1);
    const grid = grids[0];
    expect(grid.querySelectorAll(':scope > [data-block-id]').length).toBe(contentCount);
    // Marcador nunca vira célula de bloco.
    expect(grid.querySelector('[data-block-id^="s_"]')).toBeNull();
    const headings = grid.querySelectorAll(':scope > .rb-platform-heading');
    expect([...headings].map((h) => h.getAttribute('data-section-id'))).toEqual([
      's_instagram',
      's_tiktok',
    ]);
    for (const h of headings) {
      expect(h.classList.contains('rb-full')).toBe(true);
      expect(h.hasAttribute('data-block-id')).toBe(false);
    }
    expect(headings[0].querySelector('h2')?.textContent).toBe('Instagram');
    expect(headings[1].querySelector('h2')?.textContent).toBe('TikTok');
    expect(headings[0].textContent).toContain('@dra.exemplo');
    expect(headings[1].textContent).toContain('@seucliente');
    // O título abre a seção: vem logo antes do primeiro bloco dela.
    expect((headings[0].nextElementSibling as HTMLElement).dataset.blockId).toBe('h_metricas');
    expect((headings[1].nextElementSibling as HTMLElement).dataset.blockId).toBe(
      'tt_followers_gained',
    );
  });

  it('Geral não ganha título, nem com title (rótulo só do editor)', () => {
    const { container } = render(
      <BlockRenderer layout={canonical} snapshot={makeSnapshotFixture()} mode="print" />,
    );
    expect(container.querySelector('[data-section-id="s_geral"]')).toBeNull();
    expect(container.querySelector('[data-section-id="s_proximos"]')).toBeNull();
  });

  it('title da seção de plataforma substitui o nome da plataforma', () => {
    const { container } = render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            {
              id: 'ig',
              type: 'section',
              size: 'full',
              config: { platform: 'instagram', title: 'Nosso Instagram' },
            },
            { id: 'r', type: 'kpi_reach', size: 'third' },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-platform-heading h2')?.textContent).toBe('Nosso Instagram');
  });

  it('styles.css: título ocupa a linha toda e não fica sozinho no pé da página impressa', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toMatch(/\.rb-platform-heading \{[^}]*grid-column: 1 \/ -1;/);
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/\.rb-platform-heading \{[^}]*break-after: avoid;/);
  });

  it('hideHeader esconde o título', () => {
    const { container } = render(
      <BlockRenderer
        layout={fixtureLayout('canonical: platform sections with hideHeader')}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-platform-heading')).toBeNull();
    expect(container.querySelectorAll('.rb-grid > [data-block-id]').length).toBe(2);
  });
});

describe('BlockRenderer: seção sem dados omitida na visualização', () => {
  const tiktokSection = (hideHeader: boolean): ReportLayout => ({
    version: 1,
    blocks: [
      { id: 'g', type: 'section', size: 'full' },
      { id: 'c', type: 'cover', size: 'full' },
      {
        id: 'tt',
        type: 'section',
        size: 'full',
        config: hideHeader ? { platform: 'tiktok', hideHeader: true } : { platform: 'tiktok' },
      },
      { id: 'tt_h', type: 'section_header', size: 'full', config: { title: 'Vídeos do mês' } },
      { id: 'tt_v', type: 'tiktok_kpi_views', size: 'third' },
      { id: 'tt_t', type: 'text', size: 'full', text: doc('Leitura do TikTok') },
    ],
  });

  for (const mode of ['view', 'print'] as const) {
    it(`${mode}: seção TikTok com título e sem snapshot.tiktok some inteira`, () => {
      const { container } = render(
        <BlockRenderer
          layout={tiktokSection(false)}
          snapshot={makeSnapshotFixture({ tiktok: null })}
          mode={mode}
        />,
      );
      expect(container.querySelector('.rb-platform-heading')).toBeNull();
      expect(screen.queryByText('Vídeos do mês')).not.toBeInTheDocument();
      expect(screen.queryByText('Leitura do TikTok')).not.toBeInTheDocument();
      for (const id of ['tt_h', 'tt_v', 'tt_t'])
        expect(container.querySelector(`[data-block-id="${id}"]`)).toBeNull();
      // A Geral segue.
      expect(container.querySelector('[data-block-id="c"]')).not.toBeNull();
    });

    it(`${mode}: com hideHeader segue a regra por bloco de hoje`, () => {
      const { container } = render(
        <BlockRenderer
          layout={tiktokSection(true)}
          snapshot={makeSnapshotFixture({ tiktok: null })}
          mode={mode}
        />,
      );
      expect(container.querySelector('.rb-platform-heading')).toBeNull();
      expect(screen.getByText('Vídeos do mês')).toBeInTheDocument();
      expect(screen.getByText('Leitura do TikTok')).toBeInTheDocument();
      expect((container.querySelector('[data-block-id="tt_v"]') as HTMLElement).innerHTML).toBe('');
    });
  }

  it('com dado do TikTok a seção aparece com título', () => {
    const { container } = render(
      <BlockRenderer layout={tiktokSection(false)} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelector('.rb-platform-heading[data-section-id="tt"]')).not.toBeNull();
    expect(screen.getByText('Vídeos do mês')).toBeInTheDocument();
  });

  it('seção de plataforma vazia (só neutros ou nada) some', () => {
    const { container } = render(
      <BlockRenderer
        layout={fixtureLayout('canonical: empty sections')}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-platform-heading')).toBeNull();

    // Só neutros (subtítulo, texto, divisor): neutros não contam como dado, então a seção
    // some inteira, sem célula nenhuma; a Geral segue.
    const { container: neutralOnly } = render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'g', type: 'section', size: 'full' },
            { id: 'c', type: 'cover', size: 'full' },
            { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
            { id: 'n_h', type: 'section_header', size: 'full', config: { title: 'Só texto' } },
            { id: 'n_t', type: 'text', size: 'full', text: doc('Comentário solto') },
            { id: 'n_d', type: 'divider', size: 'full' },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(neutralOnly.querySelector('.rb-platform-heading')).toBeNull();
    for (const id of ['n_h', 'n_t', 'n_d'])
      expect(neutralOnly.querySelector(`[data-block-id="${id}"]`)).toBeNull();
    expect(neutralOnly.querySelector('[data-block-id="c"]')).not.toBeNull();
  });

  it('Instagram desconectado: seção do Instagram com título some', () => {
    const { container } = render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
            { id: 'h', type: 'section_header', size: 'full', config: { title: 'Alcance do mês' } },
            { id: 'r', type: 'kpi_reach', size: 'third' },
          ],
        }}
        snapshot={makeSnapshotFixture({ instagram_connected: false })}
        mode="view"
      />,
    );
    expect(container.querySelector('.rb-platform-heading')).toBeNull();
    expect(screen.queryByText('Alcance do mês')).not.toBeInTheDocument();
  });

  it('capa de layout seccionado só TikTok: kicker "· TikTok" (seção vazia conta)', () => {
    render(
      <BlockRenderer
        layout={{
          version: 1,
          blocks: [
            { id: 'g', type: 'section', size: 'full' },
            { id: 'c', type: 'cover', size: 'full' },
            { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
          ],
        }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(screen.getByText('Relatório mensal · TikTok')).toBeInTheDocument();
  });
});
