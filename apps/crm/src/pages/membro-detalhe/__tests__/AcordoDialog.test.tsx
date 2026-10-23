import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  store: {
    getFuncoes: vi.fn(),
    getPeriodosEditaveis: vi.fn(),
    salvarAcordo: vi.fn(),
    uploadContratoAcordo: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import type { AcordoVersao, Membro } from '@/store';
import { AcordoDialog } from '../AcordoDialog';

const ANA: Membro = {
  id: 3,
  nome: 'Ana',
  cargo: 'Designer',
  tipo: 'clt',
  custo_mensal: 3900,
  data_pagamento: 5,
  avatar_url: null,
};

const ATUAL: AcordoVersao = {
  id: 1,
  membro_id: 3,
  vale_desde: '2026-10-01',
  funcao_id: 2,
  modelo: 'mensal_meta',
  valor: 3900,
  unidade: 'arte',
  meta_quantidade: 8,
  meta_periodo: 'dia_util',
  limite_clientes: null,
  dia_pagamento: 5,
  vigencia_inicio: null,
  vigencia_fim: null,
  arquivo_path: 'contratos/ana.pdf',
  created_by: null,
};

/** `null` renders the dialog for a member with no acordo yet. */
function renderDialog(atual: AcordoVersao | null = ATUAL) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AcordoDialog open onOpenChange={onOpenChange} membro={ANA} atual={atual ?? undefined} />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'w1' } });
  store.getFuncoes.mockResolvedValue([
    { id: 1, nome: 'Videomaker', ordem: 0 },
    { id: 2, nome: 'Design', ordem: 1 },
  ]);
  store.getPeriodosEditaveis.mockResolvedValue([
    {
      inicio: '2026-10-01',
      fim: '2026-11-01',
      rotulo: 'out 2026',
      status: 'aberto',
      transicao: false,
    },
    {
      inicio: '2026-11-01',
      fim: '2026-12-01',
      rotulo: 'nov 2026',
      status: 'futuro',
      transicao: false,
    },
  ]);
  store.salvarAcordo.mockResolvedValue(undefined);
  store.uploadContratoAcordo.mockResolvedValue('w1/3/novo.pdf');
});

/** The period select fills in once the editable periods load. */
async function ready() {
  await screen.findByRole('combobox', { name: 'Vale a partir de' });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Vale a partir de' })).toHaveTextContent(
      'out 2026',
    ),
  );
}

const modeloBtn = (nome: string) => screen.getByRole('button', { name: new RegExp(`^${nome}`) });

