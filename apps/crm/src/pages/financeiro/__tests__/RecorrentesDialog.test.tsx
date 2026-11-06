import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransacaoRecorrente } from '../../../store';

const { store } = vi.hoisted(() => ({
  store: { updateRecorrente: vi.fn(), removeRecorrente: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../store', () => store);

import { RecorrentesDialog } from '../RecorrentesDialog';

const canva: TransacaoRecorrente = {
  id: 7,
  tipo: 'saida',
  descricao: 'Canva',
  categoria: 'Ferramenta',
  valor: 99.9,
  dia: 10,
  inicio: '2026-09-01',
  fim: null,
};

function renderDialog(recorrentes: TransacaoRecorrente[], onChanged = vi.fn()) {
  render(
    <RecorrentesDialog
      open
      onOpenChange={() => {}}
      recorrentes={recorrentes}
      categorias={['Ferramenta', 'Imposto']}
      access
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

async function encerrar(descricao: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
  const confirm = screen.getByRole('group', { name: `Encerrar ${descricao}` });
  expect(confirm).toHaveTextContent(`Encerrar "${descricao}"?`);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Encerrar' }));
}

describe('RecorrentesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15)); // 15 Nov 2026
    store.updateRecorrente.mockResolvedValue(undefined);
    store.removeRecorrente.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('lists only the ones still active this month', () => {
    renderDialog([canva, { ...canva, id: 8, descricao: 'Antigo', fim: '2026-10-01' }]);
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Todo dia 10 · Ferramenta')).toBeInTheDocument();
    expect(screen.queryByText('Antigo')).toBeNull();
  });

  it('explains how to create one when there is none', () => {
    renderDialog([{ ...canva, fim: '2026-10-01' }]);
    expect(screen.getByText(/Nenhum lançamento recorrente/)).toHaveTextContent(
      'marque "Repetir todo mês"',
    );
  });

  it('edits descrição, valor and dia', async () => {
    const onChanged = renderDialog([canva]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Canva' }));
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Canva Pro ' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Dia do mês'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(store.updateRecorrente).toHaveBeenCalledWith(7, {
      descricao: 'Canva Pro',
      valor: 120,
      dia: 5,
      categoria: 'Ferramenta',
    });
  });

  it('does not save an invalid dia', () => {
    renderDialog([canva]);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Canva' }));
    fireEvent.change(screen.getByLabelText('Dia do mês'), { target: { value: '32' } });
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('ends an older one on the previous month, keeping its history', async () => {
    const onChanged = renderDialog([canva]);
    await encerrar('Canva');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(store.updateRecorrente).toHaveBeenCalledWith(7, { fim: '2026-10-01' });
    expect(store.removeRecorrente).not.toHaveBeenCalled();
  });

  it('backs out of Encerrar with Não', () => {
    renderDialog([canva]);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(screen.getByText('Todo dia 10 · Ferramenta')).toBeInTheDocument();
    expect(store.updateRecorrente).not.toHaveBeenCalled();
  });

  it('removes one that started this month', async () => {
    const onChanged = renderDialog([{ ...canva, inicio: '2026-11-01' }]);
    await encerrar('Canva');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(store.removeRecorrente).toHaveBeenCalledWith(7);
    expect(store.updateRecorrente).not.toHaveBeenCalled();
  });
});
