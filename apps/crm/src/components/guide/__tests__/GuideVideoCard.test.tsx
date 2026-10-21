import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEvent } from '../../../lib/analytics';
import { toProgressMap } from '../../../pages/ajuda/videos/playlist';
import type { KbVideo } from '../../../store/kbVideos';
import { GuideVideoCard, videoLengthLabel } from '../GuideVideoCard';

vi.mock('../../../lib/analytics', () => ({ captureEvent: vi.fn() }));

const VIDEO: KbVideo = {
  id: 4,
  series_id: 's1',
  title: 'Instagram',
  slug: 'conectar-instagram',
  description: null,
  display_order: 4,
  duration_seconds: 86,
  hls_url: 'https://h/4.m3u8',
  thumbnail_url: 'https://h/4.jpg',
  article: null,
};

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
    t: string,
  ) => CanPlayTypeResult;
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  vi.mocked(captureEvent).mockClear();
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderCard(over: Partial<Parameters<typeof GuideVideoCard>[0]> = {}) {
  const props = {
    video: VIDEO,
    progress: toProgressMap([]),
    onSave: vi.fn(),
    pageId: 't1p3',
    variant: 'inline' as const,
    onOpenInHelpCenter: vi.fn(),
    ...over,
  };
  return { props, ...render(<GuideVideoCard {...props} />) };
}

describe('videoLengthLabel', () => {
  it('arredonda para minutos com piso de 1', () => {
    expect(videoLengthLabel(46)).toBe('1 minuto');
    expect(videoLengthLabel(86)).toBe('1 minuto');
    expect(videoLengthLabel(120)).toBe('2 minutos');
    expect(videoLengthLabel(null)).toBe('');
    expect(videoLengthLabel(0)).toBe('');
  });
});

describe('GuideVideoCard', () => {
  it('inline: título, duração e chamada', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
    expect(screen.getByText('Prefere ver? Vídeo de 1 minuto')).toBeInTheDocument();
    expect(screen.getByText('1:26')).toBeInTheDocument();
  });

  it('featured: Comece por aqui', () => {
    renderCard({ variant: 'featured', pageId: 'home' });
    expect(screen.getByText('Comece por aqui · vídeo de 1 minuto')).toBeInTheDocument();
  });

  it('sem duração: eyebrow sem tempo e sem selo', () => {
    renderCard({ video: { ...VIDEO, duration_seconds: null } });
    expect(screen.getByText('Prefere ver? Assista ao vídeo')).toBeInTheDocument();
    expect(screen.queryByText('1:26')).not.toBeInTheDocument();
  });

  it('assistido: mostra Assistido e Ver de novo', () => {
    renderCard({
      progress: toProgressMap([
        { video_id: 4, position_seconds: 86, completed_at: '2026-10-01T00:00:00Z' },
      ]),
    });
    expect(screen.getByText('Assistido')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ver de novo o vídeo Instagram' }),
    ).toBeInTheDocument();
  });

  it('clique abre o player, registra o evento e Fechar vídeo volta ao card', () => {
    const { container } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    expect(container.querySelector('video')).not.toBeNull();
    expect(captureEvent).toHaveBeenCalledWith('guide_video_played', {
      page: 't1p3',
      slug: 'conectar-instagram',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar vídeo' }));
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
  });

  it('primeiro play chama onFirstPlay uma vez só', () => {
    const onFirstPlay = vi.fn();
    const { container } = renderCard({ onFirstPlay });
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    const video = container.querySelector('video')!;
    fireEvent.play(video);
    fireEvent.pause(video);
    fireEvent.play(video);
    expect(onFirstPlay).toHaveBeenCalledTimes(1);
    expect(onFirstPlay).toHaveBeenCalledWith(4);
  });

  it('Ver na Central de Ajuda repassa o slug', () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver na Central de Ajuda' }));
    expect(props.onOpenInHelpCenter).toHaveBeenCalledWith('conectar-instagram');
  });

  it('foco: não rouba o foco na montagem', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).not.toHaveFocus();
  });

  it('foco: ao abrir vai para Fechar vídeo', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    expect(screen.getByRole('button', { name: 'Fechar vídeo' })).toHaveFocus();
  });

  it('foco: ao fechar volta para o botão do card', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar vídeo' }));
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toHaveFocus();
  });
});
