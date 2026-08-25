import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorCanvas } from '../EditorCanvas';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'a', type: 'cover', size: 'full' },
    { id: 'b', type: 'kpi_reach', size: 'third' },
  ],
});

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
    expect(onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual(['a']);
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
    expect(onChange.mock.calls[0][0].blocks[1].size).toBe('half');
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
    const css = readFileSync(join(__dirname, '../../../../style.css'), 'utf8');
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
});
