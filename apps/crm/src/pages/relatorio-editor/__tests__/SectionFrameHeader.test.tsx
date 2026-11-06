import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReportBlock, ReportSection } from '@mesaas/report-blocks/types';
import { SectionFrameHeader, sectionDisplayName } from '../SectionFrameHeader';

vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));

const kpi: ReportBlock = { id: 'r', type: 'kpi_reach', size: 'third' };

function section(
  kind: ReportSection['kind'],
  config?: Record<string, unknown>,
  blocks: ReportBlock[] = [kpi],
): ReportSection {
  return {
    marker: { id: `m-${kind}`, type: 'section', size: 'full', ...(config ? { config } : {}) },
    kind,
    blocks,
    synthesized: false,
  };
}

function renderHeader(
  s: ReportSection,
  overrides: Partial<Parameters<typeof SectionFrameHeader>[0]> = {},
) {
  const props = {
    section: s,
    index: 1,
    count: 3,
    handle: null,
    onTitleChange: vi.fn(),
    onMove: vi.fn(),
    onToggleHideHeader: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<SectionFrameHeader {...props} />);
  return props;
}

describe('sectionDisplayName', () => {
  it('título salvo; senão o nome da plataforma; Geral por padrão', () => {
    expect(sectionDisplayName(section('instagram'))).toBe('Instagram');
    expect(sectionDisplayName(section('tiktok', { platform: 'tiktok', title: 'Vídeos' }))).toBe(
      'Vídeos',
    );
    expect(sectionDisplayName(section('general'))).toBe('Geral');
    expect(sectionDisplayName(section('general', { title: 'Próximos passos' }))).toBe(
      'Próximos passos',
    );
  });
});

describe('SectionFrameHeader', () => {
  it('plataforma: título editável com o nome da plataforma de placeholder e o @ da conta', () => {
    renderHeader(section('instagram', { platform: 'instagram' }), { handle: 'dra.exemplo' });
    const input = screen.getByRole('textbox', { name: 'Título da seção Instagram' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Instagram');
    expect(screen.getByText('@dra.exemplo')).toBeInTheDocument();
    expect(screen.queryByText('Sem título no relatório')).not.toBeInTheDocument();
  });

  it('digitar envia o texto cru (com espaços) para onTitleChange', () => {
    const props = renderHeader(section('instagram', { platform: 'instagram' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Título da seção Instagram' }), {
      target: { value: 'Meu ' },
    });
    expect(props.onTitleChange).toHaveBeenCalledWith('Meu ');
    expect(screen.getByRole('textbox', { name: 'Título da seção Instagram' })).toHaveValue('Meu ');
  });

  it('Geral: rótulo editável com "Geral" de placeholder e a nota de sem título', () => {
    renderHeader(section('general'));
    expect(screen.getByRole('textbox', { name: 'Título da seção Geral' })).toHaveAttribute(
      'placeholder',
      'Geral',
    );
    expect(screen.getByText('Sem título no relatório')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /título no relatório/ })).not.toBeInTheDocument();
  });

  it('menu: renomear, mover, ocultar título e remover', () => {
    renderHeader(section('instagram', { platform: 'instagram' }));
    for (const name of [
      'Renomear seção',
      'Mover para cima',
      'Mover para baixo',
      'Ocultar título no relatório',
      'Remover seção',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('mover chama onMove com a direção; bordas desabilitadas', () => {
    const props = renderHeader(section('instagram', { platform: 'instagram' }), { index: 0 });
    expect(screen.getByRole('button', { name: 'Mover para cima' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mover para baixo' }));
    expect(props.onMove).toHaveBeenCalledWith(1);
  });

  it('última seção: mover para baixo desabilitado', () => {
    const props = renderHeader(section('instagram', { platform: 'instagram' }), {
      index: 2,
      count: 3,
    });
    expect(screen.getByRole('button', { name: 'Mover para baixo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mover para cima' }));
    expect(props.onMove).toHaveBeenCalledWith(-1);
  });

  it('ocultar/mostrar título alterna hideHeader e mostra a nota quando oculto', () => {
    const props = renderHeader(section('tiktok', { platform: 'tiktok', hideHeader: true }));
    expect(screen.getByText('Sem título no relatório')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar título no relatório' }));
    expect(props.onToggleHideHeader).toHaveBeenCalledTimes(1);
  });

  it('remover seção com blocos pede confirmação', () => {
    const props = renderHeader(section('instagram', { platform: 'instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover seção' }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Remover seção?')).toBeInTheDocument();
    expect(
      screen.getByText('Os widgets desta seção também saem do relatório.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('remover seção vazia não pede confirmação', () => {
    const props = renderHeader(section('general', undefined, []));
    fireEvent.click(screen.getByRole('button', { name: 'Remover seção' }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Remover seção?')).not.toBeInTheDocument();
  });

  it('alça de reordenar a seção', () => {
    renderHeader(section('instagram', { platform: 'instagram' }));
    expect(screen.getByRole('button', { name: 'Reordenar seção' })).toBeInTheDocument();
  });
});
