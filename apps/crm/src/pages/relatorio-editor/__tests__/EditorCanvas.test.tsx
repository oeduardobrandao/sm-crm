import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { EditorCanvas } from '../EditorCanvas';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { sectionizeLayout } from '@mesaas/report-blocks/types';
import { readCrmCss } from '@/test/readCrmCss';

vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));

// O canvas recebe o layout canônico (as páginas rodam sectionizeLayout ao
// abrir); os fixtures legados passam pelo mesmo caminho.
const layout = (): ReportLayout =>
  sectionizeLayout({
    version: 1,
    blocks: [
      { id: 'a', type: 'cover', size: 'full' },
      { id: 'b', type: 'kpi_reach', size: 'third' },
    ],
  });
const contentIds = (l: ReportLayout) =>
  l.blocks.filter((b) => b.type !== 'section').map((b) => b.id);

describe('EditorCanvas', () => {
  it('renderiza os widgets com chrome: alça, largura e excluir por bloco', () => {
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={() => {}} />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reordenar bloco')).toHaveLength(2);
    // A capa é sempre largura cheia (spec 2026-08-25): só o kpi_reach (block 'b')
    // tem os botões de largura.
    expect(screen.getAllByLabelText('Aumentar largura')).toHaveLength(1);
    expect(screen.getAllByLabelText('Diminuir largura')).toHaveLength(1);
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });

  it('excluir chama onChange com o bloco removido', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(contentIds(onChange.mock.calls[0][0])).toEqual(['a']);
  });

  it('com onRemoveBlock: excluir chama onRemoveBlock(id) e NÃO onChange', () => {
    const onChange = vi.fn();
    const onRemoveBlock = vi.fn();
    render(
      <EditorCanvas
        layout={layout()}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
        onRemoveBlock={onRemoveBlock}
      />,
    );
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    expect(onRemoveBlock).toHaveBeenCalledTimes(1);
    expect(onRemoveBlock).toHaveBeenCalledWith('b');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('aumentar largura chama onChange com o size seguinte', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Aumentar largura')[0]);
    const next: ReportLayout = onChange.mock.calls[0][0];
    expect(next.blocks.find((b) => b.id === 'b')?.size).toBe('half');
  });

  it('diminuir largura em third não dispara onChange (no-op preservado)', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Diminuir largura')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renderTextBlock substitui o render do bloco textual', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 't', type: 'text', size: 'full', text: { type: 'doc', content: [] } }],
    };
    const { container } = render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        renderTextBlock={() => <div data-testid="tiptap-slot" />}
      />,
    );
    expect(screen.getByTestId('tiptap-slot')).toBeInTheDocument();
    // O slot substituído entra no MIOLO da célula (.rb-edit-body), nunca como
    // filho direto de [data-block-id] -- senão a célula nunca fica :empty
    // quando o widget não tem dados (ver teste do placeholder abaixo).
    expect(
      container.querySelector('.rb-edit-body [data-testid="tiptap-slot"]'),
    ).toBeInTheDocument();
  });

  it('widget sem dados: placeholder nomeia o widget e explica a omissão', () => {
    const snap = makeSnapshotFixture();
    snap.kpis.profile_views = { value: null, unit: 'count', prev: null };
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 'k', type: 'kpi_profile_views', size: 'third' }],
    };
    const { container } = render(<EditorCanvas layout={l} snapshot={snap} onChange={() => {}} />);
    const cell = container.querySelector('[data-block-id="k"]') as HTMLElement;
    const nodata = cell.querySelector('.rb-edit-nodata') as HTMLElement;
    expect(nodata).toBeInTheDocument();
    expect(nodata).toHaveTextContent('Visitas ao perfil');
    expect(nodata).toHaveTextContent('Sem dados neste período');
  });

  it('cabeçalho de seção com onConfigChange: inputs editáveis de título e subtítulo', () => {
    const onConfigChange = vi.fn();
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 's', type: 'section_header', size: 'full', config: { title: 'Métricas' } }],
    };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        onConfigChange={onConfigChange}
      />,
    );
    const title = screen.getByRole('textbox', { name: 'Título da seção' });
    expect(title).toHaveValue('Métricas');
    fireEvent.change(title, { target: { value: 'Números do mês' } });
    expect(onConfigChange).toHaveBeenCalledWith('s', { title: 'Números do mês' });
    const subtitle = screen.getByRole('textbox', { name: 'Subtítulo da seção' });
    fireEvent.change(subtitle, { target: { value: 'Julho' } });
    expect(onConfigChange).toHaveBeenCalledWith('s', { subtitle: 'Julho' });
  });

  it('sem onConfigChange o cabeçalho segue estático (view do widget)', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 's', type: 'section_header', size: 'full', config: { title: 'Métricas' } }],
    };
    render(<EditorCanvas layout={l} snapshot={makeSnapshotFixture()} onChange={() => {}} />);
    expect(screen.queryByRole('textbox', { name: 'Título da seção' })).not.toBeInTheDocument();
    expect(screen.getByText('Métricas')).toBeInTheDocument();
  });

  it('bloco em highlight recebe a classe de destaque', () => {
    const { container } = render(
      <EditorCanvas
        layout={layout()}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        highlightId="b"
      />,
    );
    const cell = container.querySelector('[data-block-id="b"]');
    expect(cell?.className).toContain('rb-edit-highlight');
  });

  it('toolbar do editor é alcançável por teclado (focus-within na célula, sem display none)', () => {
    const css = readCrmCss();
    expect(css.length).toBeGreaterThan(100000);
    const block = css.slice(css.indexOf('.rb-edit-toolbar'));
    expect(block).toContain('.rb-edit-cell:focus-within .rb-edit-toolbar');
    const toolbarRule = block.slice(0, block.indexOf('}'));
    expect(toolbarRule).not.toContain('display: none');
  });

  it('capa com onConfigChange: usa o CoverEditor e some com os botões de largura', () => {
    const onConfigChange = vi.fn();
    const l: ReportLayout = { version: 1, blocks: [{ id: 'c', type: 'cover', size: 'full' }] };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        onConfigChange={onConfigChange}
      />,
    );
    const title = screen.getByRole('textbox', { name: 'Título da capa' });
    fireEvent.change(title, { target: { value: 'Julho especial' } });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: 'Julho especial' });
    expect(screen.queryByLabelText('Aumentar largura')).not.toBeInTheDocument();
  });

  it('layout com bloco TikTok: capa deriva o kicker e o bloco TikTok lê snapshot.tiktok', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'c', type: 'cover', size: 'full' },
        { id: 't', type: 'tiktok_kpi_views', size: 'third' },
      ],
    };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        onConfigChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Texto de destaque da capa' })).toHaveValue(
      'Relatório mensal · TikTok',
    );
    expect(screen.getByText('152.300')).toBeInTheDocument();
  });

  it('bloco TikTok sem seção TikTok no snapshot: placeholder de sem dados', () => {
    const { container } = render(
      <EditorCanvas
        layout={{ version: 1, blocks: [{ id: 't', type: 'tiktok_kpi_views', size: 'third' }] }}
        snapshot={makeSnapshotFixture({ tiktok: null })}
        onChange={() => {}}
      />,
    );
    expect(container.querySelector('.rb-kpi')).toBeNull();
    expect(container.querySelector('[data-block-id="t"]')).toHaveTextContent(/sem dados/i);
  });

  it('bloco image: botão Ajustes da imagem na toolbar e área de soltar no corpo', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditorCanvas
          layout={{ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] }}
          snapshot={makeSnapshotFixture()}
          onChange={() => {}}
          onConfigChange={() => {}}
          imageContext={{ mode: 'template' }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Ajustes da imagem')).toBeInTheDocument();
    expect(screen.getByText('Espaço para imagem')).toBeInTheDocument();
  });

  it('botão Ajustes da imagem abre e fecha o popover', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditorCanvas
          layout={{ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] }}
          snapshot={makeSnapshotFixture()}
          onChange={() => {}}
          onConfigChange={() => {}}
          imageContext={{ mode: 'template' }}
        />
      </QueryClientProvider>,
    );
    const toggle = screen.getByRole('button', { name: 'Ajustes da imagem' });
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Orientação')).toBeInTheDocument();
    // O Radix só passa a ouvir pointerdown fora depois de um tique.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    // pointerdown no próprio botão não conta como "fora": o clique fecha.
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Orientação')).not.toBeInTheDocument();
  });

  it('bloco image sem imageContext: sem botão de ajustes nem área de soltar', () => {
    render(
      <EditorCanvas
        layout={{ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] }}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        onConfigChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Ajustes da imagem')).not.toBeInTheDocument();
    expect(screen.queryByText('Espaço para imagem')).not.toBeInTheDocument();
  });
});

