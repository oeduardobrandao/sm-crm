import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getClienteLinks: vi.fn(),
  addClienteLink: vi.fn(),
  updateClienteLink: vi.fn(),
  removeClienteLink: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getClienteLinks,
  addClienteLink,
  updateClienteLink,
  removeClienteLink,
  type ClienteLink,
} from '@/store';
import { toast } from 'sonner';
import { ClienteLinksSection } from '../ClienteLinksSection';

const mockedGet = vi.mocked(getClienteLinks);
const mockedAdd = vi.mocked(addClienteLink);
const mockedUpdate = vi.mocked(updateClienteLink);
const mockedRemove = vi.mocked(removeClienteLink);
const mockedToast = vi.mocked(toast);

const CLIENTE_ID = 42;

function link(overrides: Partial<ClienteLink> = {}): ClienteLink {
  return {
    id: 1,
    cliente_id: CLIENTE_ID,
    titulo: 'Google Drive',
    url: 'https://www.drive.google.com/drive/folders/abc',
    descricao: 'Pasta de criativos',
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClienteLinksSection clienteId={CLIENTE_ID} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy };
}

async function openAddDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar link' }));
  return screen.findByRole('dialog', { name: 'Novo link' });
}

function fill(dialog: HTMLElement, titulo: string, url: string, descricao = '') {
  fireEvent.change(within(dialog).getByPlaceholderText('Ex: Google Drive'), {
    target: { value: titulo },
  });
  fireEvent.change(within(dialog).getByPlaceholderText('https://drive.google.com/...'), {
    target: { value: url },
  });
  if (descricao) {
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Pasta de criativos aprovados'), {
      target: { value: descricao },
    });
  }
}

describe('ClienteLinksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue([]);
  });

  it('shows the empty state when there are no links', async () => {
    renderSection();
    expect(await screen.findByText('Nenhum link cadastrado')).toBeInTheDocument();
  });

  it('renders each link as a safe external anchor with title, description and domain', async () => {
    mockedGet.mockResolvedValue([link()]);
    renderSection();

    const anchor = await screen.findByRole('link', { name: /Google Drive/ });
    expect(anchor).toHaveAttribute('href', 'https://www.drive.google.com/drive/folders/abc');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(within(anchor).getByText('Pasta de criativos')).toBeInTheDocument();
    expect(within(anchor).getByText('drive.google.com')).toBeInTheDocument();
  });

  it('associates each form label with its input and flags the invalid title', async () => {
    renderSection();
    const dialog = await openAddDialog();

    expect(within(dialog).getByLabelText('Título *')).toHaveAttribute(
      'placeholder',
      'Ex: Google Drive',
    );
    expect(within(dialog).getByLabelText('URL *')).toHaveAttribute(
      'placeholder',
      'https://drive.google.com/...',
    );
    expect(within(dialog).getByLabelText('Descrição')).toHaveAttribute(
      'placeholder',
      'Ex: Pasta de criativos aprovados',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    const error = await within(dialog).findByText('Informe um título.');
    const titulo = within(dialog).getByLabelText('Título *');
    expect(titulo).toHaveAttribute('aria-invalid', 'true');
    expect(titulo).toHaveAttribute('aria-describedby', error.id);
  });

  it('rejects an empty title without calling the store', async () => {
    renderSection();
    const dialog = await openAddDialog();
    fill(dialog, '', 'https://drive.google.com/x');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    expect(await within(dialog).findByText('Informe um título.')).toBeInTheDocument();
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL without calling the store', async () => {
    renderSection();
    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'javascript:alert(1)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    expect(
      await within(dialog).findByText('Informe uma URL válida (http ou https).'),
    ).toBeInTheDocument();
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('adds a link, prepending https://, invalidates the query, toasts and closes', async () => {
    mockedAdd.mockResolvedValue(link({ id: 2 }));
    const { invalidateSpy } = renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'drive.google.com/drive/folders/abc', 'Pasta de criativos');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith({
      cliente_id: CLIENTE_ID,
      titulo: 'Drive',
      url: 'https://drive.google.com/drive/folders/abc',
      descricao: 'Pasta de criativos',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link adicionado!');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks for confirmation before discarding typed input, and closes a pristine dialog directly', async () => {
    renderSection();

    const pristine = await openAddDialog();
    fireEvent.click(within(pristine).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const dialog = await openAddDialog();
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Google Drive'), {
      target: { value: 'Rascunho' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // The alertdialog aria-hides the dialog behind it, so query with hidden: true.
    expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
  });

  it('saves an empty description as null', async () => {
    mockedAdd.mockResolvedValue(link({ id: 2 }));
    renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Notion', 'https://notion.so/aurora');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith(expect.objectContaining({ descricao: null }));
  });

  it('shows an error toast when the store rejects', async () => {
    mockedAdd.mockRejectedValue(new Error('boom'));
    renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'https://drive.google.com/x');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Erro: boom'));
    expect(screen.getByRole('dialog', { name: 'Novo link' })).toBeInTheDocument();
  });

  it('edits an existing link with the fields prefilled', async () => {
    const existing = link();
    mockedGet.mockResolvedValue([existing]);
    mockedUpdate.mockResolvedValue({ ...existing, titulo: 'Drive do cliente' });
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar link: Google Drive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar link' });
    expect(within(dialog).getByPlaceholderText('Ex: Google Drive')).toHaveValue('Google Drive');

    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Google Drive'), {
      target: { value: 'Drive do cliente' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith(1, {
      titulo: 'Drive do cliente',
      url: 'https://www.drive.google.com/drive/folders/abc',
      descricao: 'Pasta de criativos',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link atualizado!');
  });

  it('removes a link only after confirmation', async () => {
    mockedGet.mockResolvedValue([link()]);
    mockedRemove.mockResolvedValue(undefined);
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover link: Google Drive' }));
    expect(mockedRemove).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link removido!');
  });
});
