import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstagramPostCarousel } from '../InstagramPostCarousel';

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
});
