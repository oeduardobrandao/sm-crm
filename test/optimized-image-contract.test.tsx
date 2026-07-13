import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OptimizedImage as CrmImage } from '../apps/crm/src/components/OptimizedImage';
import { OptimizedImage as HubImage } from '../apps/hub/src/components/OptimizedImage';

const components = [
  ['CRM', CrmImage],
  ['Hub', HubImage],
] as const;
const signed = 'https://media.example/contas/a/photo.jpg?exp=9999999999&sig=abc';

afterEach(() => {
  cleanup();
  document.head
    .querySelectorAll('link[rel="preload"][as="image"]')
    .forEach((node) => node.remove());
});

describe.each(components)('%s OptimizedImage', (_name, ImageComponent) => {
  it('requests only the original URL', () => {
    const { container } = render(
      <ImageComponent src={signed} alt="Foto" width={800} height={600} />,
    );
    const img = container.querySelector('img')!;

    expect(container.querySelector('picture')).toBeNull();
    expect(img).not.toHaveAttribute('srcset');
    expect(img.getAttribute('src')).toBe(signed);
    expect(container.innerHTML).not.toContain('&amp;w=');
    expect(container.innerHTML).not.toContain('&amp;f=');
  });

  it('lazy-loads normal images', () => {
    const { getByRole } = render(<ImageComponent src={signed} alt="Foto" />);
    expect(getByRole('img')).toHaveAttribute('loading', 'lazy');
    expect(getByRole('img')).toHaveAttribute('decoding', 'async');
  });

  it('preloads only priority images and cleans the link on unmount', () => {
    const { unmount } = render(<ImageComponent src={signed} alt="Foto" priority />);
    const link = document.head.querySelector('link[rel="preload"][as="image"]');

    expect(link).toHaveAttribute('href', signed);
    expect(link).not.toHaveAttribute('imagesrcset');
    unmount();
    expect(document.head.querySelector('link[rel="preload"][as="image"]')).toBeNull();
  });
});
