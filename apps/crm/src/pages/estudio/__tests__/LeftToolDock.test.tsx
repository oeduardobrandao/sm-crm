// RTL tests for T2.9's LeftToolDock. Mocks useImageInsert entirely (its own behavior is
// covered by useImageInsert.test.ts) and FilePickerModal (a heavy, already-tested component
// elsewhere) so this file stays focused on: each add-button calling onAddLayer with the
// EXACT default layer shape specified by the brief — asserting the full object, not just
// spot fields, so a future accidental default-drift is caught.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const imageInsertState = {
  openFileDialog: vi.fn(),
  dragDropProps: { onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() },
  isDragOver: false,
  isArquivosPickerOpen: false,
  openArquivosPicker: vi.fn(),
  closeArquivosPicker: vi.fn(),
  onArquivosPickerSelect: vi.fn(),
  fileInputRef: { current: null },
  onFileInputChange: vi.fn(),
};
const useImageInsertMock = vi.fn(() => imageInsertState);
vi.mock('../hooks/useImageInsert', () => ({
  useImageInsert: (...args: unknown[]) => useImageInsertMock(...args),
}));

vi.mock('@/pages/arquivos/components/FilePickerModal', () => ({
  FilePickerModal: () => null,
}));

import { LeftToolDock } from '../components/Dock/LeftToolDock';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

