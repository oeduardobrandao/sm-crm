import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TargetPicker, type TargetValue } from '../TargetPicker';

const plans = [
  { id: 'free', name: 'Free' },
  { id: 'pro', name: 'Pro' },
];
const workspaces = [
  { id: 'w1', name: 'Agência A' },
  { id: 'w2', name: 'Agência B' },
  { id: 'w3', name: 'Duo Executive' },
];

function setup(value: TargetValue) {
  const onChange = vi.fn();
  render(<TargetPicker value={value} plans={plans} workspaces={workspaces} onChange={onChange} />);
  return onChange;
}

describe('TargetPicker', () => {
  it('trocar de modo limpa as seleções', () => {
    const onChange = setup({
      target_mode: 'plan',
      target_plan_ids: ['pro'],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('Por workspace'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });

  it('modo plan mostra chips de plano e alterna a seleção', () => {
    const onChange = setup({
      target_mode: 'plan',
      target_plan_ids: ['pro'],
      target_workspace_ids: [],
    });
    expect(screen.queryByText('Agência A')).toBeNull();
    fireEvent.click(screen.getByLabelText('Free'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'plan',
      target_plan_ids: ['pro', 'free'],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('Pro'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'plan',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });

  it('modo workspace mostra a lista de workspaces', () => {
    const onChange = setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
    fireEvent.click(screen.getByLabelText('Agência B'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w2'],
    });
  });

  it('a busca filtra a lista sem perder a seleção', () => {
    setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w1'],
    });
    fireEvent.change(screen.getByLabelText('Buscar workspace'), { target: { value: 'duo' } });
    expect(screen.getByLabelText('Duo Executive')).toBeTruthy();
    expect(screen.queryByLabelText('Agência B')).toBeNull();
    // O selecionado continua visível como chip mesmo fora do filtro.
    expect(screen.getByLabelText('Remover Agência A')).toBeTruthy();
  });

  it('a busca ignora acentos', () => {
    setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
    fireEvent.change(screen.getByLabelText('Buscar workspace'), { target: { value: 'agencia' } });
    expect(screen.getByLabelText('Agência A')).toBeTruthy();
    expect(screen.getByLabelText('Agência B')).toBeTruthy();
    expect(screen.queryByLabelText('Duo Executive')).toBeNull();
  });

  it('sem resultado mostra o estado vazio', () => {
    setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
    fireEvent.change(screen.getByLabelText('Buscar workspace'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum workspace encontrado')).toBeTruthy();
  });

  it('remover pelo chip e limpar desmarcam a seleção', () => {
    const onChange = setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w1', 'w2'],
    });
    expect(screen.getByText('2 selecionados')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remover Agência A'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w2'],
    });
    fireEvent.click(screen.getByText('Limpar'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });

  it('id selecionado que não está na lista ainda pode ser removido', () => {
    // Workspace apagado, ou lista truncada pelo limite da query: o chip aparece
    // mesmo assim, senão o rodapé conta uma seleção invisível e sem como tirar.
    const onChange = setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w1', 'sumiu-01-abcdef'],
    });
    expect(screen.getByText('2 selecionados')).toBeTruthy();
    const orphan = screen.getByLabelText('Remover Workspace fora da lista (sumiu-01)');
    fireEvent.click(orphan);
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['w1'],
    });
  });

  it('"Limpar" aparece mesmo quando nenhum selecionado está na lista', () => {
    const onChange = setup({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: ['sumiu-01-abcdef'],
    });
    fireEvent.click(screen.getByText('Limpar'));
    expect(onChange).toHaveBeenCalledWith({
      target_mode: 'workspace',
      target_plan_ids: [],
      target_workspace_ids: [],
    });
  });
});
