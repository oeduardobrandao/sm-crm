import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllByRole, getByRole, waitFor } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import { renderInstagramPostsTable } from '../InstagramPostsTable';
import { getInstagramPosts } from '../../../services/instagram';

const crmStyles = readFileSync('apps/crm/style.css', 'utf8');

vi.mock('../../../services/instagram', () => ({ getInstagramPosts: vi.fn() }));

const posts = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1),
  posted_at: '2026-07-13T12:00:00Z',
  media_type: 'CAROUSEL_ALBUM',
  caption: index === 0 ? '<img src=x onerror=alert(1)>' : `Legenda ${index + 1}`,
  thumbnail_url: '',
  permalink: 'https://instagram.com/p/safe',
  likes: 75,
  comments: 6,
  reach: 321,
  impressions: 941,
}));

describe('renderInstagramPostsTable', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders scoped post cards with escaped captions', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    expect(container.querySelector('.ig-posts-section')).not.toBeNull();
    expect(container.querySelectorAll('.ig-post-card')).toHaveLength(6);
    expect(container.querySelector('img[onerror="alert(1)"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(
      container.querySelector('.ig-post-card__caption > .ig-post-card__caption-text'),
    ).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('keeps the publication link accessibly named with desktop styles applied', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const actionLabelRules = Array.from(
      crmStyles.matchAll(/\.ig-post-card__action-label\s*\{([^}]*)\}/g),
      (match) => match[1],
    );
    expect(actionLabelRules).toHaveLength(2);
    expect(actionLabelRules[0]).not.toContain('display: none');
    expect(actionLabelRules[0]).toContain('clip:');
    expect(actionLabelRules[1]).toContain('position: static');
    expect(getAllByRole(container, 'link')[0]).toHaveAccessibleName('Abrir publicação');
  });

  it('names pagination controls and hides their icon-font glyphs', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 20 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const previous = getByRole(container, 'button', { name: 'Página anterior', hidden: true });
    const next = getByRole(container, 'button', { name: 'Próxima página', hidden: true });
    expect(previous.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
    expect(next.querySelector('i')).toHaveAttribute('aria-hidden', 'true');

    next.click();
    await waitFor(() => expect(getInstagramPosts).toHaveBeenLastCalledWith(42, 2));
    expect(container.querySelector('#ig-page-indicator')).toHaveTextContent('Pg 2 de 2');
  });

  it('uses scoped widths that are neutralized for phone cards', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const identity = container.querySelector<HTMLElement>('.ig-post-card__identity')!;
    const identityContent = container.querySelector<HTMLElement>(
      '.ig-post-card__identity-content',
    );
    const caption = container.querySelector<HTMLElement>('.ig-post-card__caption')!;
    expect(identityContent).not.toBeNull();
    expect(identity.style.width).toBe('');
    expect(caption.style.maxWidth).toBe('');

    expect(crmStyles).toMatch(/\.ig-post-card__identity\s*\{[^}]*width:\s*140px;/s);
    expect(crmStyles).toMatch(/\.ig-post-card__caption\s*\{[^}]*max-width:\s*200px;/s);
    expect(crmStyles).toMatch(
      /\.ig-post-card__identity-content\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(crmStyles).toMatch(
      /\.ig-posts-list \.ig-post-card__identity,\s*\.ig-posts-list \.ig-post-card__caption\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s,
    );
  });

  it('gives the expand control a scoped 44px touch target', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const expand = getByRole(container, 'button', { name: 'Ver mais publicações' });
    expect(expand).toHaveClass('ig-posts-expand');
    expect(expand.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
    expect(crmStyles).toMatch(/\.ig-posts-expand\s*\{[^}]*min-height:\s*44px;/s);
  });

  it('keeps rows after the fifth collapsed until Ver mais is activated', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const sixth = container.querySelectorAll<HTMLElement>('.ig-post-card')[5];
    expect(sixth.style.display).toBe('none');
    container.querySelector<HTMLButtonElement>('#btn-ig-expand')!.click();
    expect(sixth.style.display).toBe('');
  });
});