describe('AcordoDialog', () => {
  it('model_switch_changes_fields', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    expect(modeloBtn('Mensal com meta')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Valor mensal' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Quantidade da meta' })).toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Limite de clientes' }),
    ).not.toBeInTheDocument();

    await user.click(modeloBtn('Mensal com limite'));
    expect(modeloBtn('Mensal com limite')).toHaveAttribute('aria-pressed', 'true');
    expect(modeloBtn('Mensal com meta')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('spinbutton', { name: 'Limite de clientes' })).toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Quantidade da meta' }),
    ).not.toBeInTheDocument();

    await user.click(modeloBtn('Por entrega'));
    expect(screen.getByRole('spinbutton', { name: 'Valor por entrega' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Valor mensal' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Limite de clientes' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Quantidade da meta' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Recebe por cada entrega feita.')).toBeInTheDocument();
  });

  it('meta_hint_176', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    expect(screen.getByText('Cerca de 176 por mês')).toBeVisible();

    const qtd = screen.getByRole('spinbutton', { name: 'Quantidade da meta' });
    await user.clear(qtd);
    await user.type(qtd, '3');
    expect(screen.getByText('Cerca de 66 por mês')).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: 'Período da meta' }));
    await user.click(await screen.findByRole('option', { name: 'semana' }));
    expect(screen.getByText('Cerca de 13 por mês')).toBeVisible();
  });

  it('submit_calls_salvarAcordo_with_payload', async () => {
    const user = userEvent.setup();
    const { invalidate, onOpenChange } = renderDialog();
    await ready();

    const valor = screen.getByRole('spinbutton', { name: 'Valor mensal' });
    await user.clear(valor);
    await user.type(valor, '4200');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(3, '2026-10-01', {
        funcao_id: 2,
        modelo: 'mensal_meta',
        valor: 4200,
        unidade: 'arte',
        meta_quantidade: 8,
        meta_periodo: 'dia_util',
        limite_clientes: null,
        dia_pagamento: 5,
        vigencia_inicio: null,
        vigencia_fim: null,
        arquivo_path: 'contratos/ana.pdf',
      }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['membros'] });
    expect(toastMock.success).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends null for the fields that do not apply to a por_entrega acordo', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    await user.click(modeloBtn('Por entrega'));
    const valor = screen.getByRole('spinbutton', { name: 'Valor por entrega' });
    await user.clear(valor);
    await user.type(valor, '45.5');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(
        3,
        '2026-10-01',
        expect.objectContaining({
          modelo: 'por_entrega',
          valor: 45.5,
          unidade: null,
          meta_quantidade: null,
          meta_periodo: null,
          limite_clientes: null,
        }),
      ),
    );
  });

  it('saves "Sem função" as a null funcao_id', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    await user.click(screen.getByRole('combobox', { name: 'Função' }));
    await user.click(await screen.findByRole('option', { name: 'Sem função' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(
        3,
        '2026-10-01',
        expect.objectContaining({ funcao_id: null }),
      ),
    );
  });

  it('zod_rejects_limite_zero', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    await user.click(modeloBtn('Mensal com limite'));
    const limite = screen.getByRole('spinbutton', { name: 'Limite de clientes' });
    await user.clear(limite);
    await user.type(limite, '0');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Informe um limite maior que zero.')).toBeVisible();
    expect(store.salvarAcordo).not.toHaveBeenCalled();
  });

  it('rejects a vigência that ends before it starts', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    await user.type(screen.getByLabelText('Início da vigência'), '2026-10-20');
    await user.type(screen.getByLabelText('Fim da vigência'), '2026-10-10');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('O fim não pode ser antes do início.')).toBeVisible();
    expect(store.salvarAcordo).not.toHaveBeenCalled();
  });

  it('starts a new acordo from the legacy cost and payment day', async () => {
    const user = userEvent.setup();
    renderDialog(null);
    await ready();

    expect(modeloBtn('Mensal com meta')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Valor mensal' })).toHaveValue(3900);
    expect(screen.getByRole('spinbutton', { name: 'Dia de pagamento' })).toHaveValue(5);

    // A mensal_meta acordo needs its meta.
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe uma meta maior que zero.')).toBeVisible();
    expect(store.salvarAcordo).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and toasts when the save fails', async () => {
    const user = userEvent.setup();
    store.salvarAcordo.mockRejectedValueOnce(new Error('boom'));
    const { onOpenChange } = renderDialog();
    await ready();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('rejects_large_file_with_message', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    const grande = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'contrato.pdf', {
      type: 'application/pdf',
    });
    await user.upload(screen.getByLabelText('Arquivo do contrato'), grande);

    expect(await screen.findByText('Envie um PDF ou imagem de até 10 MB.')).toBeVisible();
    expect(store.uploadContratoAcordo).not.toHaveBeenCalled();

    // The previous path survives the rejected pick.
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(
        3,
        '2026-10-01',
        expect.objectContaining({ arquivo_path: 'contratos/ana.pdf' }),
      ),
    );
  });

  it('rejects a file of another type', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderDialog();
    await ready();

    await user.upload(
      screen.getByLabelText('Arquivo do contrato'),
      new File(['x'], 'nota.txt', { type: 'text/plain' }),
    );

    expect(await screen.findByText('Envie um PDF ou imagem de até 10 MB.')).toBeVisible();
    expect(store.uploadContratoAcordo).not.toHaveBeenCalled();
  });

  it('upload_sets_arquivo_path', async () => {
    const user = userEvent.setup();
    renderDialog();
    await ready();

    expect(screen.getByText('Contrato.pdf')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trocar arquivo' })).toBeVisible();

    const pdf = new File(['%PDF'], 'novo.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Arquivo do contrato'), pdf);
    await waitFor(() => expect(store.uploadContratoAcordo).toHaveBeenCalledWith(3, pdf));

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(
        3,
        '2026-10-01',
        expect.objectContaining({ arquivo_path: 'w1/3/novo.pdf' }),
      ),
    );
  });

  it('offers "Enviar arquivo" when there is no contract yet', async () => {
    renderDialog({ ...ATUAL, arquivo_path: null });
    await ready();
    expect(screen.getByRole('button', { name: 'Enviar arquivo' })).toBeVisible();
    expect(screen.getByText('Nenhum arquivo')).toBeVisible();
  });

  it('disables save while uploading and ignores a second submit', async () => {
    const user = userEvent.setup();
    let resolver!: (p: string) => void;
    store.uploadContratoAcordo.mockReturnValue(new Promise<string>((r) => (resolver = r)));
    renderDialog();
    await ready();

    await user.upload(
      screen.getByLabelText('Arquivo do contrato'),
      new File(['%PDF'], 'novo.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText('Enviando arquivo...')).toBeVisible();
    expect(screen.getByRole('button', { name: /Salvar/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Salvar/ }));
    expect(store.salvarAcordo).not.toHaveBeenCalled();

    resolver('w1/3/novo.pdf');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled());
  });

  it('toasts and keeps the previous path when the upload fails', async () => {
    const user = userEvent.setup();
    store.uploadContratoAcordo.mockRejectedValueOnce(new Error('boom'));
    renderDialog();
    await ready();

    await user.upload(
      screen.getByLabelText('Arquivo do contrato'),
      new File(['%PDF'], 'novo.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(store.salvarAcordo).toHaveBeenCalledWith(
        3,
        '2026-10-01',
        expect.objectContaining({ arquivo_path: 'contratos/ana.pdf' }),
      ),
    );
  });
});
