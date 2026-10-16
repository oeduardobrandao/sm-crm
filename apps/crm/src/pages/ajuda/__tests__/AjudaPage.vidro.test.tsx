import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kb', () => ({ getPublishedArticles: vi.fn() }));
// Desktop markup: the phone branch has its own suite (AjudaPhone.test).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getPublishedArticles } from '@/store/kb';
import { getMyVideoProgress, getPublishedVideoSeries } from '@/store/kbVideos';
import { VidroToolbarHarness } from '@/test/vidroToolbar';
import AjudaPage from '../AjudaPage';
import SecaoPage from '../SecaoPage';

const ARTICLE = {
  id: 'a1',
  title: 'Convide a equipe',
  slug: 'equipe',
  excerpt: null,
  content: null,
  content_plain: 'texto curto',
  cover_image_url: null,
  category: 'equipe',
  tags: [],
  status: 'published',
  display_order: 1,
  author_id: null,
  created_at: '2026-10-02T12:00:00Z',
  updated_at: '2026-10-02T12:00:00Z',
};

beforeEach(() => {
  vi.mocked(getPublishedArticles).mockResolvedValue([ARTICLE] as never);
  vi.mocked(getPublishedVideoSeries).mockResolvedValue([]);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
});

function renderAt(path: string, vidroShell: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <VidroToolbarHarness vidroShell={vidroShell}>
          <Routes>
            <Route path="/ajuda" element={<AjudaPage />} />
            <Route path="/ajuda/secao/:category" element={<SecaoPage />} />
          </Routes>
        </VidroToolbarHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AjudaPage in the Vidro toolbar', () => {
  it('shows the title in the toolbar and no in-page header', async () => {
    renderAt('/ajuda', true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Central de Ajuda');
    expect(await screen.findByPlaceholderText('Buscar vídeos e artigos...')).toBeInTheDocument();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    renderAt('/ajuda', false);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Central de Ajuda');
    expect(h1s[0].closest('.header')).not.toBeNull();
    expect(document.querySelector('.vidro-toolbar')).toBeNull();
  });
});

describe('SecaoPage in the Vidro toolbar', () => {
  it('shows the category label in the toolbar and keeps the back link in the content', async () => {
    renderAt('/ajuda/secao/equipe', true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Equipe');
    const back = screen.getByRole('link', { name: 'Central de Ajuda' });
    expect(back.closest('.vidro-toolbar')).toBeNull();
    expect(await screen.findByText('Convide a equipe')).toBeInTheDocument();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    renderAt('/ajuda/secao/equipe', false);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Equipe');
    expect(h1s[0].closest('.header')).not.toBeNull();
    expect(document.querySelector('.vidro-toolbar')).toBeNull();
  });

  it('registers no title for an unknown section', async () => {
    renderAt('/ajuda/secao/nao-existe', true);

    expect(await screen.findByText('Seção não encontrada.')).toBeInTheDocument();
    expect(document.querySelector('.vidro-toolbar h1')).toBeNull();
  });
});
