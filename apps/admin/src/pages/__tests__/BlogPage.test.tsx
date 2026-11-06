import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Line: () => <div data-testid="line-chart" />,
}));
vi.mock('../../lib/api', () => ({
  getBlogMetrics: vi.fn(),
  getBlogPostMetrics: vi.fn(),
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
  getBlogMetrics,
  getBlogPost,
  getBlogPostMetrics,
  listBlogPosts,
  requestBlogChanges,
  retryBlogPublish,
  updateBlogPost,
} from '../../lib/api';
import { mockPhone } from '../../__tests__/phone';
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
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/blog" element={<BlogPage />} />
          <Route path="/admin/blog/arquivo/:slug" element={<BlogPage />} />
          <Route path="/admin/blog/:id" element={<BlogPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, qc };
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
    file_posts: [],
  }));
  vi.mocked(getBlogPost).mockImplementation(async (id) => ({
    post:
      id === ID2
        ? detail({ id: ID2, status: 'publicado', title: 'Post que está no ar' })
        : detail(),
  }));
  vi.mocked(getBlogMetrics).mockResolvedValue({ gsc_updated_at: null, posts: {} });
  vi.mocked(getBlogPostMetrics).mockResolvedValue({ views: [], search: [] });
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
    vi.mocked(listBlogPosts).mockResolvedValue({
      posts: [row()],
      last_draft_at: ago(40 * HOUR),
      file_posts: [],
    });
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
  it('offers Tentar de novo next to Publicar de novo on a despublicado post', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ post: detail({ status: 'despublicado' }) });
    vi.mocked(retryBlogPublish).mockResolvedValue({ post: row({ status: 'despublicado' }) });
    renderAt(`/admin/blog/${ID1}?tab=publicados`);
    expect(await screen.findByRole('button', { name: 'Publicar de novo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(retryBlogPublish).toHaveBeenCalledWith(ID1));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Despublicação disparada de novo.'),
    );
  });

  it('shows the server-side validation errors of an approve in a toast', async () => {
    vi.mocked(approveBlogPost).mockRejectedValue(
      apiError(400, {
        error: 'invalid_fields',
        details: ['title: 5 caracteres; precisa ter de 50 a 60.'],
      }),
    );
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar este post?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'O post tem campos inválidos. Corrija em Editar texto.',
        { description: 'title: 5 caracteres; precisa ter de 50 a 60.' },
      ),
    );
  });

  it('closes the confirm dialog when the approve hits a revision conflict', async () => {
    vi.mocked(approveBlogPost).mockRejectedValue(apiError(409, { error: 'conflict' }));
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar este post?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Publicar este post?' })).not.toBeInTheDocument(),
    );
    expect(approveBlogPost).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm buttons while the action is in flight', async () => {
    vi.mocked(approveBlogPost).mockReturnValue(new Promise(() => {}));
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar este post?' });
    const publish = within(dialog).getByRole('button', { name: 'Publicar' });
    fireEvent.click(publish);
    await waitFor(() => expect(publish).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.click(publish);
    expect(approveBlogPost).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft in the editor on a save conflict and reloads only on request', async () => {
    vi.mocked(updateBlogPost).mockRejectedValueOnce(apiError(409, { error: 'conflict' }));
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Meu texto novo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText(
        'Este post mudou enquanto você editava. Copie seu texto e recarregue.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Lede')).toHaveValue('Meu texto novo.');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    vi.mocked(getBlogPost).mockResolvedValue({
      post: detail({ revision: 4, lede: 'Versão da rotina.' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    await waitFor(() => expect(screen.getByLabelText('Lede')).toHaveValue('Versão da rotina.'));
    expect(
      screen.queryByText('Este post mudou enquanto você editava. Copie seu texto e recarregue.'),
    ).not.toBeInTheDocument();
  });

  it('asks before leaving an edited draft for another post', async () => {
    vi.mocked(listBlogPosts).mockResolvedValue({
      posts: [row(), row({ id: ID2, title: 'Outro rascunho da fila' })],
      last_draft_at: ago(2 * HOUR),
    });
    renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Mudei.' } });
    fireEvent.click(screen.getByRole('link', { name: 'Outro rascunho da fila' }));
    const ask = await screen.findByRole('dialog', { name: 'Descartar alterações?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(screen.getByLabelText('Lede')).toHaveValue('Mudei.');

    fireEvent.click(screen.getByRole('link', { name: 'Outro rascunho da fila' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Descartar alterações?' })).getByRole(
        'button',
        { name: 'Descartar' },
      ),
    );
    await waitFor(() => expect(getBlogPost).toHaveBeenCalledWith(ID2));
    expect(screen.queryByLabelText('Lede')).not.toBeInTheDocument();
  });

  it('refetches the open post when the list shows it changed', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      post: detail({ status: 'publicando', publish_attempt_at: ago(60_000) }),
    });
    vi.mocked(listBlogPosts).mockResolvedValue({
      posts: [row({ status: 'publicado' })],
      last_draft_at: ago(2 * HOUR),
    });
    renderAt(`/admin/blog/${ID1}?tab=publicados`);
    await screen.findByRole('button', { name: 'Editar texto' });
    await waitFor(() => expect(vi.mocked(getBlogPost).mock.calls.length).toBeGreaterThan(1));
  });

  it('opens preview links in a new tab, resolved on the public site', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(getBlogPost).mockResolvedValue({
      post: detail({ body_md: 'Veja [o recurso](/aprovacao-de-post).' }),
    });
    renderAt(`/admin/blog/${ID1}`);
    const link = await screen.findByRole('link', { name: 'o recurso' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://www.mesaas.com.br/aprovacao-de-post',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });
  it('saves against the revision the editor opened with, even after a refetch', async () => {
    const { qc } = renderAt(`/admin/blog/${ID1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Meu texto.' } });
    // The Routine rewrites the post while the admin edits; something refetches the detail.
    vi.mocked(getBlogPost).mockResolvedValue({ post: detail({ revision: 4, lede: 'Da rotina.' }) });
    await qc.invalidateQueries();
    await waitFor(() => expect(vi.mocked(getBlogPost).mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByLabelText('Lede')).toHaveValue('Meu texto.');
    vi.mocked(updateBlogPost).mockRejectedValueOnce(apiError(409, { error: 'conflict' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateBlogPost).toHaveBeenCalledWith(ID1, { lede: 'Meu texto.' }, 3),
    );
    expect(
      await screen.findByText(
        'Este post mudou enquanto você editava. Copie seu texto e recarregue.',
      ),
    ).toBeInTheDocument();
  });

  it('asks for changes on the revision the note was written against and keeps it on 409', async () => {
    const { qc } = renderAt(`/admin/blog/${ID1}`);
    fireEvent.change(await screen.findByLabelText('Nota para a rotina'), {
      target: { value: 'Troque o título.' },
    });
    vi.mocked(getBlogPost).mockResolvedValue({ post: detail({ revision: 4 }) });
    await qc.invalidateQueries();
    await waitFor(() => expect(screen.getByText(/revisão 4/)).toBeInTheDocument());
    vi.mocked(requestBlogChanges).mockRejectedValueOnce(apiError(409, { error: 'conflict' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }));
    await waitFor(() =>
      expect(requestBlogChanges).toHaveBeenCalledWith(ID1, 'Troque o título.', 3),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Este post mudou enquanto você revisava. Carregamos a versão atual.',
      ),
    );
    expect(screen.getByLabelText('Nota para a rotina')).toHaveValue('Troque o título.');
  });

  it('asks before the phone back button drops an edited draft', async () => {
    const restore = mockPhone();
    try {
      renderAt(`/admin/blog/${ID1}`);
      fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
      fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Mudei.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Voltar para Blog' }));
      const ask = await screen.findByRole('dialog', { name: 'Descartar alterações?' });
      fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
      expect(screen.getByLabelText('Lede')).toHaveValue('Mudei.');
    } finally {
      restore();
    }
  });

  it('tells the admin to wait when a retry fires during another action', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ post: detail({ status: 'publicado' }) });
    vi.mocked(updateBlogPost).mockRejectedValueOnce(
      apiError(502, { error: 'deploy_hook_failed', saved: true }),
    );
    vi.mocked(retryBlogPublish).mockReturnValue(new Promise(() => {}));
    renderAt(`/admin/blog/${ID1}?tab=publicados`);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Lede'), { target: { value: 'Outro.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e publicar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Texto salvo, mas a publicação não começou.',
        expect.anything(),
      ),
    );
    const call = vi
      .mocked(toast.error)
      .mock.calls.find((c) => c[0] === 'Texto salvo, mas a publicação não começou.')!;
    const action = (call[1] as { action: { onClick: () => void } }).action;
    action.onClick();
    action.onClick();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Aguarde a ação em andamento terminar.'),
    );
    expect(retryBlogPublish).toHaveBeenCalledTimes(1);
  });

  describe('hand-written posts', () => {
    const file = {
      kind: 'arquivo' as const,
      slug: 'post-a-mao',
      title: 'Post escrito à mão',
      description: 'Descrição do post de arquivo.',
      category: 'guia',
      date: '2026-10-25',
    };
    beforeEach(() => {
      vi.mocked(listBlogPosts).mockImplementation(async (tab) => ({
        posts:
          tab === 'publicados'
            ? [
                row({
                  id: ID2,
                  status: 'publicado',
                  title: 'Post que está no ar',
                  date: '2026-10-20',
                }),
              ]
            : [],
        last_draft_at: ago(2 * HOUR),
        file_posts: tab === 'publicados' ? [file] : [],
      }));
    });

    it('describes Publicados as rotina plus hand-written posts, and Aguardando as rotina only', async () => {
      const pub = renderAt('/admin/blog?tab=publicados');
      expect(
        await screen.findByText(
          'Posts da rotina e os escritos à mão. Nada da rotina vai ao ar sem sua aprovação.',
        ),
      ).toBeInTheDocument();
      pub.unmount();
      renderAt('/admin/blog');
      expect(
        await screen.findByText('Posts escritos pela rotina. Nada vai ao ar sem sua aprovação.'),
      ).toBeInTheDocument();
    });

    it('lists file posts on Publicados beside the DB posts', async () => {
      renderAt('/admin/blog?tab=publicados');
      expect(await screen.findByRole('link', { name: 'Post escrito à mão' })).toHaveAttribute(
        'href',
        '/admin/blog/arquivo/post-a-mao?tab=publicados',
      );
      expect(screen.getByText('Post que está no ar')).toBeInTheDocument();
    });

    it('opens the read-only detail for a file post without fetching a DB post', async () => {
      renderAt('/admin/blog/arquivo/post-a-mao?tab=publicados');
      expect(await screen.findByText('Descrição do post de arquivo.')).toBeInTheDocument();
      expect(screen.getByText(/Este post vive no código/)).toBeInTheDocument();
      expect(listBlogPosts).toHaveBeenCalledWith('publicados');
      expect(getBlogPost).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Despublicar' })).not.toBeInTheDocument();
    });

    it('forces the Publicados tab even without ?tab', async () => {
      renderAt('/admin/blog/arquivo/post-a-mao');
      expect(await screen.findByText('Descrição do post de arquivo.')).toBeInTheDocument();
      expect(listBlogPosts).toHaveBeenCalledWith('publicados');
      expect(listBlogPosts).not.toHaveBeenCalledWith('aguardando');
    });

    it('shows the load error when the slug is not in the list', async () => {
      renderAt('/admin/blog/arquivo/nao-existe?tab=publicados');
      expect(await screen.findByText('Não foi possível carregar o post.')).toBeInTheDocument();
    });

    it('works on the phone layout', async () => {
      const restore = mockPhone();
      try {
        renderAt('/admin/blog/arquivo/post-a-mao?tab=publicados');
        expect(await screen.findByText('Descrição do post de arquivo.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Voltar para Blog' })).toBeInTheDocument();
      } finally {
        restore();
      }
    });
  });
});

describe('BlogPage metrics', () => {
  const pm = (views_30d: number, clicks: number | null = null) => ({
    views_7d: 1,
    views_30d,
    views_total: views_30d,
    search:
      clicks === null ? null : { clicks, impressions: 100, ctr: 0.1, position: 12.4 as number },
    index: null,
  });
  const file = {
    kind: 'arquivo' as const,
    slug: 'post-a-mao',
    title: 'Post escrito à mão',
    description: 'Descrição do post de arquivo.',
    category: 'guia',
    date: '2026-10-25',
  };

  beforeEach(() => {
    vi.mocked(listBlogPosts).mockImplementation(async (tab) => ({
      posts:
        tab === 'publicados'
          ? [
              row({
                id: ID2,
                slug: 'no-ar',
                status: 'publicado',
                title: 'Post que está no ar',
                date: '2026-10-20',
              }),
            ]
          : [row()],
      last_draft_at: ago(2 * HOUR),
      file_posts: tab === 'publicados' ? [file] : [],
    }));
    vi.mocked(getBlogMetrics).mockResolvedValue({
      gsc_updated_at: null,
      posts: { 'no-ar': pm(1240), 'post-a-mao': pm(100) },
    });
  });

  const order = () =>
    screen
      .getAllByRole('link', { name: /Post (que está no ar|escrito à mão)$/ })
      .map((a) => a.textContent);

  it('shows the views line under live rows only, and no Mais cliques without Search Console', async () => {
    renderAt('/admin/blog?tab=publicados');
    expect(await screen.findByText('1.240 views (30d)')).toBeInTheDocument();
    expect(screen.getByText('100 views (30d)')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Mais vistos' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Mais cliques' })).not.toBeInTheDocument();
  });

  it('scopes the sort control with blog-sort so admin-kit.css can split it evenly', async () => {
    renderAt('/admin/blog?tab=publicados');
    await screen.findByText('1.240 views (30d)');
    const group = screen.getByRole('radiogroup', { name: 'Ordem' });
    expect(group).toHaveClass('blog-sort');
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });

  it('sorts by views from ?ordem= and keeps it in the row links', async () => {
    renderAt('/admin/blog?tab=publicados&ordem=vistos');
    await screen.findByText('1.240 views (30d)');
    expect(order()).toEqual(['Post que está no ar', 'Post escrito à mão']);
    expect(screen.getByRole('link', { name: 'Post que está no ar' })).toHaveAttribute(
      'href',
      `/admin/blog/${ID2}?tab=publicados&ordem=vistos`,
    );
  });

  it('changes the order from the segmented control', async () => {
    renderAt('/admin/blog?tab=publicados');
    await screen.findByText('1.240 views (30d)');
    expect(order()).toEqual(['Post escrito à mão', 'Post que está no ar']); // by date
    fireEvent.click(screen.getByRole('radio', { name: 'Mais vistos' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Mais vistos' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(order()).toEqual(['Post que está no ar', 'Post escrito à mão']);
  });

  it('offers Mais cliques and shows clicks once Search Console has synced', async () => {
    vi.mocked(getBlogMetrics).mockResolvedValue({
      gsc_updated_at: '2026-10-26T06:00:00Z',
      posts: { 'no-ar': pm(10, 90), 'post-a-mao': pm(5000, 3) },
    });
    renderAt('/admin/blog?tab=publicados&ordem=cliques');
    expect(
      await screen.findByText('10 views (30d) · 90 cliques · posição 12,4'),
    ).toBeInTheDocument();
    expect(order()).toEqual(['Post que está no ar', 'Post escrito à mão']);
    expect(screen.getByRole('radio', { name: 'Mais cliques' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('falls back to recentes for ?ordem=cliques while Search Console is not configured', async () => {
    renderAt('/admin/blog?tab=publicados&ordem=cliques');
    await screen.findByText('1.240 views (30d)');
    expect(screen.getByRole('radio', { name: 'Mais recentes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('has no sort control or metric line on Aguardando', async () => {
    renderAt('/admin/blog');
    await screen.findByText('Como montar um calendário editorial em 2026 sem sofrer');
    expect(screen.queryByRole('radio', { name: 'Mais vistos' })).not.toBeInTheDocument();
    expect(screen.queryByText(/views \(30d\)/)).not.toBeInTheDocument();
  });

  it('shows Desempenho in the detail of a live DB post, not of a draft', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      post: detail({ id: ID2, slug: 'no-ar', status: 'publicado', title: 'Post que está no ar' }),
    });
    const live = renderAt(`/admin/blog/${ID2}?tab=publicados`);
    expect(await screen.findByRole('heading', { name: 'Desempenho' })).toBeInTheDocument();
    expect(getBlogPostMetrics).toHaveBeenCalledWith('no-ar', 90);
    live.unmount();

    vi.mocked(getBlogPost).mockResolvedValue({ post: detail() });
    renderAt(`/admin/blog/${ID1}`);
    await screen.findByLabelText('Nota para a rotina');
    expect(screen.queryByRole('heading', { name: 'Desempenho' })).not.toBeInTheDocument();
  });

  it('shows Desempenho in the detail of a hand-written post', async () => {
    renderAt('/admin/blog/arquivo/post-a-mao?tab=publicados');
    expect(await screen.findByRole('heading', { name: 'Desempenho' })).toBeInTheDocument();
    expect(screen.getAllByText('100')).toHaveLength(2);
  });

  describe('when blog-metrics fails', () => {
    const METRICS_ERROR = 'Não foi possível carregar as métricas.';
    beforeEach(() => {
      vi.mocked(getBlogMetrics).mockRejectedValue(
        apiError(500, { error: 'Internal server error' }),
      );
    });

    it('says so above the list, keeps date order for Mais vistos, and retries', async () => {
      renderAt('/admin/blog?tab=publicados&ordem=vistos');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(METRICS_ERROR);
      // Without metrics every post would score zero: the list stays by date, not "sorted".
      expect(order()).toEqual(['Post escrito à mão', 'Post que está no ar']);
      expect(screen.getByRole('radio', { name: 'Mais recentes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.queryByText(/views \(30d\)/)).not.toBeInTheDocument();

      vi.mocked(getBlogMetrics).mockResolvedValue({
        gsc_updated_at: null,
        posts: { 'no-ar': pm(1240), 'post-a-mao': pm(100) },
      });
      const calls = vi.mocked(getBlogMetrics).mock.calls.length;
      fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByText('1.240 views (30d)')).toBeInTheDocument();
      expect(vi.mocked(getBlogMetrics).mock.calls.length).toBe(calls + 1);
      expect(screen.queryByText(METRICS_ERROR)).not.toBeInTheDocument();
    });

    it('shows the error where Desempenho would be in a live post and a hand-written one', async () => {
      vi.mocked(getBlogPost).mockResolvedValue({
        post: detail({ id: ID2, slug: 'no-ar', status: 'publicado', title: 'Post que está no ar' }),
      });
      const live = renderAt(`/admin/blog/${ID2}?tab=publicados`);
      await screen.findByRole('heading', { name: 'Post que está no ar', level: 2 });
      await waitFor(() => expect(screen.getAllByText(METRICS_ERROR)).toHaveLength(2));
      expect(screen.queryByRole('heading', { name: 'Desempenho' })).not.toBeInTheDocument();
      live.unmount();

      renderAt('/admin/blog/arquivo/post-a-mao?tab=publicados');
      await waitFor(() => expect(screen.getAllByText(METRICS_ERROR)).toHaveLength(2));
      expect(screen.queryByRole('heading', { name: 'Desempenho' })).not.toBeInTheDocument();
    });

    it('shows nothing about metrics on a draft', async () => {
      renderAt(`/admin/blog/${ID1}`);
      await screen.findByLabelText('Nota para a rotina');
      await waitFor(() => expect(getBlogMetrics).toHaveBeenCalled());
      expect(screen.queryByText(METRICS_ERROR)).not.toBeInTheDocument();
    });
  });
});
