import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { CrmMaterialRequest } from '@/store/postReferences';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('@/store/postReferences', () => ({ saveMaterialRequest: vi.fn() }));

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

function renderEditor(props: { request?: CrmMaterialRequest | null; freeFormCount?: number } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MaterialRequestEditor
        postId={10}
        request={props.request ?? null}
        freeFormCount={props.freeFormCount ?? 0}
      />
    </QueryClientProvider>,
  );
}

describe('MaterialRequestEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntregasPerm = 'editar';
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
    renderEditor({ request: request(), freeFormCount: 6 });
    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeInTheDocument();
    renderEditor({ request: request(), freeFormCount: 7 });
    expect(screen.getAllByRole('button', { name: 'Adicionar item' })).toHaveLength(1);
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
    void within;
  });
});
