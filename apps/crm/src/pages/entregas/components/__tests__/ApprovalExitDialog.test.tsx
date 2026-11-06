import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

import { ApprovalExitDialog, type ApprovalExitDialogProps } from '../ApprovalExitDialog';

const numbers = { pendentes: 3, alteraveisRascunho: 7, aprovadoInterno: 2 };
const baseProps: ApprovalExitDialogProps = {
  open: true,
  entityKind: 'fluxo',
  entityTitle: 'Março',
  nextEtapaName: 'Design',
  counts: { aprovado_cliente: 5, enviado_cliente: 2, rascunho: 1 },
  options: ['manter', 'aprovar', 'voltar_rascunho', 'enviar_portal'],
  recommended: 'manter',
  numbers,
  onConfirm: () => {},
  onCancel: () => {},
};
function setup(over: Partial<ApprovalExitDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const ui = (o: Partial<ApprovalExitDialogProps>) => (
    <MemoryRouter>
      <ApprovalExitDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} {...o} />
    </MemoryRouter>
  );
  const view = render(ui(over));
  return {
    onConfirm,
    onCancel,
    rerender: (o: Partial<ApprovalExitDialogProps>) => view.rerender(ui({ ...over, ...o })),
  };
}

const checkedValue = () =>
  (screen.getAllByRole('radio') as HTMLInputElement[]).find((r) => r.checked)?.value;

beforeEach(() => {
  desktop.value = true;
});

describe('ApprovalExitDialog (desktop)', () => {
  it('marca a recomendada, mostra título e chips', () => {
    setup({ recommended: 'voltar_rascunho' });
    expect(screen.getByText('Avançar "Março" para Design?')).toBeTruthy();
    expect(screen.getByText('Aprovado pelo cliente: 5')).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.find((r) => r.checked)?.value).toBe('voltar_rascunho');
    expect(screen.getByText('Recomendado')).toBeTruthy();
  });
  it('onConfirm recebe a opção marcada depois de trocar', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByLabelText(/Aprovar todos/));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(onConfirm).toHaveBeenCalledWith('aprovar');
  });
  it('primário desabilitado com counts null', () => {
    setup({ counts: null });
    expect((screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('rótulo vira Enviar ao portal ao marcar essa opção', () => {
    setup();
    fireEvent.click(screen.getByLabelText(/Enviar ao portal/));
    expect(screen.getAllByRole('button', { name: 'Enviar ao portal' }).length).toBe(1);
  });
  it('título Concluir sem próxima etapa e botão Concluir', () => {
    setup({ nextEtapaName: null });
    expect(screen.getByText('Concluir "Março"?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy();
  });
  it('nenhuma string renderizada tem travessão', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/—/);
  });
  it('locked mostra só a linha fixa', () => {
    setup({ locked: true, entityKind: 'post', options: ['manter'] });
    expect(screen.getByText('O status do post não muda.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
  it('mostra a linha das sugestões não revisadas só quando a contagem passa de zero', () => {
    const { rerender } = setup();
    expect(screen.queryByText(/com sugestão do cliente não revisada/)).toBeNull();
    rerender({ pendingSuggestionCount: 0 });
    expect(screen.queryByText(/com sugestão do cliente não revisada/)).toBeNull();
    rerender({ pendingSuggestionCount: 1 });
    expect(screen.getByText('1 post com sugestão do cliente não revisada.')).toBeTruthy();
    rerender({ pendingSuggestionCount: 3 });
    expect(screen.getByText('3 posts com sugestão do cliente não revisada.')).toBeTruthy();
  });
  it('post mostra só o status atual, sem contagem', () => {
    setup({ entityKind: 'post', counts: { aprovado_cliente: 1 }, options: ['manter'] });
    expect(screen.getByText('Aprovado pelo cliente')).toBeTruthy();
  });
});

describe('ApprovalExitDialog (desktop): seleção e foco', () => {
  it('ao abrir, o foco vai para a opção marcada, não para a primeira', async () => {
    setup({ recommended: 'voltar_rascunho' });
    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.value).toBe('voltar_rascunho'),
    );
  });
  it('quando as contagens chegam, o foco acompanha a recomendada', async () => {
    const { rerender } = setup({ counts: null, options: ['manter'], recommended: 'manter' });
    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.value).toBe('manter'),
    );
    rerender({
      counts: baseProps.counts,
      options: baseProps.options,
      recommended: 'voltar_rascunho',
    });
    expect(checkedValue()).toBe('voltar_rascunho');
    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement | null)?.value).toBe('voltar_rascunho'),
    );
  });
  it('a escolha do usuário sobrevive a uma recarga das contagens', () => {
    const { rerender } = setup({ recommended: 'voltar_rascunho' });
    fireEvent.click(screen.getByLabelText(/Aprovar todos/));
    rerender({ counts: null });
    rerender({ counts: { aprovado_cliente: 4, rascunho: 2 } });
    expect(checkedValue()).toBe('aprovar');
  });
  it('escolha que deixou de ser oferecida volta para a recomendada', () => {
    const { rerender, onConfirm } = setup({ recommended: 'voltar_rascunho' });
    fireEvent.click(screen.getByLabelText(/Enviar ao portal/));
    rerender({ options: ['manter', 'aprovar', 'voltar_rascunho'] });
    expect(checkedValue()).toBe('voltar_rascunho');
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(onConfirm).toHaveBeenCalledWith('voltar_rascunho');
  });
  it('reabrir volta para a recomendada', () => {
    const { rerender } = setup({ recommended: 'voltar_rascunho' });
    fireEvent.click(screen.getByLabelText(/Aprovar todos/));
    rerender({ open: false });
    rerender({ open: true });
    expect(checkedValue()).toBe('voltar_rascunho');
  });
  it('erro nas contagens mostra aviso e "Tentar de novo"', () => {
    const onRetry = vi.fn();
    setup({ counts: null, countsError: true, onRetry });
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os posts.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalExitDialog (phone)', () => {
  it('mostra os chips e o aviso de agendados/publicados', () => {
    desktop.value = false;
    setup();
    expect(screen.getByText('Aprovado pelo cliente: 5')).toBeTruthy();
    expect(screen.getByText('Posts agendados ou publicados nunca são alterados.')).toBeTruthy();
  });
  it('mostra a linha das sugestões não revisadas só quando a contagem passa de zero', () => {
    desktop.value = false;
    const { rerender } = setup();
    expect(screen.queryByText(/com sugestão do cliente não revisada/)).toBeNull();
    rerender({ pendingSuggestionCount: 2 });
    expect(screen.getByText('2 posts com sugestão do cliente não revisada.')).toBeTruthy();
  });
  it('erro nas contagens oferece "Tentar de novo"', async () => {
    desktop.value = false;
    const onRetry = vi.fn();
    setup({ counts: null, countsError: true, onRetry });
    expect(screen.getByText('Não foi possível carregar os posts.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('lista a recomendada primeiro e toque confirma', () => {
    desktop.value = false;
    const { onConfirm } = setup({ recommended: 'voltar_rascunho' });
    const first = screen
      .getAllByRole('button')
      .find((b) => /Recomendado/.test(b.textContent ?? ''));
    expect(first?.textContent).toContain('Voltar todos para rascunho (Recomendado)');
    const buttons = screen.getAllByRole('button');
    expect(buttons.indexOf(first!)).toBeLessThan(
      buttons.findIndex((b) => /Manter status atuais/.test(b.textContent ?? '')),
    );
    fireEvent.click(first!);
    return vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith('voltar_rascunho'));
  });
});
