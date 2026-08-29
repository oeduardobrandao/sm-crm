import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrialReelPanel } from '../TrialReelPanel';
import type { PostMedia, WorkflowPost } from '../../../../store';

function makePost(over: Partial<WorkflowPost> = {}): WorkflowPost {
  return {
    workflow_id: 1,
    titulo: 'P',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'reels',
    ordem: 0,
    status: 'rascunho',
    platform: 'instagram',
    ig_trial_strategy: null,
    ...over,
  } as WorkflowPost;
}

const videoMedia = [{ id: 1, post_id: 1, kind: 'video' }] as unknown as PostMedia[];
const imageMedia = [{ id: 1, post_id: 1, kind: 'image' }] as unknown as PostMedia[];

describe('TrialReelPanel', () => {
  it('renderiza o switch em post reels/instagram', () => {
    render(
      <TrialReelPanel
        post={makePost()}
        media={videoMedia}
        disabled={false}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Reel de teste')).toBeTruthy();
  });

  it('não renderiza fora de reels', () => {
    const { container } = render(
      <TrialReelPanel
        post={makePost({ tipo: 'feed' })}
        media={videoMedia}
        disabled={false}
        onFieldChange={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('não renderiza em post só-TikTok', () => {
    const { container } = render(
      <TrialReelPanel
        post={makePost({ platform: 'tiktok' })}
        media={videoMedia}
        disabled={false}
        onFieldChange={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('ligar o switch grava auto por padrão', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel
        post={makePost()}
        media={videoMedia}
        disabled={false}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', 'auto');
  });

  it('desligar o switch grava null', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel
        post={makePost({ ig_trial_strategy: 'auto' })}
        media={videoMedia}
        disabled={false}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', null);
  });

  it('escolha de graduação grava manual', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel
        post={makePost({ ig_trial_strategy: 'auto' })}
        media={videoMedia}
        disabled={false}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.click(screen.getByText('Eu decido manualmente no app do Instagram'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', 'manual');
  });

  it('desabilita tudo enquanto agendado', () => {
    render(
      <TrialReelPanel
        post={makePost({ ig_trial_strategy: 'auto' })}
        media={videoMedia}
        disabled
        onFieldChange={vi.fn()}
      />,
    );
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cancelar agendamento para editar')).toBeTruthy();
  });

  it('mostra o aviso quando a mídia não qualifica', () => {
    render(
      <TrialReelPanel
        post={makePost({ ig_trial_strategy: 'auto' })}
        media={imageMedia}
        disabled={false}
        onFieldChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Reel de teste exige exatamente um vídeo no post.')).toBeTruthy();
  });
});
