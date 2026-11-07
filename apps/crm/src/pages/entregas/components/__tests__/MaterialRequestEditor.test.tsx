import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { CrmMaterialRequest } from '@/store/postReferences';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('@/store/postReferences', () => ({ saveMaterialRequest: vi.fn() }));

let mockEntregasPerm: 'editar' | 'ver' = 'editar';
/** Acesso por cliente: restricted to these clientes when set ('atribuidos'). */
let mockAssigned: number[] | null = null;
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const membership = fakeMembership({
      role: 'agent',
      role_id: 1,
      permissions: { entregas: mockEntregasPerm } as never,
      ...(mockAssigned ? { client_scope: 'atribuidos', cliente_ids: mockAssigned } : {}),
    });
    return { can: makeCan(membership), membership };
  },
}));

import { MaterialRequestEditor, MaterialStatusBadge } from '../references/MaterialRequestEditor';
import { saveMaterialRequest } from '@/store/postReferences';
import { useUnsavedWork } from '@mesaas/app-lifecycle';

const mockSave = vi.mocked(saveMaterialRequest);
const mockUnsaved = vi.mocked(useUnsavedWork);

function request(over: Partial<CrmMaterialRequest> = {}): CrmMaterialRequest {
  return {
    id: 1,
    post_id: 10,
    status: 'aberto',
    closed_by: null,
    closed_at: null,
    opened_by: 'u1',
    opened_at: '2026-11-06T15:00:00Z',
    opened_by_name: 'Ana',
    items: [
      { id: 1, label: 'Foto', detail: null, position: 0, file_count: 1, done: true },
      { id: 2, label: 'Logo', detail: 'PNG', position: 1, file_count: 0, done: false },
      { id: 3, label: 'Vídeo', detail: null, position: 2, file_count: 2, done: true },
    ],
    ...over,
  };
}

function renderEditor(
  props: { request?: CrmMaterialRequest | null; freeFormCount?: number; clienteId?: number } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (p: typeof props) => (
    <QueryClientProvider client={qc}>
      <MaterialRequestEditor
        postId={10}
        request={p.request ?? null}
        freeFormCount={p.freeFormCount ?? 0}
        clienteId={p.clienteId ?? 7}
      />
    </QueryClientProvider>
  );
  const utils = render(tree(props));
  return { ...utils, rerenderWith: (p: typeof props) => utils.rerender(tree(p)) };
}

