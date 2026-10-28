import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAX_SECTIONS, type SectionKind } from '@mesaas/report-blocks/types';
import { AddSectionMenu } from '../AddSectionMenu';

vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));

function renderMenu(overrides: Partial<Parameters<typeof AddSectionMenu>[0]> = {}) {
  const props = {
    existing: [] as SectionKind[],
    tiktokEnabled: true,
    availablePlatforms: 'all' as const,
    onAdd: vi.fn(),
    ...overrides,
  };
  render(<AddSectionMenu {...props} />);
  return props;
}

const item = (name: RegExp) => screen.getByRole('button', { name });

describe('AddSectionMenu', () => {
  it('oferece Instagram, TikTok e Geral, com a descrição da Geral', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Adicionar seção' })).toBeInTheDocument();
    expect(item(/^Instagram/)).toBeEnabled();
    expect(item(/^TikTok/)).toBeEnabled();
    expect(item(/^Geral/)).toHaveTextContent('Texto, imagens e análises da IA');
  });

  it('escolher chama onAdd com o tipo', () => {
    const { onAdd } = renderMenu();
    fireEvent.click(item(/^TikTok/));
    expect(onAdd).toHaveBeenCalledWith('tiktok');
    fireEvent.click(item(/^Geral/));
    expect(onAdd).toHaveBeenCalledWith('general');
  });

  it('sem feature_tiktok o TikTok nem aparece', () => {
    renderMenu({ tiktokEnabled: false });
    expect(screen.queryByRole('button', { name: /^TikTok/ })).not.toBeInTheDocument();
    expect(item(/^Instagram/)).toBeEnabled();
  });

  it('plataforma já presente: desabilitada com "Já existe…"', () => {
    const { onAdd } = renderMenu({ existing: ['general', 'instagram', 'tiktok'] });
    expect(item(/^Instagram/)).toBeDisabled();
    expect(item(/^Instagram/)).toHaveTextContent('Já existe uma seção do Instagram');
    expect(item(/^TikTok/)).toBeDisabled();
    expect(item(/^TikTok/)).toHaveTextContent('Já existe uma seção do TikTok');
    // Geral pode repetir.
    expect(item(/^Geral/)).toBeEnabled();
    fireEvent.click(item(/^TikTok/));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('documento sem dados do TikTok: TikTok desabilitado com a dica de atualizar dados', () => {
    renderMenu({ availablePlatforms: ['instagram'] });
    expect(item(/^TikTok/)).toBeDisabled();
    expect(item(/^TikTok/)).toHaveTextContent(
      'Sem dados do TikTok neste relatório. Atualize os dados depois de conectar a conta.',
    );
    expect(item(/^Instagram/)).toBeEnabled();
  });

  it('documento sem dados do Instagram: Instagram desabilitado com a dica', () => {
    renderMenu({ availablePlatforms: ['tiktok'] });
    expect(item(/^Instagram/)).toBeDisabled();
    expect(item(/^Instagram/)).toHaveTextContent(
      'Sem dados do Instagram neste relatório. Atualize os dados depois de conectar a conta.',
    );
  });

  it('"Já existe…" tem precedência sobre "Sem dados…"', () => {
    renderMenu({ existing: ['tiktok'], availablePlatforms: ['instagram'] });
    expect(item(/^TikTok/)).toHaveTextContent('Já existe uma seção do TikTok');
  });

  it('no limite de seções o gatilho fica desabilitado', () => {
    renderMenu({ existing: Array.from({ length: MAX_SECTIONS }, () => 'general' as const) });
    expect(screen.getByRole('button', { name: 'Adicionar seção' })).toBeDisabled();
  });
});
