import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { DashboardTopVideo } from '../../types';
import { TopVideosRow } from '../dashboard/TopVideosRow';

function video(overrides: Partial<DashboardTopVideo> = {}): DashboardTopVideo {
  return {
    id: 'v1',
    coverUrl: 'https://cdn.example.com/c1.jpg',
    shareUrl: 'https://www.tiktok.com/@x/video/1',
    postedAt: '2026-10-30T12:00:00Z',
    durationSeconds: 42,
    views: 6800,
    likes: 500,
    comments: 30,
    shares: 212,
    engagementRate: 7.4,
    ...overrides,
  };
}

describe('TopVideosRow', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('pt');
  });

  it('renders views, engagement and shares for each video', () => {
    render(<TopVideosRow videos={[video()]} />);
    expect(screen.getByText('6,8 mil')).toBeInTheDocument();
    expect(screen.getByText('7,4%')).toBeInTheDocument();
    expect(screen.getByText('212')).toBeInTheDocument();
    expect(screen.getByText('Compartilhamentos')).toBeInTheDocument();
    expect(screen.queryByText('Salvos')).toBeNull();
  });

  it('shows the duration tag and links to the share url in a new tab', () => {
    const { container } = render(<TopVideosRow videos={[video()]} />);
    expect(screen.getByText('0:42')).toBeInTheDocument();
    const a = container.querySelector('a[href="https://www.tiktok.com/@x/video/1"]');
    expect(a).not.toBeNull();
    expect(a).toHaveAttribute('target', '_blank');
    expect(a?.getAttribute('rel')).toMatch(/noopener/);
  });

  it('a video without cover, share_url or duration renders a placeholder, no tag and no link', () => {
    const { container } = render(
      <TopVideosRow videos={[video({ coverUrl: null, shareUrl: null, durationSeconds: null })]} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
    expect(screen.getByText('6,8 mil')).toBeInTheDocument();
  });

  it('a javascript: share url is not rendered as a link', () => {
    const { container } = render(
      <TopVideosRow videos={[video({ shareUrl: 'javascript:alert(1)' })]} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('a null engagement rate shows a dash', () => {
    render(<TopVideosRow videos={[video({ engagementRate: null })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|NaN/);
  });

  it('shows the empty message with no videos', () => {
    render(<TopVideosRow videos={[]} />);
    expect(screen.getByText('Nenhum vídeo no período selecionado.')).toBeInTheDocument();
  });
});
