import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addTarefaMock,
  toastErrorMock,
  getMembrosMock,
  getClientesMock,
  getTarefasMock,
  searchPostsForMentionMock,
  uploadInlineImageMock,
} = vi.hoisted(() => ({
  addTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
  // The rich description editor pulls these in via useMentionSearch -- this file's
  // '../../../store' mock fully
  // replaces the module (no importOriginal), so they need an explicit stand-in or
  // useQuery blows up on an undefined queryFn. Named vi.hoisted refs (not inline
  // vi.fn() literals in the mock factory below) so beforeEach can re-arm their
  // resolved value every test -- the repo's global afterEach runs
  // vi.restoreAllMocks(), which strips a bare vi.fn()'s mockResolvedValue back to
  // "returns undefined" between tests.
  getMembrosMock: vi.fn(),
  getClientesMock: vi.fn(),
  getTarefasMock: vi.fn(),
  searchPostsForMentionMock: vi.fn(),
  uploadInlineImageMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: searchPostsForMentionMock,
}));
vi.mock('@/services/inlineImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/inlineImage')>()),
  uploadInlineImage: uploadInlineImageMock,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { TarefaFormDialog } from '../components/TarefaFormDialog';

beforeEach(() => {
  getMembrosMock.mockResolvedValue([]);
  getClientesMock.mockResolvedValue([]);
  getTarefasMock.mockResolvedValue([]);
  searchPostsForMentionMock.mockResolvedValue([]);
  uploadInlineImageMock.mockResolvedValue({
    r2Key: 'contas/1/files/reference.png',
    src: 'https://signed.example/reference.png',
    width: 800,
    height: 600,
  });
});

// The editor's useMentionSearch calls useQuery, which needs a QueryClient ancestor.
function renderDialog(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const CLIENTES = [
  { id: 7, nome: 'Cliente Sete', status: 'ativo' },
  { id: 9, nome: 'Cliente Pausado', status: 'pausado' },
] as never[];

describe('TarefaFormDialog convert mode', () => {
  it('renders the legacy description inside a rich-text editor', async () => {
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ descricao: 'Pedido do cliente' }}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Descrição' });
    expect(editor.tagName).toBe('DIV');
    expect(editor).toHaveTextContent('Pedido do cliente');
  });

  it('offers an explicit image upload control', () => {
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Inserir imagem' })).toBeInTheDocument();
  });

  it('uploads an image and persists only stable R2 metadata', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ titulo: 'Tarefa com referência' }}
        onCreate={onCreate}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    fireEvent.change(input!, { target: { files: [image] } });

    await waitFor(() => expect(uploadInlineImageMock).toHaveBeenCalledWith(image));
    await waitFor(() =>
      expect(
        document.querySelector('img[src="https://signed.example/reference.png"]'),
      ).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const payload = onCreate.mock.calls[0][0];
    expect(payload.descricao).toBeNull();
    const imageNode = payload.descricao_rich.content.find(
      (node: { type?: string }) => node.type === 'inlineImage',
    );
    expect(imageNode).toMatchObject({
      type: 'inlineImage',
      attrs: { r2Key: 'contas/1/files/reference.png', width: 800, height: 600 },
    });
    expect(JSON.stringify(payload.descricao_rich)).not.toContain('https://signed.example');
  });

  it('prevents submission while an image upload is pending', async () => {
    let finishUpload!: (value: {
      r2Key: string;
      src: string;
      width: number;
      height: number;
    }) => void;
    uploadInlineImageMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ titulo: 'Tarefa com upload' }}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const submit = screen.getByRole('button', { name: /criar tarefa/i });

    fireEvent.change(input, {
      target: { files: [new File(['image'], 'reference.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(uploadInlineImageMock).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();

    finishUpload({
      r2Key: 'contas/1/files/reference.png',
      src: 'https://signed.example/reference.png',
      width: 800,
      height: 600,
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it('prefills initialValues, locks cliente, and submits through onCreate instead of addTarefa', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{
          titulo: 'Trocar arte do feed',
          descricao: 'Pedido do cliente',
          cliente_id: 9,
        }}
        lockCliente
        onCreate={onCreate}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Converter em tarefa' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Trocar arte do feed')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Descrição' })).toHaveTextContent(
      'Pedido do cliente',
    );
    // Cliente pausado ainda aparece (esta travado no da solicitacao). Radix Select
    // mirrors each item into a visually-hidden native <option> in addition to the
    // portaled trigger label, so more than one match is expected here.
    expect(screen.getAllByText('Cliente Pausado').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      titulo: 'Trocar arte do feed',
      descricao: 'Pedido do cliente',
      descricao_rich: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Pedido do cliente' }],
          },
        ],
      },
      cliente_id: 9,
    });
    expect(addTarefaMock).not.toHaveBeenCalled();
  });
});

describe('TarefaFormDialog error handling', () => {
  it('shows the generic pt-BR fallback (not the raw PostgREST message) in plain create mode', async () => {
    addTarefaMock.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "tarefas_pkey"'),
    );
    renderDialog(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('O que precisa ser feito?'), {
      target: { value: 'Nova tarefa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao criar tarefa');
  });
});
