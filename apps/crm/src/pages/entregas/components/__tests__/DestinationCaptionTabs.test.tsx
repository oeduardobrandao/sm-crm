import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DestinationCaptionTabs } from '../DestinationCaptionTabs';
import type { DestinationCaptionFieldHandle } from '../DestinationCaptionField';
import type { WorkflowPost } from '@/store/posts';
import type { PostTargetRow } from '@/store/postTargets';

const post = {
  id: 42,
  tipo: 'reels',
  status: 'rascunho',
  scheduled_at: null,
  instagram_media_id: null,
  publish_error: null,
  tiktok_publish_status: null,
  tiktok_caption: 'do tiktok',
} as unknown as WorkflowPost;

const t = (platform: PostTargetRow['platform'], caption: string | null = null): PostTargetRow => ({
  id: platform.length,
  post_id: 42,
  platform,
  status: 'pendente',
  caption,
});

function renderTabs(over: Partial<Parameters<typeof DestinationCaptionTabs>[0]> = {}) {
  const props = {
    post,
    targets: [t('instagram'), t('tiktok'), t('geral', 'texto geral')],
    loading: false,
    activeTab: null,
    onActiveTabChange: vi.fn(),
    locked: false,
    instagramCaption: <div data-testid="ig-field" />,
    tiktokSettings: <div data-testid="tt-settings" />,
    tiktokFieldRef: createRef<DestinationCaptionFieldHandle>(),
    geralFieldRef: createRef<DestinationCaptionFieldHandle>(),
    onSaveCaption: vi.fn(async () => {}),
    ...over,
  };
  return { ...render(<DestinationCaptionTabs {...props} />), props };
}

describe('DestinationCaptionTabs', () => {
  it('one tab per destination with its status pill; first tab active by default', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual([
      expect.stringContaining('Instagram'),
      expect.stringContaining('TikTok'),
      expect.stringContaining('Geral'),
    ]);
    expect(tabs[0]).toHaveAttribute('data-state', 'active');
    expect(screen.getByLabelText('Instagram: Pendente')).toBeInTheDocument();
  });

  it('every panel stays mounted (forceMount) so no draft is dropped', () => {
    renderTabs();
    expect(screen.getByTestId('ig-field')).toBeInTheDocument();
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveValue('do tiktok');
    expect(screen.getByLabelText('Legenda (Geral)')).toHaveValue('texto geral');
    expect(screen.getByTestId('tt-settings')).toBeInTheDocument();
  });

  it('shows the native-format hint and the per-platform counter', () => {
    renderTabs();
    expect(screen.getByText('Formato: Vídeo vertical → Reels')).toBeInTheDocument();
    expect(screen.getByText('Formato: Vídeo vertical → Vídeo TikTok')).toBeInTheDocument();
    expect(screen.getByText('9 / 2200')).toBeInTheDocument(); // "do tiktok" (reels: 2200)
    expect(screen.getByText('11 caracteres')).toBeInTheDocument(); // Geral sem limite
  });

  it('is controlled: switching tabs reports the platform', () => {
    const { props } = renderTabs();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Geral/ }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith('geral');
  });

  it('honours a controlled activeTab', () => {
    renderTabs({ activeTab: 'geral' });
    expect(screen.getByRole('tab', { name: /Geral/ })).toHaveAttribute('data-state', 'active');
  });

  it('TikTok without its own caption shows what the publisher will post (the IG caption)', () => {
    renderTabs({
      post: { ...post, tiktok_caption: null, ig_caption: 'da IG' } as WorkflowPost,
    });
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveValue('da IG');
    expect(
      screen.getByText('Usando a legenda do Instagram até você editar aqui.'),
    ).toBeInTheDocument();
  });

  it('no fallback hint once TikTok has its own caption', () => {
    renderTabs();
    expect(screen.queryByText('Usando a legenda do Instagram até você editar aqui.')).toBeNull();
  });

  it('locks the TikTok caption while scheduled; Geral stays editable', () => {
    renderTabs({ locked: true });
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Legenda (Geral)')).not.toHaveAttribute('readonly');
  });

  it('Geral offers Copiar legenda', () => {
    renderTabs();
    expect(screen.getByRole('button', { name: /Copiar legenda/ })).toBeInTheDocument();
  });

  it('empty and loading states', () => {
    const { rerender, props } = renderTabs({ targets: [] });
    expect(
      screen.getByText('Este post não tem destinos. Ative um em Destinos.'),
    ).toBeInTheDocument();
    rerender(<DestinationCaptionTabs {...props} targets={[]} loading />);
    expect(screen.getByText('Carregando destinos…')).toBeInTheDocument();
  });
});
