import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { WIDGET_CATALOG } from '@mesaas/report-blocks/catalog';
import { Shapes } from 'lucide-react';
import { LayersPanel, layerLabel } from '../LayersPanel';
import { WIDGET_ICONS, widgetIcon } from '../widgetIcons';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'b-cover', type: 'cover', size: 'full' },
    { id: 'b-sec', type: 'section_header', size: 'full', config: { title: 'Crescimento' } },
    { id: 'b-kpi', type: 'kpi_reach', size: 'third' },
  ],
};

function renderPanel(overrides: Partial<Parameters<typeof LayersPanel>[0]> = {}) {
  const props = {
    layout,
    highlightId: null,
    tiktokEnabled: true,
    onReorder: vi.fn(),
    onLocate: vi.fn(),
    onAddAt: vi.fn(),
    ...overrides,
  };
  render(<LayersPanel {...props} />);
  return props;
}

describe('layerLabel', () => {
  it('usa o label do catálogo e anexa o título do cabeçalho de seção', () => {
    expect(layerLabel(layout.blocks[2])).toBe('Alcance');
    expect(layerLabel(layout.blocks[1])).toBe('Subtítulo · Crescimento');
  });

  it('tipo desconhecido cai no próprio type (tolerante)', () => {
    expect(layerLabel({ id: 'x', type: 'tipo_futuro' as never, size: 'full' })).toBe('tipo_futuro');
  });
});

const sectioned: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'g', type: 'section', size: 'full' },
    { id: 'b-cover', type: 'cover', size: 'full' },
    { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
    { id: 'b-sec', type: 'section_header', size: 'full', config: { title: 'Crescimento' } },
    { id: 'b-kpi', type: 'kpi_reach', size: 'third' },
    { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok', title: 'Vídeos' } },
    { id: 'b-tt', type: 'tiktok_kpi_views', size: 'third' },
  ],
};

const sectionItem = (name: string) =>
  screen.getByRole('listitem', { name: `Seção ${name}` }) as HTMLElement;

describe('LayersPanel: árvore de seções', () => {
  it('é uma seção permanente: aside com as seções e os blocos recuados dentro de cada uma', () => {
    renderPanel({ layout: sectioned });
    expect(screen.getByRole('complementary', { name: 'Camadas do relatório' })).toBeTruthy();
    const geral = sectionItem('Geral');
    const ig = sectionItem('Instagram');
    const tt = sectionItem('Vídeos');
    expect(within(geral).getByText('Capa')).toBeInTheDocument();
    expect(within(ig).getByText('Subtítulo · Crescimento')).toBeInTheDocument();
    expect(within(ig).getByText('Alcance')).toBeInTheDocument();
    expect(within(ig).getByText('1/3')).toBeInTheDocument();
    expect(within(tt).getByText('Visualizações')).toBeInTheDocument();
    expect(within(geral).queryByText('Alcance')).toBeNull();
    // Sem selo de plataforma por camada: a seção já diz.
    expect(within(tt).queryByText('TikTok')).toBeNull();
  });

  it('clicar na seção localiza o cabeçalho dela; clicar num bloco localiza o bloco', () => {
    const props = renderPanel({ layout: sectioned });
    fireEvent.click(within(sectionItem('Instagram')).getByRole('button', { name: 'Instagram' }));
    expect(props.onLocate).toHaveBeenCalledWith('ig');
    fireEvent.click(screen.getByText('Alcance'));
    expect(props.onLocate).toHaveBeenCalledWith('b-kpi');
  });

  it('espelha o highlight do canvas na linha ativa', () => {
    renderPanel({ layout: sectioned, highlightId: 'b-kpi' });
    const row = screen.getByText('Alcance').closest('.rb-layers-row');
    expect(row?.className).toContain('rb-layers-row-active');
    expect(screen.getByText('Capa').closest('.rb-layers-row')?.className).not.toContain(
      'rb-layers-row-active',
    );
  });

  it('alças: uma por seção e uma por bloco', () => {
    renderPanel({ layout: sectioned });
    expect(screen.getAllByRole('button', { name: 'Reordenar seção' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Reordenar camada' })).toHaveLength(4);
  });

  it('"+" dentro da seção insere NELA, na posição: { sectionId, position }', () => {
    const props = renderPanel({ layout: sectioned });
    const ig = sectionItem('Instagram');
    const plus = within(ig).getAllByRole('button', { name: /Adicionar widget em Instagram/ });
    // Antes do 1º, entre os dois e depois do último.
    expect(plus).toHaveLength(3);
    fireEvent.click(
      within(ig).getByRole('button', { name: 'Adicionar widget em Instagram, posição 2' }),
    );
    expect(props.onAddAt).toHaveBeenCalledWith({ sectionId: 'ig', position: 1 });
    fireEvent.click(plus[2]);
    expect(props.onAddAt).toHaveBeenCalledWith({ sectionId: 'ig', position: 2 });
  });

  it('seção vazia tem um "+" na posição 1', () => {
    const props = renderPanel({
      layout: { version: 1, blocks: [{ id: 'g', type: 'section', size: 'full' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget em Geral, posição 1' }));
    expect(props.onAddAt).toHaveBeenCalledWith({ sectionId: 'g', position: 0 });
  });

  it('seção TikTok sem feature_tiktok: sem "+"', () => {
    renderPanel({ layout: sectioned, tiktokEnabled: false });
    expect(
      within(sectionItem('Vídeos')).queryByRole('button', { name: /Adicionar widget/ }),
    ).toBeNull();
    expect(
      within(sectionItem('Instagram')).getAllByRole('button', { name: /Adicionar widget/ }),
    ).toHaveLength(3);
  });
});

describe('widgetIcons', () => {
  it('todo tipo do catálogo tem ícone próprio', () => {
    for (const w of WIDGET_CATALOG) {
      expect(WIDGET_ICONS[w.type], `sem ícone para ${w.type}`).toBeTruthy();
    }
  });

  it('tipo desconhecido cai no ícone genérico', () => {
    expect(widgetIcon('tipo_futuro')).toBe(Shapes);
  });
});