// ── Seções (spec 2026-10-28-report-platform-sections §Editor) ──

const sectioned = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'g', type: 'section', size: 'full' },
    { id: 'cv', type: 'cover', size: 'full' },
    { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
    { id: 'r', type: 'kpi_reach', size: 'third' },
    { id: 'v', type: 'kpi_views', size: 'third' },
    { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
    { id: 'tv', type: 'tiktok_kpi_views', size: 'third' },
  ],
});

function renderSectioned(overrides: Partial<Parameters<typeof EditorCanvas>[0]> = {}) {
  const props = {
    layout: sectioned(),
    snapshot: makeSnapshotFixture(),
    onChange: vi.fn(),
    onAddWidget: vi.fn(),
    onAddSection: vi.fn(),
    onRemoveSection: vi.fn(),
    onSectionConfigChange: vi.fn(),
    tiktokEnabled: true,
    ...overrides,
  };
  const utils = render(<EditorCanvas {...props} />);
  return { ...utils, props };
}

const frame = (name: string) => screen.getByRole('region', { name: `Seção ${name}` });
const frameIds = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-section-id]')].map((el) =>
    el.getAttribute('data-section-id'),
  );
const cellIds = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-block-id]')].map((c) => c.getAttribute('data-block-id'));

describe('EditorCanvas: seções', () => {
  it('um frame por seção, com cabeçalho e os blocos dentro, cada um com o próprio grid', () => {
    const { container } = renderSectioned();
    expect(frameIds(container)).toEqual(['g', 'ig', 'tt']);
    expect(cellIds(frame('Geral'))).toEqual(['cv']);
    expect(cellIds(frame('Instagram'))).toEqual(['r', 'v']);
    expect(cellIds(frame('TikTok'))).toEqual(['tv']);
    for (const name of ['Geral', 'Instagram', 'TikTok']) {
      expect(frame(name).querySelectorAll('.rb-grid.rb-mode-edit')).toHaveLength(1);
      expect(
        within(frame(name)).getByRole('textbox', { name: `Título da seção ${name}` }),
      ).toBeInTheDocument();
    }
    // Marcador não vira célula de bloco.
    expect(container.querySelector('[data-block-id="ig"]')).toBeNull();
  });

  it('nenhum selo de plataforma por bloco (a seção já diz)', () => {
    const { container } = renderSectioned();
    const tv = container.querySelector('[data-block-id="tv"]') as HTMLElement;
    expect(within(tv).queryByText('TikTok')).not.toBeInTheDocument();
    const r = container.querySelector('[data-block-id="r"]') as HTMLElement;
    expect(within(r).queryByText('Instagram')).not.toBeInTheDocument();
  });

  it('"Adicionar widget" do rodapé abre o drawer com o alvo da seção', () => {
    const { props } = renderSectioned();
    const btn = within(frame('TikTok')).getByRole('button', {
      name: 'Adicionar widget na seção TikTok',
    });
    expect(btn).toHaveTextContent('Adicionar widget');
    fireEvent.click(btn);
    expect(props.onAddWidget).toHaveBeenCalledWith({ sectionId: 'tt' });
  });

  it('seção TikTok sem feature_tiktok: renderiza e pode ser removida, mas sem "Adicionar widget"', () => {
    const { props } = renderSectioned({ tiktokEnabled: false });
    const tt = frame('TikTok');
    expect(cellIds(tt)).toEqual(['tv']);
    expect(within(tt).queryByRole('button', { name: /Adicionar widget/ })).toBeNull();
    expect(
      within(frame('Instagram')).getByRole('button', {
        name: 'Adicionar widget na seção Instagram',
      }),
    ).toBeInTheDocument();
    fireEvent.click(within(tt).getByRole('button', { name: 'Remover seção' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(props.onRemoveSection).toHaveBeenCalledWith('tt');
  });

  it('mover para baixo troca as seções', () => {
    const { props } = renderSectioned();
    fireEvent.click(within(frame('Instagram')).getByRole('button', { name: 'Mover para baixo' }));
    const next: ReportLayout = props.onChange.mock.calls[0][0];
    expect(next.blocks.map((b) => b.id)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
  });

  it('ocultar título liga hideHeader na seção de plataforma', () => {
    const { props } = renderSectioned();
    fireEvent.click(
      within(frame('Instagram')).getByRole('button', { name: 'Ocultar título no relatório' }),
    );
    const next: ReportLayout = props.onChange.mock.calls[0][0];
    expect(next.blocks.find((b) => b.id === 'ig')?.config).toEqual({
      platform: 'instagram',
      hideHeader: true,
    });
  });

  it('renomear passa por onSectionConfigChange', () => {
    const { props } = renderSectioned();
    fireEvent.change(
      within(frame('Instagram')).getByRole('textbox', { name: 'Título da seção Instagram' }),
      { target: { value: 'Instagram da clínica' } },
    );
    expect(props.onSectionConfigChange).toHaveBeenCalledWith('ig', {
      title: 'Instagram da clínica',
    });
  });

  it('"Adicionar seção" entre as seções e depois da última, com a âncora certa', () => {
    const { props } = renderSectioned({ layout: sectioned() });
    const triggers = screen.getAllByRole('button', { name: 'Adicionar seção' });
    expect(triggers).toHaveLength(3);
    // Com o mock, cada menu lista os itens: o Geral do 2º menu entra depois do Instagram.
    const gerais = screen.getAllByRole('button', { name: /^Geral\s*Texto, imagens/ });
    fireEvent.click(gerais[1]);
    expect(props.onAddSection).toHaveBeenCalledWith('general', 'ig');
    fireEvent.click(gerais[2]);
    expect(props.onAddSection).toHaveBeenCalledWith('general', 'tt');
  });

  it('layout vazio: só "Adicionar seção"', () => {
    const { props } = renderSectioned({ layout: { version: 1, blocks: [] } });
    expect(screen.getAllByRole('button', { name: 'Adicionar seção' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Instagram/ }));
    expect(props.onAddSection).toHaveBeenCalledWith('instagram', null);
  });

  it('sem feature_tiktok o "Adicionar seção" não oferece TikTok; documento sem dados desabilita', () => {
    renderSectioned({
      layout: { version: 1, blocks: [{ id: 'g', type: 'section', size: 'full' }] },
      tiktokEnabled: false,
    });
    expect(screen.queryByRole('button', { name: /^TikTok/ })).toBeNull();
  });

  it('documento sem TikTok no snapshot: TikTok desabilitado com a dica', () => {
    renderSectioned({
      layout: { version: 1, blocks: [{ id: 'g', type: 'section', size: 'full' }] },
      availablePlatforms: ['instagram'],
    });
    const tt = screen.getByRole('button', { name: /^TikTok/ });
    expect(tt).toBeDisabled();
    expect(tt).toHaveTextContent(
      'Sem dados do TikTok neste relatório. Atualize os dados depois de conectar a conta.',
    );
  });

  // dnd-kit mede os droppables com getBoundingClientRect, que no jsdom é sempre
  // zero: um retângulo fixo por frame e por célula, na ordem do documento. A
  // alça herda o retângulo do frame/célula que a contém (as coordenadas
  // iniciais do teclado partem dela) e o DragOverlay, o do item arrastado (é
  // onde ele nasce).
  const TOPS: Record<string, number> = { g: 0, cv: 100, ig: 300, r: 400, v: 500, tt: 700, tv: 800 };
  function mockRects(_container: HTMLElement) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const overlay =
        this.closest('[data-drag-overlay]') ?? this.querySelector('[data-drag-overlay]');
      const owner = this.closest('[data-section-id], [data-block-id]');
      const id =
        overlay?.getAttribute('data-drag-overlay') ??
        owner?.getAttribute('data-block-id') ??
        owner?.getAttribute('data-section-id');
      const top = id != null ? (TOPS[id] ?? 0) : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 800,
        bottom: top + 80,
        width: 800,
        height: 80,
        toJSON: () => ({}),
      } as DOMRect;
    });
  }

  // O KeyboardSensor só passa a ouvir as teclas seguintes depois de um tique.
  const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));

  it('arrastar a seção pelo cabeçalho (teclado) reordena as seções', async () => {
    const { container, props } = renderSectioned();
    mockRects(container);
    const handle = within(frame('Instagram')).getByRole('button', { name: 'Reordenar seção' });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(props.onChange).toHaveBeenCalledTimes(1);
    const next: ReportLayout = props.onChange.mock.calls[0][0];
    expect(next.blocks.map((b) => b.id)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
  });

  it('arrastar um bloco (teclado): reordena dentro da seção, nunca sai dela', async () => {
    const { container, props } = renderSectioned();
    mockRects(container);
    const cell = (id: string) => container.querySelector(`[data-block-id="${id}"]`) as HTMLElement;
    // r desce para o lugar de v (mesma seção).
    let handle = within(cell('r')).getByRole('button', { name: 'Reordenar bloco' });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual([
      'g',
      'cv',
      'ig',
      'v',
      'r',
      'tt',
      'tv',
    ]);
    props.onChange.mockClear();
    await tick();
    // v é o último do Instagram: abaixo dele só há a seção TikTok, fora do alcance.
    handle = within(cell('v')).getByRole('button', { name: 'Reordenar bloco' });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
