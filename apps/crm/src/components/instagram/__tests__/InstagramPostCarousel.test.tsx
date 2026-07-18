import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstagramPostCarousel } from '../InstagramPostCarousel';

const css = readFileSync('apps/crm/style.css', 'utf8');

describe('InstagramPostCarousel', () => {
  it('keeps the caller-supplied arbitrary ordering and neutral section copy', () => {
    const posts = [{ id: 'zebra' }, { id: 'apple' }, { id: 'mango' }];

    render(
      <InstagramPostCarousel
        title="Últimas Publicações"
        description="Publicações mais recentes"
        ariaLabel="Últimas Publicações"
        posts={posts}
        getKey={(post) => post.id}
        renderPost={(post) => <article>{post.id}</article>}
      />,
    );

    const region = screen.getByRole('region', { name: 'Últimas Publicações' });
    expect(within(region).getAllByRole('article').map((item) => item.textContent)).toEqual([
      'zebra',
      'apple',
      'mango',
    ]);
  });

  it('renders the optional action without assigning ranking semantics', () => {
    render(
      <InstagramPostCarousel
        title="Melhores Posts"
        ariaLabel="Melhores Posts"
        posts={[{ id: 1 }]}
        getKey={(post) => post.id}
        renderPost={() => <article>post</article>}
        action={<button>Ver mais</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Ver mais' })).toBeTruthy();
    expect(screen.queryByText(/rank/i)).toBeNull();
  });

  it('sizes phone carousel items relative to their track without viewport units', () => {
    const phoneCarouselMedia = css.match(
      /@media \(max-width:\s*767px\)\s*\{\s*\.instagram-post-carousel__header[\s\S]*?\n\}\n\n\.tag-pill/,
    )?.[0];
    const phoneItemRule = phoneCarouselMedia?.match(
      /\.instagram-post-carousel__item\s*\{([^}]*)\}/,
    )?.[1];

    expect(phoneCarouselMedia).toBeDefined();
    expect(phoneItemRule).toBeDefined();
    expect(phoneItemRule).toMatch(/flex:\s*0\s+0\s+84%/);
    expect(phoneItemRule).toMatch(/min-width:\s*min\(260px,\s*84%\)/);
    expect(phoneItemRule).toMatch(/max-width:\s*340px/);
    expect(phoneItemRule).not.toMatch(/\d(?:\.\d+)?v(?:w|h|min|max)\b/i);
  });
});
