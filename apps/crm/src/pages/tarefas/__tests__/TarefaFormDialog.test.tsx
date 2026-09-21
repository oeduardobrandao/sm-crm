import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TarefaWithRelations } from '../../../store';

const {
  addTarefaMock,
  toastErrorMock,
  getMembrosMock,
  getClientesMock,
  getTarefasMock,
  searchPostsForMentionMock,
  uploadInlineImageMock,
  criarTarefaSerieMock,
  aplicarEdicaoSerieMock,
  updateTarefaMock,
  isSerieDateConflictMock,
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
  criarTarefaSerieMock: vi.fn(),
  aplicarEdicaoSerieMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  // falsy by default (bare vi.fn returns undefined); a test opts in with mockReturnValue(true)
  isSerieDateConflictMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: updateTarefaMock,
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
  criarTarefaSerie: criarTarefaSerieMock,
  aplicarEdicaoSerie: aplicarEdicaoSerieMock,
  definirEstadoSerie: vi.fn(),
  deleteTarefaSerieCompleta: vi.fn(),
  isSerieDateConflict: isSerieDateConflictMock,
  isSerieSemPrazo: () => false,
}));
// jsdom cannot drive Radix Select; a native stand-in (same reasoning as the
// dropdown-menu mock in TarefaCard.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select value={value} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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

/** The <select> that owns an option with this label (the Select mock renders native selects). */
function selectWithOption(label: string): HTMLSelectElement {
  const match = screen
    .getAllByRole('combobox')
    .find((el) => within(el).queryByRole('option', { name: label }));
  if (!match) throw new Error(`no select with option ${label}`);
  return match as HTMLSelectElement;
}

function makeEditing(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Tarefa',
    descricao: null,
    descricao_rich: null,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: '2099-01-05',
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
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

describe('TarefaFormDialog due-date prefill', () => {
  it('prefills the Prazo field from initialValues.data_limite in create mode', () => {
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
        initialValues={{ data_limite: '2026-08-15' }}
      />,
    );
    expect(screen.getByText('15/08/2026')).toBeInTheDocument();
  });

  it('leaves the Prazo field empty when initialValues.data_limite is null', () => {
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
        initialValues={{ data_limite: null }}
      />,
    );
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
  });
});

