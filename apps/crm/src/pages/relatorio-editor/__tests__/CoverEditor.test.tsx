import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoverEditor } from '../CoverEditor';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const coverBlock = (config?: Record<string, unknown>): ReportBlock =>
  config
    ? { id: 'c', type: 'cover', size: 'full', config }
    : { id: 'c', type: 'cover', size: 'full' };

describe('CoverEditor', () => {
  it('inputs mostram os valores computados por default', () => {
    render(
      <CoverEditor
        block={coverBlock()}
        snapshot={makeSnapshotFixture()}
        onConfigChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Texto de destaque da capa' })).toHaveValue(
      'Relatório mensal · Instagram',
    );
    expect(screen.getByRole('textbox', { name: 'Título da capa' })).toHaveValue('Julho de 2026');
    expect(screen.getByRole('textbox', { name: 'Subtítulo da capa' })).toHaveValue(
      '@dra.exemplo · Dermatologia · São Paulo',
    );
  });

  it('editar o título chama onConfigChange com o novo valor', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock()}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Título da capa' }), {
      target: { value: 'Julho especial' },
    });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: 'Julho especial' });
  });

  it('limpar o título reverte pra herdar (grava undefined)', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock({ title: 'Julho especial' })}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Título da capa' }), {
      target: { value: '' },
    });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: undefined });
  });

  it('stepper de logo: aumentar e diminuir chamam onConfigChange com o próximo tamanho', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock()}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar logo' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { logoSize: 44 });
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir logo' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { logoSize: 28 });
  });

  it('cor de 8 dígitos vinda do ColorPicker é normalizada antes do onConfigChange', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock()}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('Cor da capa'));
    const native = screen.getByTestId('estudio-color-native') as HTMLInputElement;
    fireEvent.change(native, { target: { value: '#0f766e' } });
    expect(onConfigChange).toHaveBeenCalledWith('c', { color: '#0f766e' });
  });

  it('com cor própria definida: botão "usar cor de destaque" aparece e remove o override', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock({ color: '#0f172a' })}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'usar cor de destaque' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { color: undefined });
  });

  it('sem cor própria: botão "usar cor de destaque" não aparece', () => {
    render(
      <CoverEditor
        block={coverBlock()}
        snapshot={makeSnapshotFixture()}
        onConfigChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'usar cor de destaque' })).not.toBeInTheDocument();
  });
});
