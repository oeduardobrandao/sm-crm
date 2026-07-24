import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import NotFoundPage from '../NotFoundPage';

test('renders 404 with links home and to login, and a noindex meta', () => {
  render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { level: 1, name: /Página não encontrada/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /página inicial/i })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: /Entrar/i })).toHaveAttribute('href', '/login');
  expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
    'noindex',
  );
});

test('restores a pre-existing robots meta on unmount, removes an own-created one', () => {
  const pre = document.createElement('meta');
  pre.setAttribute('name', 'robots');
  pre.setAttribute('content', 'noindex, nofollow');
  document.head.appendChild(pre);
  const { unmount } = render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
  expect(pre.getAttribute('content')).toBe('noindex');
  unmount();
  expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
    'noindex, nofollow',
  );
  pre.remove();
  const second = render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
  second.unmount();
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
});
