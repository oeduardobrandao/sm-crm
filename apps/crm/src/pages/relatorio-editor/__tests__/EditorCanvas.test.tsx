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
    expect(screen.getAllByLabelText('Aumentar largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Diminuir largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });

  it('excluir chama onChange com o bloco removido', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual(['a']);
  });

  it('aumentar largura chama onChange com o size seguinte', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Aumentar largura')[1]);
    expect(onChange.mock.calls[0][0].blocks[1].size).toBe('half');
  });

  it('diminuir largura em third não dispara onChange (no-op preservado)', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Diminuir largura')[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renderTextBlock substitui o render do bloco textual', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 't', type: 'text', size: 'full', text: { type: 'doc', content: [] } }],
    };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        renderTextBlock={() => <div data-testid="tiptap-slot" />}
      />,
    );
    expect(screen.getByTestId('tiptap-slot')).toBeInTheDocument();
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
});
