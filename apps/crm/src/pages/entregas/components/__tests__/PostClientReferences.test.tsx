import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { ReferenceItem } from '@/store/postReferences';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/store/postReferences', () => ({ deletePostReference: vi.fn() }));

let mockEntregasPerm: 'editar' | 'ver' = 'editar';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    can: makeCan(
      fakeMembership({
        role: 'agent',
        role_id: 1,
        permissions: { entregas: mockEntregasPerm } as never,
      }),
    ),
  }),
}));

import { PostClientReferences } from '../references/PostClientReferences';
import { deletePostReference } from '@/store/postReferences';

const mockDelete = vi.mocked(deletePostReference);

function ref(overrides: Partial<ReferenceItem> & Pick<ReferenceItem, 'id'>): ReferenceItem {
  return {
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2_516_582,
    duration_seconds: null,
    width: 1080,
    height: 1350,
    url: 'https://r2.example.com/full.jpg',
    thumbnail_url: 'https://r2.example.com/thumb.webp',
    blur_data_url: null,
    download_url: 'https://r2.example.com/full.jpg?download=1',
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: new Date().toISOString(),
    can_remove: false,
    ...overrides,
  };
}

const IMAGE = ref({
  id: 1,
  name: 'foto-praia.jpg',
  note: 'Usar esta no lugar da atual',
  post_approval_id: 501,
});
const VIDEO = ref({
  id: 2,
  file_kind: 'video',
  name: 'bastidores.mp4',
  mime_type: 'video/mp4',
  duration_seconds: 42,
  url: 'https://r2.example.com/v.mp4',
  download_url: 'https://r2.example.com/v.mp4?download=1',
});
const PDF = ref({
  id: 3,
  file_kind: 'document',
  name: 'tabela-precos.pdf',
  mime_type: 'application/pdf',
  thumbnail_url: null,
  url: 'https://r2.example.com/t.pdf',
  download_url: 'https://r2.example.com/t.pdf?download=1',
});
const LINK = ref({
  id: 4,
  kind: 'link',
  file_kind: null,
  name: null,
  mime_type: null,
  size_bytes: null,
  width: null,
  height: null,
  url: null,
  thumbnail_url: null,
  download_url: null,
  link_url: 'https://www.instagram.com/p/abc/',
  link_title: 'Post que gostei',
  link_domain: 'instagram.com',
});
const ALL = [IMAGE, VIDEO, PDF, LINK];

function renderSection(references: ReferenceItem[] = ALL, onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <PostClientReferences postId={10} references={references} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate, onOpen };
}

const tile = (id: number) => screen.getByTestId(`reference-tile-${id}`);

describe('PostClientReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntregasPerm = 'editar';
  });

  it('renders nothing when the post has no references', () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the header with the count and the source', () => {
    renderSection();
    const section = screen.getByRole('region', { name: 'Referências do cliente' });
    expect(within(section).getByText('4')).toBeInTheDocument();
    expect(within(section).getByText('Enviadas pelo Hub')).toBeInTheDocument();
  });

  it('marks only references attached to a correction with "Na correção"', () => {
    renderSection();
    expect(within(tile(1)).getByText('Na correção')).toBeInTheDocument();
    expect(screen.getAllByText('Na correção')).toHaveLength(1);
  });

  it('shows name, note and "Cliente · data · tamanho" under each tile', () => {
    renderSection();
    expect(within(tile(1)).getByText('foto-praia.jpg')).toBeInTheDocument();
    expect(within(tile(1)).getByText('Usar esta no lugar da atual')).toBeInTheDocument();
    expect(within(tile(1)).getByText(/^Cliente · hoje, \d{2}:\d{2} · 2,4 MB$/)).toBeInTheDocument();
    // Links have no size.
    expect(within(tile(4)).getByText(/^Cliente · hoje, \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('draws the video duration, the PDF tile and the link domain', () => {
    renderSection();
    expect(within(tile(2)).getByText('0:42')).toBeInTheDocument();
    expect(within(tile(3)).getByText('PDF')).toBeInTheDocument();
    expect(within(tile(4)).getByText('instagram.com')).toBeInTheDocument();
  });

  it('links the link title to the sanitized URL in a new tab', () => {
    renderSection();
    const a = within(tile(4)).getByRole('link', { name: 'Post que gostei' });
    expect(a).toHaveAttribute('href', 'https://www.instagram.com/p/abc/');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never links an unsafe URL', () => {
    renderSection([{ ...LINK, link_url: 'javascript:alert(1)' }]);
    expect(within(tile(4)).getByRole('link', { name: 'Post que gostei' })).toHaveAttribute(
      'href',
      '#',
    );
  });

  it('offers "Baixar" for files and never for links', () => {
    renderSection();
    expect(within(tile(1)).getByRole('link', { name: 'Baixar' })).toHaveAttribute(
      'href',
      'https://r2.example.com/full.jpg?download=1',
    );
    expect(within(tile(3)).getByRole('link', { name: 'Baixar' })).toBeInTheDocument();
    expect(within(tile(4)).queryByRole('link', { name: 'Baixar' })).toBeNull();
  });

  it('"Abrir" opens images and videos in the viewer, PDFs in a new tab', () => {
    const { onOpen } = renderSection();
    fireEvent.click(within(tile(2)).getByRole('button', { name: 'Abrir bastidores.mp4' }));
    expect(onOpen).toHaveBeenCalledWith(VIDEO);
    const pdf = within(tile(3)).getByRole('link', { name: 'Abrir tabela-precos.pdf' });
    expect(pdf).toHaveAttribute('href', 'https://r2.example.com/t.pdf');
    expect(pdf).toHaveAttribute('target', '_blank');
  });

  it('hides the trash without entregas/editar', () => {
    mockEntregasPerm = 'ver';
    renderSection();
    expect(screen.queryByRole('button', { name: 'Excluir referência' })).toBeNull();
  });

  it('confirms, deletes and refreshes both reference queries', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { invalidate } = renderSection();

    fireEvent.click(within(tile(2)).getByRole('button', { name: 'Excluir referência' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir referência?' });
    expect(within(dialog).getByText(/bastidores\.mp4/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Referência excluída'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-references', 10] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-reference-counts'] });
  });

  it('explains a permission refusal', async () => {
    mockDelete.mockRejectedValue(new Error('forbidden'));
    renderSection();
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para excluir referências.'),
    );
  });

  it('shows a generic error otherwise', async () => {
    mockDelete.mockRejectedValue(new Error('internal'));
    renderSection();
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível excluir a referência. Tente novamente.',
      ),
    );
  });

  it('has no em dash in its copy', async () => {
    const { container } = renderSection();
    expect(container.textContent).not.toMatch(/—/);
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Excluir referência' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).not.toMatch(/—/);
  });
});
