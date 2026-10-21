import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

import { ApprovalExitDialog, type ApprovalExitDialogProps } from '../ApprovalExitDialog';

const numbers = { pendentes: 3, alteraveisRascunho: 7, aprovadoInterno: 2 };
function setup(over: Partial<ApprovalExitDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <MemoryRouter>
      <ApprovalExitDialog
        open
        entityKind="fluxo"
        entityTitle="Março"
        nextEtapaName="Design"
        counts={{ aprovado_cliente: 5, enviado_cliente: 2, rascunho: 1 }}
        options={['manter', 'aprovar', 'voltar_rascunho', 'enviar_portal']}
        recommended="manter"
        numbers={numbers}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...over}
      />
    </MemoryRouter>,
  );
  return { onConfirm, onCancel };
}

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
  it('post mostra só o status atual, sem contagem', () => {
    setup({ entityKind: 'post', counts: { aprovado_cliente: 1 }, options: ['manter'] });
    expect(screen.getByText('Aprovado pelo cliente')).toBeTruthy();
  });
});

describe('ApprovalExitDialog (phone)', () => {
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
