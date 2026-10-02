import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageSettingsPanel } from '../ImageSettingsPanel';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const block = (
  config: Record<string, unknown> = {},
  size: ReportBlock['size'] = 'full',
): ReportBlock => ({
  id: 'i',
  type: 'image',
  size,
  config: { file_id: 1, width: 1500, height: 1000, ...config },
});

function setup(b: ReportBlock, mode: 'report' | 'template' = 'report') {
  const onConfigChange = vi.fn();
  const onSizeChange = vi.fn();
  const onReplace = vi.fn();
  render(
    <ImageSettingsPanel
      block={b}
      mode={mode}
      onConfigChange={onConfigChange}
      onSizeChange={onSizeChange}
      onReplace={mode === 'report' ? onReplace : undefined}
    />,
  );
  return { onConfigChange, onSizeChange, onReplace };
}

describe('ImageSettingsPanel', () => {
  it('trocar para Vertical aplica 4:5', () => {
    const { onConfigChange } = setup(block({ ratio: '16:9' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Vertical' }));
    expect(onConfigChange).toHaveBeenCalledWith('i', { ratio: '4:5' });
  });

  it('Original esconde ajuste e enquadramento', () => {
    setup(block({ ratio: 'original' }));
    expect(screen.queryByRole('radiogroup', { name: 'Quando não couber' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Enquadramento' })).toBeNull();
  });

  it('Mostrar inteira esconde enquadramento; Preencher mostra', () => {
    setup(block({ ratio: '1:1', fit: 'contain' }));
    expect(screen.queryByRole('radiogroup', { name: 'Enquadramento' })).toBeNull();
  });

  it('Preencher mostra o enquadramento', () => {
    setup(block({ ratio: '1:1', fit: 'cover' }));
    expect(screen.getByRole('radiogroup', { name: 'Enquadramento' })).toBeInTheDocument();
  });

  it('enquadramento grava focal', () => {
    const { onConfigChange } = setup(block({ ratio: '1:1', fit: 'cover' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Topo' }));
    expect(onConfigChange).toHaveBeenCalledWith('i', { focal: { x: 0.5, y: 0 } });
  });

  it('vertical em largura total mostra a dica e Usar meia largura', () => {
    const { onSizeChange } = setup(block({ ratio: '9:16' }, 'full'));
    fireEvent.click(screen.getByRole('button', { name: 'Usar meia largura' }));
    expect(onSizeChange).toHaveBeenCalledWith('half');
  });

  it('legenda e descrição gravam o texto (vazio remove a chave)', () => {
    const { onConfigChange } = setup(block({ alt: 'x' }));
    fireEvent.change(screen.getByLabelText('Legenda (opcional)'), { target: { value: 'Oi' } });
    expect(onConfigChange).toHaveBeenCalledWith('i', { caption: 'Oi' });
    fireEvent.change(screen.getByLabelText('Descrição da imagem'), { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith('i', { alt: undefined });
  });

  it('modo template: sem legenda, descrição nem Trocar imagem', () => {
    setup({ id: 'i', type: 'image', size: 'full' }, 'template');
    expect(screen.queryByLabelText('Legenda (opcional)')).toBeNull();
    expect(screen.queryByLabelText('Descrição da imagem')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trocar imagem' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Original' })).toBeInTheDocument();
  });
});