describe('MaterialRequestEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntregasPerm = 'editar';
    mockAssigned = null;
  });

  it('shows the switch off with no request', () => {
    renderEditor();
    expect(screen.getByRole('switch', { name: 'Pedir material ao cliente' })).not.toBeChecked();
  });

  it('toggling on shows one empty row and Save disabled with the hint; typing enables Save', async () => {
    mockSave.mockResolvedValue(request());
    renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Pedir material ao cliente' }));
    expect(screen.getAllByRole('textbox', { name: /Nome do item/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Salvar pedido' })).toBeDisabled();
    expect(screen.getByText('Adicione pelo menos um item.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 1' }), {
      target: { value: 'Foto' },
    });
    const save = screen.getByRole('button', { name: 'Salvar pedido' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(10, {
        open: true,
        items: [{ label: 'Foto', detail: null }],
      }),
    );
  });

  it('hides "Adicionar item" when items plus free-form references reach 10', () => {
    const a = renderEditor({ request: request(), freeFormCount: 6 });
    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeInTheDocument();
    a.unmount();
    renderEditor({ request: request(), freeFormCount: 7 });
    expect(screen.queryByRole('button', { name: 'Adicionar item' })).toBeNull();
  });

  it('shows file badges, progress header and the requester footer', () => {
    renderEditor({ request: request() });
    expect(screen.getByText('Itens pedidos · 2 de 3 com arquivo')).toBeInTheDocument();
    expect(screen.getByText('1 arquivo')).toBeInTheDocument();
    expect(screen.getByText('2 arquivos')).toBeInTheDocument();
    expect(screen.getByText('Falta')).toBeInTheDocument();
    expect(screen.getByText(/^Pedido por Ana em 06\/11$/)).toBeInTheDocument();
  });

  it('turning the switch off on an open request cancels it keeping the items', async () => {
    mockSave.mockResolvedValue(request({ status: 'cancelado' }));
    renderEditor({ request: request() });
    fireEvent.click(screen.getByRole('switch', { name: 'Pedir material ao cliente' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(10, {
        open: false,
        items: [
          { id: 1, label: 'Foto', detail: null },
          { id: 2, label: 'Logo', detail: 'PNG' },
          { id: 3, label: 'Vídeo', detail: null },
        ],
      }),
    );
  });

  it('renders nothing without permission and without a request', () => {
    mockEntregasPerm = 'ver';
    const { container } = renderEditor();
    expect(container).toBeEmptyDOMElement();
  });

  it('is read-only without permission when a request exists', () => {
    mockEntregasPerm = 'ver';
    renderEditor({ request: request() });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar pedido' })).toBeNull();
    expect(screen.getByText('Logo')).toBeInTheDocument();
  });

  it('own-only ("é dele") member: read-only request, nothing without one', () => {
    // Restricted to client 8; the post's client 7 is outside their scope.
    mockAssigned = [8];
    renderEditor({ request: request() });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar pedido' })).toBeNull();
    expect(screen.getByText('Logo')).toBeInTheDocument();
  });

  it('own-only member without a request renders nothing', () => {
    mockAssigned = [8];
    const { container } = renderEditor();
    expect(container).toBeEmptyDOMElement();
  });

  it('restricted member on an assigned client keeps the editable request', () => {
    mockAssigned = [7];
    renderEditor({ request: request() });
    expect(screen.getByRole('switch', { name: 'Pedir material ao cliente' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nome do item 1' })).toBeInTheDocument();
  });

  it('registers unsaved work while a save is in flight and while the form is dirty', async () => {
    let resolve!: (r: CrmMaterialRequest) => void;
    mockSave.mockReturnValue(new Promise((r) => (resolve = r)));
    renderEditor({ request: request() });
    expect(mockUnsaved).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 1' }), {
      target: { value: 'Foto nova' },
    });
    expect(mockUnsaved).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled());
    expect(mockUnsaved).toHaveBeenLastCalledWith(true);
    resolve(request());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pedido de material salvo'));
  });

  it('row badges follow the latest request, not the local form', () => {
    const { rerenderWith } = renderEditor({ request: request() });
    expect(screen.getByText('Falta')).toBeInTheDocument();
    const r = request();
    r.items[1] = { ...r.items[1], file_count: 3, done: true };
    rerenderWith({ request: r });
    expect(screen.queryByText('Falta')).toBeNull();
    expect(screen.getByText('3 arquivos')).toBeInTheDocument();
  });

  it('a new unsaved row shows "Falta"', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Pedir material ao cliente' }));
    expect(screen.getByText('Falta')).toBeInTheDocument();
  });

  it('uses the helper copy from the spec', () => {
    renderEditor();
    expect(
      screen.getByText('O post aparece em Aprovações no Hub, mesmo em rascunho, com estes itens.'),
    ).toBeInTheDocument();
  });

  it('a concluded request keeps the switch on and shows items, progress and received line', () => {
    renderEditor({
      request: request({
        status: 'concluido',
        closed_by: 'client',
        closed_at: '2026-11-08T15:00:00Z',
      }),
    });
    expect(screen.getByRole('switch', { name: 'Pedir material ao cliente' })).toBeChecked();
    expect(screen.getAllByRole('textbox', { name: /Nome do item/ })).toHaveLength(3);
    expect(screen.getByText('Itens pedidos · 2 de 3 com arquivo')).toBeInTheDocument();
    expect(
      screen.getByText('Material recebido em 08/11 · enviado pelo cliente'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Pedido por Ana em 06\/11$/)).toBeInTheDocument();
  });

  it('received line has no client suffix when closed automatically', () => {
    renderEditor({
      request: request({
        status: 'concluido',
        closed_by: 'auto',
        closed_at: '2026-11-08T15:00:00Z',
      }),
    });
    expect(screen.getByText('Material recebido em 08/11')).toBeInTheDocument();
  });

  it('does not collapse after a save that auto-completes the request', async () => {
    mockSave.mockResolvedValue(
      request({ status: 'concluido', closed_by: 'auto', closed_at: '2026-11-08T15:00:00Z' }),
    );
    const { rerenderWith } = renderEditor({ request: request() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 2' }), {
      target: { value: 'Logo nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    rerenderWith({
      request: request({
        status: 'concluido',
        closed_by: 'auto',
        closed_at: '2026-11-08T15:00:00Z',
      }),
    });
    expect(screen.getByRole('switch', { name: 'Pedir material ao cliente' })).toBeChecked();
    expect(screen.getAllByRole('textbox', { name: /Nome do item/ })).toHaveLength(3);
  });

  it('cancelling discards local edits and sends the saved items', async () => {
    mockSave.mockResolvedValue(request({ status: 'cancelado' }));
    renderEditor({ request: request() });
    fireEvent.click(screen.getByRole('button', { name: 'Remover item 3' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 1' }), {
      target: { value: 'Mudou' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Pedir material ao cliente' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][1].items).toEqual([
      { id: 1, label: 'Foto', detail: null },
      { id: 2, label: 'Logo', detail: 'PNG' },
      { id: 3, label: 'Vídeo', detail: null },
    ]);
  });

  it('blank name on an existing item blocks Save instead of deleting it', () => {
    renderEditor({ request: request() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 1' }), {
      target: { value: '  ' },
    });
    expect(screen.getByRole('button', { name: 'Salvar pedido' })).toBeDisabled();
    expect(screen.getByText('Dê um nome a cada item.')).toBeInTheDocument();
  });

  it('maps server error codes to Portuguese copy', async () => {
    mockSave.mockRejectedValue(new Error('too_many_items'));
    renderEditor({ request: request() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do item 1' }), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('O pedido aceita no máximo 10 itens.'),
    );
  });
});

describe('MaterialStatusBadge', () => {
  it('shows "Aguardando material" while open', () => {
    render(<MaterialStatusBadge request={request()} postStatus="rascunho" />);
    expect(screen.getByText('Aguardando material')).toBeInTheDocument();
  });
  it('shows "Material recebido" when concluded and the post is internal', () => {
    render(
      <MaterialStatusBadge request={request({ status: 'concluido' })} postStatus="rascunho" />,
    );
    expect(screen.getByText('Material recebido')).toBeInTheDocument();
  });
  it('hides once the post leaves the internal statuses', () => {
    const { container } = render(
      <MaterialStatusBadge request={request({ status: 'concluido' })} postStatus="agendado" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('hides without a request or when cancelled', () => {
    const a = render(<MaterialStatusBadge request={null} postStatus="rascunho" />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(
      <MaterialStatusBadge request={request({ status: 'cancelado' })} postStatus="rascunho" />,
    );
    expect(b.container).toBeEmptyDOMElement();
  });
});