describe('LeftToolDock', () => {
  beforeEach(() => {
    useImageInsertMock.mockClear();
    imageInsertState.openFileDialog.mockClear();
    imageInsertState.openArquivosPicker.mockClear();
  });

  it('"Adicionar texto" calls onAddLayer with the exact default text layer', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));

    expect(onAddLayer).toHaveBeenCalledTimes(1);
    const layer = onAddLayer.mock.calls[0][0];
    expect(layer).toMatchObject({
      name: 'Texto',
      type: 'text',
      w: 648,
      x: (CANVAS_WIDTH - 648) / 2,
      y: (CANVAS_HEIGHT - 64 * 1.2) / 2,
      rotation: 0,
      opacity: 1,
      locked: false,
      text: 'Seu texto aqui',
      font_key: 'inter',
      font_weight: 400,
      font_size: 64,
      line_height: 1.2,
      letter_spacing: 0,
      color: '#12151a',
      align: 'left',
    });
    expect(typeof layer.id).toBe('string');
    expect(layer.id.startsWith('layer-')).toBe(true);
    expect(Object.keys(layer).sort()).toEqual(
      [
        'id',
        'name',
        'type',
        'w',
        'x',
        'y',
        'rotation',
        'opacity',
        'locked',
        'text',
        'font_key',
        'font_weight',
        'font_size',
        'line_height',
        'letter_spacing',
        'color',
        'align',
      ].sort(),
    );
  });

  it('"Adicionar forma" popover: rectangle button calls onAddLayer with the exact default rect layer', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar forma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retângulo' }));

    expect(onAddLayer).toHaveBeenCalledTimes(1);
    const layer = onAddLayer.mock.calls[0][0];
    expect(layer).toMatchObject({
      name: 'Forma',
      type: 'shape',
      shape: 'rect',
      w: 300,
      h: 300,
      x: (CANVAS_WIDTH - 300) / 2,
      y: (CANVAS_HEIGHT - 300) / 2,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: { type: 'solid', color: '#eab308' },
    });
    expect(typeof layer.id).toBe('string');
    expect(layer.id.startsWith('layer-')).toBe(true);
    expect(Object.keys(layer).sort()).toEqual(
      [
        'id',
        'name',
        'type',
        'shape',
        'w',
        'h',
        'x',
        'y',
        'rotation',
        'opacity',
        'locked',
        'fill',
      ].sort(),
    );
  });

  it('"Adicionar forma" popover: ellipse button calls onAddLayer with the exact default ellipse layer', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar forma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elipse' }));

    expect(onAddLayer).toHaveBeenCalledTimes(1);
    const layer = onAddLayer.mock.calls[0][0];
    expect(layer).toMatchObject({
      name: 'Forma',
      type: 'shape',
      shape: 'ellipse',
      w: 300,
      h: 300,
      x: (CANVAS_WIDTH - 300) / 2,
      y: (CANVAS_HEIGHT - 300) / 2,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: { type: 'solid', color: '#eab308' },
    });
  });

  it('mints a distinct id per add-text click', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));

    const id1 = onAddLayer.mock.calls[0][0].id;
    const id2 = onAddLayer.mock.calls[1][0].id;
    expect(id1).not.toBe(id2);
  });

  it('"Enviar imagem" calls useImageInsert().openFileDialog()', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enviar imagem' }));
    expect(imageInsertState.openFileDialog).toHaveBeenCalledTimes(1);
  });

  it('"Arquivos" calls useImageInsert().openArquivosPicker()', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Arquivos' }));
    expect(imageInsertState.openArquivosPicker).toHaveBeenCalledTimes(1);
  });

  it('passes pasteEnabled through to useImageInsert as `enabled` (defaulting to true)', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );
    expect(useImageInsertMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('passes pasteEnabled={false} through to useImageInsert when provided', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
        pasteEnabled={false}
      />,
    );
    expect(useImageInsertMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("builds an image layer via useImageInsert's onInsert callback, calling onAddLayer once per file with cascade offsets", () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );

    const onInsert = useImageInsertMock.mock.calls[0][0].onInsert as (
      files: Array<{ file_id: number; width: number; height: number }>,
    ) => void;

    onInsert([
      { file_id: 5, width: 1000, height: 500 },
      { file_id: 6, width: 200, height: 200 },
    ]);

    expect(onAddLayer).toHaveBeenCalledTimes(2);

    const layer1 = onAddLayer.mock.calls[0][0];
    expect(layer1).toMatchObject({
      name: 'Imagem',
      type: 'image',
      file_id: 5,
      fit: 'cover',
      w: 648,
      h: 324,
      rotation: 0,
      opacity: 1,
      locked: false,
    });
    expect(layer1.x).toBeCloseTo((CANVAS_WIDTH - 648) / 2);
    expect(layer1.y).toBeCloseTo((CANVAS_HEIGHT - 324) / 2);

    const layer2 = onAddLayer.mock.calls[1][0];
    expect(layer2).toMatchObject({
      name: 'Imagem',
      type: 'image',
      file_id: 6,
      fit: 'cover',
      w: 200,
      h: 200,
    });
    // Second file in the batch is cascaded +20px from the centered position.
    expect(layer2.x).toBeCloseTo((CANVAS_WIDTH - 200) / 2 + 20);
    expect(layer2.y).toBeCloseTo((CANVAS_HEIGHT - 200) / 2 + 20);
  });

  it('caps an oversized image at 648px on the longer side, preserving aspect ratio', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );
    const onInsert = useImageInsertMock.mock.calls[0][0].onInsert as (
      files: Array<{ file_id: number; width: number; height: number }>,
    ) => void;

    onInsert([{ file_id: 1, width: 4000, height: 2000 }]);

    const layer = onAddLayer.mock.calls[0][0];
    expect(layer.w).toBe(648);
    expect(layer.h).toBe(324);
  });

  it('floors a degenerate near-zero image at 100px on the shorter side', () => {
    const onAddLayer = vi.fn();
    render(
      <LeftToolDock
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        onAddLayer={onAddLayer}
      />,
    );
    const onInsert = useImageInsertMock.mock.calls[0][0].onInsert as (
      files: Array<{ file_id: number; width: number; height: number }>,
    ) => void;

    onInsert([{ file_id: 1, width: 4000, height: 10 }]);

    const layer = onAddLayer.mock.calls[0][0];
    expect(layer.w).toBe(648);
    expect(layer.h).toBe(100);
  });
});
