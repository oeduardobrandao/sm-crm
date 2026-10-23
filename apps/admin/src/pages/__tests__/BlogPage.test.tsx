import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listBlogPosts: vi.fn(),
  getBlogPost: vi.fn(),
  updateBlogPost: vi.fn(),
  approveBlogPost: vi.fn(),
  requestBlogChanges: vi.fn(),
  rejectBlogPost: vi.fn(),
  unpublishBlogPost: vi.fn(),
  republishBlogPost: vi.fn(),
  retryBlogPublish: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import {
  approveBlogPost,
  getBlogPost,
  listBlogPosts,
  requestBlogChanges,
  updateBlogPost,
} from '../../lib/api';
import BlogPage from '../BlogPage';
import type { BlogPostDetail, BlogPostRow } from '../blog/blog-view';

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

const source = { title: 'Relatório', publisher: 'Meta', url: 'https://example.com/r' };

function row(over: Partial<BlogPostRow> = {}): BlogPostRow {
  return {
    id: ID1,
    slug: 'calendario-editorial',
    status: 'rascunho',
    category: 'guia',
    title: 'Como montar um calendário editorial em 2026 sem sofrer',
    h1: 'Como montar um calendário editorial',
    description: 'Descrição',
    cover_image: null,
    sources: [source],
    feature_slug: null,
    checks: {
      links: { ok: false, broken: ['https://example.com/quebrado'] },
      images: { ok: true, missing_license: [] },
      cover: true,
      copy: { em_dash: false, meta_endorsement: false },
      similar_titles: [],
    },
    revision_note: null,
    revised_after_note: false,
    rejection_reason: null,
    date: null,
    updated: null,
    revision: 3,
    live_revision: null,
    publish_attempt_at: null,
    created_at: ago(2 * HOUR),
    updated_at: ago(2 * HOUR),
    approved_at: null,
    ...over,
  };
}

function detail(over: Partial<BlogPostDetail> = {}): BlogPostDetail {
  return {
    ...row(),
    lede: 'Um resumo do post.',
    body_md: 'Primeiro parágrafo do corpo.',
    images: [],
    topic_reason: 'Muita gente pesquisa isso em outubro.',
    author: 'equipe',
    ...over,
  };
}

function apiError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error(String(body.error)), { status, body });
}

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/blog" element={<BlogPage />} />
          <Route path="/admin/blog/:id" element={<BlogPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listBlogPosts).mockImplementation(async (tab) => ({
    posts:
      tab === 'publicados'
        ? [row({ id: ID2, status: 'publicado', title: 'Post que está no ar' })]
        : tab === 'rejeitados'
          ? []
          : [row()],
    last_draft_at: ago(2 * HOUR),
  }));
  vi.mocked(getBlogPost).mockImplementation(async (id) => ({
    post:
      id === ID2
        ? detail({ id: ID2, status: 'publicado', title: 'Post que está no ar' })
        : detail(),
  }));
  vi.mocked(approveBlogPost).mockResolvedValue({ post: row({ status: 'publicando' }) });
  vi.mocked(requestBlogChanges).mockResolvedValue({ post: row({ status: 'ajuste_solicitado' }) });
});

describe('BlogPage', () => {
  it('lists the Aguardando queue with chips', async () => {
    renderAt('/admin/blog');
    expect(
      await screen.findByText('Como montar um calendário editorial em 2026 sem sofrer'),
    ).toBeInTheDocument();
    expect(listBlogPosts).toHaveBeenCalledWith('aguardando');
    expect(screen.getByText('1 fonte')).toBeInTheDocument();
    expect(screen.getByText('Link fora do ar')).toBeInTheDocument();
  });

  it('confirms before approving, lists failing checks, and sends the loaded revision', async () => {
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar este post?' });
    expect(within(dialog).getByText('Link fora do ar')).toBeInTheDocument();
    expect(approveBlogPost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(approveBlogPost).toHaveBeenCalledWith(ID1, 3));
  });

  it('keeps Pedir ajuste disabled until there is a note, then sends it', async () => {
    renderAt(`/admin/blog/${ID1}`);
    const button = await screen.findByRole('button', { name: 'Pedir ajuste' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nota para a rotina'), {
      target: { value: 'Troque o exemplo do meio.' },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(requestBlogChanges).toHaveBeenCalledWith(ID1, 'Troque o exemplo do meio.', 3),
    );
  });

  it('offers Despublicar on a published post', async () => {
    renderAt(`/admin/blog/${ID2}?tab=publicados`);
    expect(await screen.findByRole('button', { name: 'Despublicar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar e publicar' })).not.toBeInTheDocument();
    expect(listBlogPosts).toHaveBeenCalledWith('publicados');
  });

  it('warns when no draft arrived in 36 hours', async () => {
    vi.mocked(listBlogPosts).mockResolvedValue({ posts: [row()], last_draft_at: ago(40 * HOUR) });
    renderAt('/admin/blog');
    expect(
      await screen.findByText(/Nenhum rascunho novo desde .+\. Confira a rotina e o conector\./),
    ).toBeInTheDocument();
  });

  it('does not warn with a recent draft', async () => {
    renderAt('/admin/blog');
    await screen.findByText('Como montar um calendário editorial em 2026 sem sofrer');
    expect(screen.queryByText(/Nenhum rascunho novo/)).not.toBeInTheDocument();
  });

  it('shows the environment toast when publishing is unavailable', async () => {
    vi.mocked(approveBlogPost).mockRejectedValue(apiError(503, { error: 'publish_unavailable' }));
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar este post?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Publicação indisponível neste ambiente.'),
    );
  });

  it('reloads the post on a revision conflict', async () => {
    vi.mocked(requestBlogChanges).mockRejectedValue(apiError(409, { error: 'conflict' }));
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.change(await screen.findByLabelText('Nota para a rotina'), {
      target: { value: 'Ajuste' },
    });
    const calls = vi.mocked(getBlogPost).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Este post mudou enquanto você revisava. Carregamos a versão atual.',
      ),
    );
    await waitFor(() => expect(vi.mocked(getBlogPost).mock.calls.length).toBeGreaterThan(calls));
  });

  it('edits text with the loaded revision and shows server field errors inline', async () => {
    vi.mocked(updateBlogPost).mockRejectedValueOnce(
      apiError(400, {
        error: 'invalid_fields',
        details: ['title: 30 caracteres; precisa ter de 50 a 60.'],
      }),
    );
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    const title = screen.getByLabelText('Título (SEO)');
    fireEvent.change(title, { target: { value: 'Curto demais' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateBlogPost).toHaveBeenCalledWith(ID1, { title: 'Curto demais' }, 3),
    );
    expect(
      await screen.findByText('title: 30 caracteres; precisa ter de 50 a 60.'),
    ).toBeInTheDocument();
  });

  it('offers Tentar de novo when the text saved but publishing did not start', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ post: detail({ status: 'publicado' }) });
    vi.mocked(updateBlogPost).mockRejectedValueOnce(
      apiError(502, {
        error: 'deploy_hook_failed',
        saved: true,
        post: row({ status: 'publicando' }),
      }),
    );
    renderAt(`/admin/blog/${ID1}?tab=publicados`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Outro resumo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e publicar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Texto salvo, mas a publicação não começou.',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Tentar de novo' }) }),
      ),
    );
  });
});
