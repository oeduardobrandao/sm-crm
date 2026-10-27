import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinhaColuna } from '@/store/linhaEditorial';

const m = vi.hoisted(() => ({
  addColuna: vi.fn(),
  updateColuna: vi.fn(),
  excluirColuna: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store/linhaEditorial', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/linhaEditorial')>()),
  addColuna: m.addColuna,
  updateColuna: m.updateColuna,
  excluirColuna: m.excluirColuna,
}));
vi.mock('sonner', () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));

import { ColunasPopover } from '../ColunasPopover';

const PILAR: LinhaColuna = {
  id: 'c-pilar',
  nome: 'Pilar',
  tipo: 'select',
  config: { options: [{ id: 'o1', label: 'Educação', color: '#3b82f6' }] },
  visivel_cliente: true,
  oculta: false,
  ordem: 0,
};
const REF: LinhaColuna = {
  id: 'c-ref',
  nome: 'Referência',
  tipo: 'url',
  config: {},
  visivel_cliente: true,
  oculta: false,
  ordem: 1,
};

function renderPopover(
  over: Partial<React.ComponentProps<typeof ColunasPopover>> = {},
  colunas: LinhaColuna[] = [PILAR, REF],
) {
  const onDirecaoOcultaChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ColunasPopover
        colunas={colunas}
        direcaoOculta={false}
        onDirecaoOcultaChange={onDirecaoOcultaChange}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { onDirecaoOcultaChange, qc };
}

async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Colunas' }));
  return screen.findByRole('dialog', { name: 'Colunas da linha editorial' });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.addColuna.mockImplementation(async (input: Partial<LinhaColuna>) => ({
    id: 'c-new',
    config: {},
    visivel_cliente: true,
    oculta: false,
    ordem: 2,
    ...input,
  }));
  m.updateColuna.mockResolvedValue(undefined);
  m.excluirColuna.mockResolvedValue(undefined);
});

describe('ColunasPopover', () => {
  it('lists fixed and extra columns with the footnote', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    for (const nome of ['Data', 'Formato', 'Título', 'Direção do conteúdo', 'Pilar', 'Referência'])
      expect(within(pop).getByText(nome)).toBeInTheDocument();
    expect(within(pop).getAllByText('fixa')).toHaveLength(3);
    expect(within(pop).getByText('Valem para todas as linhas da agência.')).toBeInTheDocument();
  });

  it('Nova coluna Seleção creates column with options', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Nova coluna' }));
    await user.type(within(pop).getByLabelText('Nome da coluna'), 'Tom');
    await user.click(within(pop).getByRole('button', { name: 'Seleção' }));
    const opcao = within(pop).getByLabelText('Nova opção');
    await user.type(opcao, 'Leve{Enter}');
    await user.type(opcao, 'Sério{Enter}');
    await user.click(within(pop).getByRole('button', { name: 'Criar coluna' }));
    await waitFor(() =>
      expect(m.addColuna).toHaveBeenCalledWith({
        nome: 'Tom',
        tipo: 'select',
        config: {
          options: [
            expect.objectContaining({ label: 'Leve', id: expect.any(String) }),
            expect.objectContaining({ label: 'Sério', id: expect.any(String) }),
          ],
        },
        visivel_cliente: true,
      }),
    );
  });

  it('name collision shows "Já existe uma coluna com esse nome."', async () => {
    const user = userEvent.setup();
    m.addColuna.mockRejectedValue({ code: '23505', message: 'duplicate key value' });
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Nova coluna' }));
    await user.type(within(pop).getByLabelText('Nome da coluna'), 'Gancho');
    await user.click(within(pop).getByRole('button', { name: 'Criar coluna' }));
    expect(await within(pop).findByText('Já existe uma coluna com esse nome.')).toBeInTheDocument();
    expect(m.addColuna).toHaveBeenCalledTimes(1);
  });

  it('a name that only differs by accent is refused before the insert', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Nova coluna' }));
    await user.type(within(pop).getByLabelText('Nome da coluna'), 'pílar');
    await user.click(within(pop).getByRole('button', { name: 'Criar coluna' }));
    expect(await within(pop).findByText('Já existe uma coluna com esse nome.')).toBeInTheDocument();
    expect(m.addColuna).not.toHaveBeenCalled();
  });

  it('Excluir coluna asks confirm then calls excluirColuna', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Ações da coluna Pilar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    expect(await screen.findByText(/Excluir a coluna “Pilar”\?/)).toBeInTheDocument();
    expect(m.excluirColuna).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Excluir coluna' }));
    await waitFor(() => expect(m.excluirColuna).toHaveBeenCalledWith('c-pilar'));
  });

  it('Visível para o cliente toggles visivel_cliente', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Ações da coluna Referência' }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Visível para o cliente' }),
    );
    await waitFor(() =>
      expect(m.updateColuna).toHaveBeenCalledWith('c-ref', { visivel_cliente: false }),
    );
  });

  it('Renomear saves only the name', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('button', { name: 'Ações da coluna Referência' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Renomear' }));
    const input = await within(pop).findByLabelText('Novo nome da coluna');
    await user.clear(input);
    await user.type(input, 'Inspiração{Enter}');
    await waitFor(() =>
      expect(m.updateColuna).toHaveBeenCalledWith('c-ref', { nome: 'Inspiração' }),
    );
  });

  it('extra column visibility switch writes oculta', async () => {
    const user = userEvent.setup();
    renderPopover();
    const pop = await abrir(user);
    await user.click(within(pop).getByRole('switch', { name: 'Mostrar Pilar na tabela' }));
    await waitFor(() => expect(m.updateColuna).toHaveBeenCalledWith('c-pilar', { oculta: true }));
  });

  it('Direção do conteúdo switch reports the preference', async () => {
    const user = userEvent.setup();
    const { onDirecaoOcultaChange } = renderPopover();
    const pop = await abrir(user);
    await user.click(
      within(pop).getByRole('switch', { name: 'Mostrar Direção do conteúdo na tabela' }),
    );
    expect(onDirecaoOcultaChange).toHaveBeenCalledWith(true);
  });
});
