import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReportPlatform } from '@mesaas/report-blocks/platform';
import { MAX_SECTIONS, type SectionKind } from '@mesaas/report-blocks/types';
import { AddSectionMenu } from '../AddSectionMenu';

vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));

function renderMenu(overrides: Partial<Parameters<typeof AddSectionMenu>[0]> = {}) {
  const props = {
    existing: [] as SectionKind[],
    enabledPlatforms: ['instagram', 'tiktok'] as ReportPlatform[],
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
    renderMenu({ enabledPlatforms: ['instagram'] });
    expect(screen.queryByRole('button', { name: /^TikTok/ })).not.toBeInTheDocument();
    expect(item(/^Instagram/)).toBeEnabled();
  });

  it('sem enabledPlatforms (fail closed): só Instagram e Geral', () => {
    render(<AddSectionMenu existing={[]} availablePlatforms="all" onAdd={vi.fn()} />);
    expect(item(/^Instagram/)).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^TikTok/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Google Meu Negócio/ })).not.toBeInTheDocument();
    expect(item(/^Geral/)).toBeEnabled();
  });

  it('com feature_google_business: Google Meu Negócio com a descrição, sem TikTok', () => {
    const { onAdd } = renderMenu({ enabledPlatforms: ['instagram', 'google'] });
    const google = item(/^Google Meu Negócio/);
    expect(google).toBeEnabled();
    expect(google).toHaveTextContent('Visualizações, ligações, rotas, buscas e avaliações');
    expect(screen.queryByRole('button', { name: /^TikTok/ })).not.toBeInTheDocument();
    fireEvent.click(google);
    expect(onAdd).toHaveBeenCalledWith('google');
  });

  it('as plataformas seguem a ordem das seções (Instagram, TikTok, Google), depois a Geral', () => {
    renderMenu({ enabledPlatforms: ['google', 'tiktok', 'instagram'] });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /^(Instagram|TikTok|Google Meu Negócio|Geral)/.test(t))
      .map((t) => t.match(/^(Instagram|TikTok|Google Meu Negócio|Geral)/)![1]);
    expect(labels).toEqual(['Instagram', 'TikTok', 'Google Meu Negócio', 'Geral']);
  });

  it('documento sem dados do Google: Google desabilitado com a dica, sem a descrição', () => {
    renderMenu({ enabledPlatforms: ['instagram', 'google'], availablePlatforms: ['instagram'] });
    const google = item(/^Google Meu Negócio/);
    expect(google).toBeDisabled();
    expect(google).toHaveTextContent(
      'Sem dados do Google Meu Negócio neste relatório. Atualize os dados depois de conectar a conta.',
    );
    expect(google).not.toHaveTextContent('Visualizações, ligações');
  });

  it('seção do Google já presente: "Já existe uma seção do Google Meu Negócio"', () => {
    renderMenu({ enabledPlatforms: ['instagram', 'google'], existing: ['google'] });
    expect(item(/^Google Meu Negócio/)).toBeDisabled();
    expect(item(/^Google Meu Negócio/)).toHaveTextContent(
      'Já existe uma seção do Google Meu Negócio',
    );
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
    const trigger = screen.getByRole('button', { name: 'Adicionar seção' });
    expect(trigger).toBeDisabled();
    // O motivo fica visível e ligado ao botão (não só num title).
    expect(screen.getByText('Limite de 12 seções por relatório')).toBeVisible();
    expect(trigger).toHaveAccessibleDescription('Limite de 12 seções por relatório');
    expect(trigger).not.toHaveAttribute('title');
  });

  it('abaixo do limite, sem a dica de limite', () => {
    renderMenu({ existing: ['general'] });
    expect(screen.queryByText(/Limite de/)).not.toBeInTheDocument();
  });
});
