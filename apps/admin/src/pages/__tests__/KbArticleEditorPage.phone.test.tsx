import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  getKbArticle: vi.fn(),
  createKbArticle: vi.fn(),
  updateKbArticle: vi.fn(),
  deleteKbArticle: vi.fn(),
  listKbContextLinks: vi.fn(),
  upsertKbContextLink: vi.fn(),
  deleteKbContextLink: vi.fn(),
}));
vi.mock('../../lib/inline-image', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  resolveInlineImageUrls: vi.fn().mockResolvedValue({}),
  injectSignedUrls: (c: unknown) => c,
}));
// TipTap in jsdom is slow and timer-flaky; the page only needs the editor's contract. The stub
// records the initial content of each mount and can play back a typed document through onUpdate.
const editorProbe = vi.hoisted(() => ({ mounts: [] as unknown[] }));
const TYPED = { type: 'doc', content: [{ type: 'paragraph', text: 'digitado' }] };
vi.mock('../../components/editor/ArticleEditor', async () => {
  const { useState } = await import('react');
  return {
    ArticleEditor: ({
      initialContent,
      onUpdate,
    }: {
      initialContent: unknown;
      onUpdate: (json: Record<string, unknown>, plain: string) => void;
    }) => {
      useState(() => {
        editorProbe.mounts.push(initialContent);
        return 0;
      });
      return (
        <div data-testid="article-editor">
          <button type="button" onClick={() => onUpdate(TYPED, 'typed')}>
            Simular digitação
          </button>
        </div>
      );
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  deleteKbArticle,
  deleteKbContextLink,
  getKbArticle,
  listKbContextLinks,
  updateKbArticle,
} from '../../lib/api';
import KbArticleEditorPage from '../KbArticleEditorPage';

const article = {
  id: 'k1',
  title: 'Primeiro post',
  slug: 'primeiro-post',
  excerpt: 'Resumo curto',
  content: null,
  content_plain: '',
  cover_image_url: null,
  category: 'primeiros-passos',
  tags: ['inicio'],
  status: 'draft' as const,
  display_order: 3,
  author_id: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

let restore: (() => void) | null = null;

/** matchMedia whose phone answer can be flipped mid-test (an iPhone rotating past 768pt). */
function controllableMatchMedia() {
  const original = window.matchMedia;
  const listeners: Array<() => void> = [];
  let matches = true;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  restore = () => {
    window.matchMedia = original;
  };
  return (phone: boolean) => {
    matches = phone;
    listeners.slice().forEach((l) => l());
  };
}

beforeEach(() => {
  vi.mocked(getKbArticle).mockResolvedValue({ article } as never);
  vi.mocked(listKbContextLinks).mockResolvedValue({
    links: [
      {
        id: 'l1',
        route_pattern: '/clientes',
        article_id: 'k1',
        label: null,
        display_order: 0,
      },
    ],
  } as never);
  vi.mocked(updateKbArticle).mockReset();
  vi.mocked(updateKbArticle).mockResolvedValue({ article } as never);
  vi.mocked(deleteKbArticle).mockReset();
  vi.mocked(deleteKbArticle).mockResolvedValue({ message: 'ok' } as never);
  vi.mocked(deleteKbContextLink).mockReset();
  vi.mocked(deleteKbContextLink).mockResolvedValue({ message: 'ok' } as never);
});

afterEach(() => {
  restore?.();
  restore = null;
});

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/kb-articles/k1/edit']}>
        <Routes>
          <Route path="/admin/kb-articles/:id/edit" element={<KbArticleEditorPage />} />
          <Route path="/admin/kb-articles" element={<p>Lista de artigos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbArticleEditorPage on phones', () => {
  beforeEach(() => {
    restore = mockPhone();
  });

  it('renders a nav bar with back, Salvar and the three editor sections', async () => {
    renderEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Editar artigo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Voltar para Artigos' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Editor' });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('article-editor')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveValue('Primeiro post');
  });

  it('Salvar sends the edited fields', async () => {
    renderEditor();
    const title = await screen.findByRole('textbox', { name: 'Título' });
    await waitFor(() => expect(title).toHaveValue('Primeiro post'));
    fireEvent.change(title, { target: { value: 'Primeiro post revisto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(updateKbArticle).toHaveBeenCalledTimes(1));
    expect(updateKbArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        article_id: 'k1',
        title: 'Primeiro post revisto',
        slug: 'primeiro-post',
        category: 'primeiros-passos',
        excerpt: 'Resumo curto',
        tags: ['inicio'],
        display_order: 3,
        status: 'draft',
      }),
    );
  });

  it('Detalhes holds the slug and blocks saving a reserved one', async () => {
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Editar artigo' });
    expect(screen.queryByRole('textbox', { name: 'Slug' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Detalhes' }));
    const slug = screen.getByRole('textbox', { name: 'Slug' });
    await waitFor(() => expect(slug).toHaveValue('primeiro-post'));
    // The editor stays mounted while another section is shown, so no edit is lost.
    expect(screen.getByTestId('article-editor')).toBeInTheDocument();
    fireEvent.change(slug, { target: { value: 'novo' } });
    expect(screen.getByText('Slug reservado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('Contexto lists the CRM routes and removes one', async () => {
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Editar artigo' });
    fireEvent.click(screen.getByRole('tab', { name: 'Contexto' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover Clientes' }));
    await waitFor(() => expect(deleteKbContextLink).toHaveBeenCalledWith('l1'));
  });

  it('Excluir asks for confirmation before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    renderEditor();
    await screen.findByRole('heading', { level: 1, name: 'Editar artigo' });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir artigo' }));
    expect(confirmSpy).toHaveBeenCalledWith('Excluir este artigo permanentemente?');
    expect(deleteKbArticle).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir artigo' }));
    await waitFor(() => expect(deleteKbArticle).toHaveBeenCalledWith('k1'));
    expect(await screen.findByText('Lista de artigos')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

describe('KbArticleEditorPage across the 768px breakpoint', () => {
  it('remounts the editor with the typed document and keeps the fields', async () => {
    const flip = controllableMatchMedia();
    editorProbe.mounts.length = 0;
    renderEditor();
    const title = await screen.findByRole('textbox', { name: 'Título' });
    await waitFor(() => expect(title).toHaveValue('Primeiro post'));
    expect(editorProbe.mounts).toEqual([null]);

    fireEvent.click(screen.getByRole('button', { name: 'Simular digitação' }));
    fireEvent.change(title, { target: { value: 'Título editado no iPhone' } });

    await act(async () => flip(false));

    // Desktop now: the wide layout, a fresh editor seeded with what was typed.
    expect(document.querySelector('[data-admin-wide]')).not.toBeNull();
    expect(editorProbe.mounts).toEqual([null, TYPED]);
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveValue('Título editado no iPhone');
  });
});

describe('KbArticleEditorPage on desktop', () => {
  it('shows the back link, the wide two-column layout and publishes in one step', async () => {
    const { container } = renderEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Editar artigo' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Artigos' })).toHaveAttribute(
      'href',
      '/admin/kb-articles',
    );
    expect(container.querySelector('[data-admin-wide]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Detalhes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Contexto' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveValue('primeiro-post'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(updateKbArticle).toHaveBeenCalledWith(
        expect.objectContaining({ article_id: 'k1', status: 'published' }),
      ),
    );
  });
});
