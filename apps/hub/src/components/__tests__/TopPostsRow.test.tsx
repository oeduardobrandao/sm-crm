import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopPostsRow } from '../dashboard/TopPostsRow';
import type { DashboardTopPost } from '../../types';

function makePost(overrides: Partial<DashboardTopPost> = {}): DashboardTopPost {
  return {
    id: 'ig-post-1',
    thumbnailUrl: 'https://cdn.ig/thumb.jpg',
    mediaType: 'IMAGE',
    permalink: 'https://instagram.com/p/abc',
    postedAt: '2026-04-10T10:00:00.000Z',
    likes: 120,
    comments: 15,
    reach: 5000,
    impressions: 6000,
    saved: 80,
    shares: 25,
    engagementRate: 4.8,
    ...overrides,
  };
}

describe('TopPostsRow', () => {
  it('renders post cards with metrics', () => {
    render(<TopPostsRow posts={[makePost()]} />);

    expect(screen.getByText('IMAGE')).toBeInTheDocument();
    expect(screen.getByText('4.8%')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('renders links to Instagram', () => {
    render(<TopPostsRow posts={[makePost()]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://instagram.com/p/abc');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders multiple cards', () => {
    const posts = [
      makePost({ id: '1', engagementRate: 5.0 }),
      makePost({ id: '2', engagementRate: 3.2 }),
      makePost({ id: '3', engagementRate: 2.1 }),
    ];
    render(<TopPostsRow posts={posts} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows empty message when no posts', () => {
    render(<TopPostsRow posts={[]} />);

    expect(screen.getByText(/Nenhum post no período/)).toBeInTheDocument();
  });
});
