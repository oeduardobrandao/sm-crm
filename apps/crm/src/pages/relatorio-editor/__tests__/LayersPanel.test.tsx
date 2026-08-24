import { fireEvent, render, screen } from '@testing-library/react';
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
    onReorder: vi.fn(),
    onLocate: vi.fn(),
    onAddAt: vi.fn(),
    onAddEnd: vi.fn(),
    ...overrides,
  };
  render(<LayersPanel {...props} />);
  return props;
}

describe('layerLabel', () => {
  it('usa o label do catálogo e anexa o título do cabeçalho de seção', () => {
    expect(layerLabel(layout.blocks[2])).toBe('Alcance');
    expect(layerLabel(layout.blocks[1])).toBe('Cabeçalho de seção · Crescimento');
  });

  it('tipo desconhecido cai no próprio type (tolerante)', () => {
    expect(layerLabel({ id: 'x', type: 'tipo_futuro' as never, size: 'full' })).toBe('tipo_futuro');
  });
});

describe('LayersPanel', () => {
  it('é uma seção permanente: aside com as camadas na ordem do layout e chip de largura', () => {
    renderPanel();
    expect(screen.getByRole('complementary', { name: 'Camadas do relatório' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('Cabeçalho de seção · Crescimento');
    expect(rows[2].textContent).toContain('Alcance');
    expect(rows[2].textContent).toContain('1/3');
  });

  it('clicar numa camada chama onLocate com o id (painel continua montado)', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByText('Alcance'));
    expect(props.onLocate).toHaveBeenCalledWith('b-kpi');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('espelha o highlight do canvas na linha ativa', () => {
    renderPanel({ highlightId: 'b-kpi' });
    const rows = screen.getAllByRole('listitem');
    expect(rows[2].querySelector('.rb-layers-row')?.className).toContain('rb-layers-row-active');
    expect(rows[0].querySelector('.rb-layers-row')?.className).not.toContain(
      'rb-layers-row-active',
    );
  });

  it('cada camada tem alça de reordenar acessível', () => {
    renderPanel();
    expect(screen.getAllByRole('button', { name: 'Reordenar camada' })).toHaveLength(3);
  });

  it('hotspots entre camadas inserem NA POSIÇÃO: n-1 hotspots, índice correto', () => {
    const props = renderPanel();
    const hotspots = screen.getAllByRole('button', { name: /Adicionar widget na posição/ });
    expect(hotspots).toHaveLength(2);
    fireEvent.click(hotspots[0]);
    expect(props.onAddAt).toHaveBeenCalledWith(1);
    fireEvent.click(hotspots[1]);
    expect(props.onAddAt).toHaveBeenCalledWith(2);
  });

  it('botão no fim da lista chama onAddEnd', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget no fim do relatório' }));
    expect(props.onAddEnd).toHaveBeenCalled();
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