describe('TarefaFormDialog Repetir', () => {
  const baseProps = {
    open: true,
    onClose: () => {},
    membros: [],
    clientes: CLIENTES,
    tags: [],
    onSaved: () => {},
    onTagCreated: () => {},
  };

  it('is hidden in conversion mode (onCreate)', () => {
    renderDialog(<TarefaFormDialog {...baseProps} editing={null} onCreate={vi.fn()} />);
    expect(screen.queryByText('Repetir')).not.toBeInTheDocument();
  });

  it('creates a series through criarTarefaSerie (not addTarefa) with the rule derived from Prazo', async () => {
    criarTarefaSerieMock.mockResolvedValue({ serie_id: 1, tarefa_id: 2 });
    const onSaved = vi.fn();
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={null}
        onSaved={onSaved}
        initialValues={{ titulo: 'Fechamento', data_limite: '2099-01-31' }}
      />,
    );
    fireEvent.change(selectWithOption('Mensalmente'), { target: { value: 'monthly' } });
    expect(await screen.findByText('Todo dia 31 (ou último dia)')).toBeInTheDocument();
    // ToggleGroup type="single" renders its items with role="radio" (Radix)
    fireEvent.click(screen.getByRole('radio', { name: 'Criar em toda data da regra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(criarTarefaSerieMock).toHaveBeenCalledTimes(1));
    const [regra, payload, tagIds, subtarefas, tarefaId] = criarTarefaSerieMock.mock.calls[0];
    expect(regra).toEqual({
      freq: 'monthly',
      intervalo: 1,
      dias_semana: null,
      dia_mes: 31,
      mes: null,
      modo: 'calendario',
      fim: null,
    });
    expect(payload).toMatchObject({
      titulo: 'Fechamento',
      data_limite: '2099-01-31',
      status: 'pendente',
    });
    expect(tagIds).toEqual([]);
    expect(subtarefas).toEqual([]);
    expect(tarefaId).toBeUndefined();
    expect(addTarefaMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('validates: weekly needs a day, rule needs a due date', async () => {
    renderDialog(
      <TarefaFormDialog {...baseProps} editing={null} initialValues={{ titulo: 'x' }} />,
    );
    fireEvent.change(selectWithOption('Semanalmente'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    expect(
      await screen.findByText('Defina um prazo: ele será a primeira ocorrência.'),
    ).toBeInTheDocument();
    expect(criarTarefaSerieMock).not.toHaveBeenCalled();
  });

  it('promotes a standalone task: criarTarefaSerie receives the task id and no scope dialog opens', async () => {
    criarTarefaSerieMock.mockResolvedValue({ serie_id: 1, tarefa_id: 42 });
    renderDialog(<TarefaFormDialog {...baseProps} editing={makeEditing()} />);
    fireEvent.change(selectWithOption('Diariamente'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(criarTarefaSerieMock).toHaveBeenCalledTimes(1));
    const [regra, payload, tagIds, , tarefaId] = criarTarefaSerieMock.mock.calls[0];
    expect(regra).toMatchObject({ freq: 'daily', intervalo: 1, modo: 'ao_concluir', fim: null });
    expect(payload).toMatchObject({ titulo: 'Tarefa', data_limite: '2099-01-05' });
    expect(tagIds).toEqual([]);
    expect(tarefaId).toBe(42);
    expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument();
  });

  it('disables Repetir with a hint when editing a concluida standalone task', () => {
    renderDialog(
      <TarefaFormDialog {...baseProps} editing={makeEditing({ status: 'concluida' })} />,
    );
    expect(selectWithOption('Diariamente')).toBeDisabled();
    expect(screen.getByText('Reabra a tarefa para torná-la recorrente.')).toBeInTheDocument();
  });

  it('keeps the series landing day when Prazo changes in edit mode', async () => {
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({
          data_limite: '2026-02-28',
          serie: {
            id: 9,
            freq: 'monthly',
            intervalo: 1,
            dias_semana: null,
            dia_mes: 31,
            mes: null,
            modo: 'ao_concluir',
            fim: null,
            inicio: '2026-01-31',
            pausada: false,
            encerrada_em: null,
            proxima_data: null,
          },
        })}
      />,
    );
    expect(await screen.findByText('Todo dia 31 (ou último dia)')).toBeInTheDocument();
  });

  it('does not render a degraded summary while the rule is incomplete', async () => {
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={null}
        initialValues={{ titulo: 'x', data_limite: '2099-01-05' }}
      />,
    );
    fireEvent.change(selectWithOption('Semanalmente'), { target: { value: 'weekly' } });
    // weekly with no weekday chip selected: no summary, no dangling "Toda "
    await screen.findByRole('button', { name: 'segunda' });
    expect(screen.queryByTestId('recorrencia-resumo')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'segunda' }));
    expect(await screen.findByTestId('recorrencia-resumo')).toHaveTextContent(
      'Toda segunda · cria a próxima ao concluir',
    );

    // emptied interval input: no "A cada NaN semanas"
    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByTestId('recorrencia-resumo')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '2' } });
    expect(await screen.findByTestId('recorrencia-resumo')).toHaveTextContent(
      'A cada 2 semanas, na segunda',
    );
  });

  const SERIE = {
    id: 9,
    freq: 'weekly' as const,
    intervalo: 1,
    dias_semana: [1],
    dia_mes: null,
    mes: null,
    modo: 'ao_concluir' as const,
    fim: null,
    inicio: '2026-01-05',
    pausada: false,
    encerrada_em: null,
    proxima_data: null,
  };

  it('editing an occurrence opens the scope dialog; "Esta e as próximas" sends the full payload, tags and whole rule', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({
          data_limite: '2026-01-12',
          serie: SERIE,
          tags: [{ id: 3, nome: 't', cor: '#000' }],
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo título' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Aplicar a quais tarefas?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'As próximas tarefas criadas usarão estas alterações. Tarefas que já existem não mudam.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Esta e as próximas' }));
    await waitFor(() => expect(aplicarEdicaoSerieMock).toHaveBeenCalledTimes(1));
    const [id, payload, tagIds, regra, encerrar] = aplicarEdicaoSerieMock.mock.calls[0];
    expect(id).toBe(42);
    expect(payload).toEqual({
      titulo: 'Novo título',
      descricao: null,
      descricao_rich: null,
      status: 'pendente',
      responsavel_id: null,
      cliente_id: null,
      data_limite: '2026-01-12',
    });
    expect(tagIds).toEqual([3]);
    expect(regra).toEqual({
      freq: 'weekly',
      intervalo: 1,
      dias_semana: [1],
      dia_mes: null,
      mes: null,
      modo: 'ao_concluir',
      fim: null,
    });
    expect(encerrar).toBe(false);
    expect(updateTarefaMock).not.toHaveBeenCalled();
    expect(criarTarefaSerieMock).not.toHaveBeenCalled();
  });

  it('"Somente esta" is disabled with the helper when the rule changed, enabled otherwise and uses updateTarefa', async () => {
    updateTarefaMock.mockResolvedValue({});
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeDisabled();
    expect(screen.getByText('A regra de repetição vale para toda a série.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    fireEvent.click(screen.getByRole('button', { name: 'Somente esta' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ titulo: 'Tarefa' }),
      ),
    );
    expect(aplicarEdicaoSerieMock).not.toHaveBeenCalled();
    expect(criarTarefaSerieMock).not.toHaveBeenCalled();
  });

  it('"Esta e as próximas" with a changed rule sends the form rule (not the stored one)', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeDisabled();
    expect(screen.getByText('A regra de repetição vale para toda a série.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Esta e as próximas' }));
    await waitFor(() => expect(aplicarEdicaoSerieMock).toHaveBeenCalledTimes(1));
    expect(aplicarEdicaoSerieMock.mock.calls[0][3]).toMatchObject({ freq: 'weekly', intervalo: 2 });
    expect(aplicarEdicaoSerieMock.mock.calls[0][4]).toBe(false);
    expect(updateTarefaMock).not.toHaveBeenCalled();
  });

  it('"Não repete" on an occurrence skips the dialog and ends the series (encerrar = true)', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    const onSaved = vi.fn();
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        onSaved={onSaved}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.change(selectWithOption('Não repete'), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(aplicarEdicaoSerieMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument();
    expect(aplicarEdicaoSerieMock.mock.calls[0][4]).toBe(true);
    // the stored rule is sent unchanged, not the (hidden) form fields
    expect(aplicarEdicaoSerieMock.mock.calls[0][3]).toMatchObject({
      freq: 'weekly',
      dias_semana: [1],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('a failed scope save keeps the form open and surfaces the error', async () => {
    aplicarEdicaoSerieMock.mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        onSaved={onSaved}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    fireEvent.click(screen.getByRole('button', { name: 'Esta e as próximas' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Erro ao atualizar tarefa'));
    expect(onSaved).not.toHaveBeenCalled();
    // dialog and form both survive so the user can retry
    expect(screen.getByText('Aplicar a quais tarefas?')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toBeInTheDocument();
  });

  it('a series date conflict on "Esta e as próximas" shows the pt-BR message and keeps dialog and form open', async () => {
    isSerieDateConflictMock.mockReturnValue(true);
    aplicarEdicaoSerieMock.mockRejectedValue({ code: '23505', message: 'duplicate key' });
    const onSaved = vi.fn();
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        onSaved={onSaved}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    fireEvent.click(screen.getByRole('button', { name: 'Esta e as próximas' }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Já existe uma ocorrência desta série nesse dia.',
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText('Aplicar a quais tarefas?')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toBeInTheDocument();
  });

  it('editing an occurrence with an unchanged rule never calls criarTarefaSerie', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    updateTarefaMock.mockResolvedValue({});
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Somente esta' }));
    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledTimes(1));
    expect(criarTarefaSerieMock).not.toHaveBeenCalled();
    expect(aplicarEdicaoSerieMock).not.toHaveBeenCalled();
  });

  it('labels the weekday group and the mode group for assistive tech', async () => {
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={null}
        initialValues={{ titulo: 'x', data_limite: '2099-01-05' }}
      />,
    );
    fireEvent.change(selectWithOption('Semanalmente'), { target: { value: 'weekly' } });
    expect(await screen.findByRole('group', { name: 'Dias da semana' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Modo de geração' })).toBeInTheDocument();
  });
});
