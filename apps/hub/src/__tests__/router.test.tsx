import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shell/HubShell', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    HubShell: () => (
      <div>
        <div>Hub shell</div>
        <actual.Outlet />
      </div>
    ),
  };
});

vi.mock('../pages/HomePage', () => ({
  HomePage: () => <div>Home page</div>,
}));

vi.mock('../pages/AprovacoesPage', () => ({
  AprovacoesPage: () => <div>Aprovações page</div>,
}));

vi.mock('../pages/MarcaPage', () => ({
  MarcaPage: () => <div>Marca page</div>,
}));

vi.mock('../pages/PaginasPage', () => ({
  PaginasPage: () => <div>Páginas page</div>,
}));

vi.mock('../pages/PaginaPage', () => ({
  PaginaPage: () => <div>Página page</div>,
}));

vi.mock('../pages/BriefingPage', () => ({
  BriefingPage: () => <div>Briefing page</div>,
}));

vi.mock('../pages/PostagensPage', () => ({
  PostagensPage: () => <div>Postagens page</div>,
}));

vi.mock('../pages/IdeiasPage', () => ({
  IdeiasPage: () => <div>Ideias page</div>,
}));

import { router } from '../router';

describe('hub router', () => {
  beforeEach(async () => {
    await router.navigate('/mesaas/hub/token-publico');
  });

  it('renders the index route inside the hub shell', async () => {
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Hub shell')).toBeInTheDocument();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('renders nested hub pages', async () => {
    await router.navigate('/mesaas/hub/token-publico/paginas/42');

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Página page')).toBeInTheDocument();
  });

  it('renders the fallback state for invalid links', async () => {
    await router.navigate('/rota-inexistente');

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Link inválido.')).toBeInTheDocument();
  });
});
