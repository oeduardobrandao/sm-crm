import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { TrialPlanPicker } from '../TrialPlanPicker';
import { catalog } from './plan-fixtures';

const now = new Date('2026-10-27T12:00:00-03:00');

function renderPicker(overrides: Partial<Parameters<typeof TrialPlanPicker>[0]> = {}) {
  const props = {
    plans: catalog,
    busyPlanId: null,
    now,
    onStart: vi.fn(),
    onSkip: vi.fn(),
    onShowAllPlans: vi.fn(),
    onRecommended: vi.fn(),
    ...overrides,
  };
  const result = render(<TrialPlanPicker {...props} />);
  return { ...result, props };
}

const clientsGroup = () =>
  screen.getByRole('group', { name: 'Quantos clientes você atende hoje?' });
const teamGroup = () =>
  screen.getByRole('group', { name: 'Quantas pessoas trabalham com você, contando você?' });

function answer(clients: string, team: string) {
  fireEvent.click(within(clientsGroup()).getByRole('button', { name: clients }));
  fireEvent.click(within(teamGroup()).getByRole('button', { name: team }));
}

describe('TrialPlanPicker', () => {
  it('shows the most chosen plan (Pro) before any answer, with nothing preselected', () => {
    renderPicker();
    expect(screen.getByText('O mais escolhido')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    for (const chip of [
      ...within(clientsGroup()).getAllByRole('button'),
      ...within(teamGroup()).getAllByRole('button'),
    ]) {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('recommends Start with the Free note for 1 a 2 clients and só eu', () => {
    const { props } = renderPicker();
    answer('1 a 2', 'Só eu');

    expect(screen.getByText('Recomendado para você')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(
      screen.getByText(
        'O Free também cobre 2 clientes, mas sem portal de aprovação, relatórios e métricas automáticas. Teste o Start e decida depois.',
      ),
    ).toBeInTheDocument();
    expect(props.onRecommended).toHaveBeenCalledWith({
      clients: '1-2',
      team: '1',
      planId: 'start',
    });
    expect(within(clientsGroup()).getByRole('button', { name: '1 a 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(teamGroup()).getByRole('button', { name: 'Só eu' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not fire onRecommended until both answers are set, then again on each change', () => {
    const { props } = renderPicker();
    fireEvent.click(within(clientsGroup()).getByRole('button', { name: '6 a 15' }));
    expect(props.onRecommended).not.toHaveBeenCalled();

    fireEvent.click(within(teamGroup()).getByRole('button', { name: '3 a 5' }));
    expect(props.onRecommended).toHaveBeenCalledTimes(1);

    // Re-clicking the pressed chip is not a change.
    fireEvent.click(within(teamGroup()).getByRole('button', { name: '3 a 5' }));
    expect(props.onRecommended).toHaveBeenCalledTimes(1);

    fireEvent.click(within(clientsGroup()).getByRole('button', { name: 'Mais de 15' }));
    expect(props.onRecommended).toHaveBeenCalledTimes(2);
    expect(props.onRecommended).toHaveBeenLastCalledWith({
      clients: '16+',
      team: '3-5',
      planId: 'max',
    });
  });

  it('explains the recommendation', () => {
    renderPicker();
    answer('6 a 15', '3 a 5');
    expect(
      screen.getByText('Pensado para quem atende 6 a 15 clientes com uma equipe de 3 a 5.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/O Free também cobre/)).not.toBeInTheDocument();
  });

  it('shows the plan limits as badges', () => {
    renderPicker();
    expect(screen.getByText('Até 15 clientes')).toBeInTheDocument();
    expect(screen.getByText('Até 5 usuários')).toBeInTheDocument();
    answer('Mais de 15', '6 ou mais');
    expect(screen.getByText('Clientes ilimitados')).toBeInTheDocument();
    expect(screen.getByText('Usuários ilimitados')).toBeInTheDocument();
  });

  it('starts the trial of the shown plan', () => {
    const { props } = renderPicker();
    const cta = screen.getByRole('button', { name: 'Começar 30 dias grátis do Pro' });
    fireEvent.click(cta);
    expect(props.onStart).toHaveBeenCalledWith('pro', 'pro');
  });

  it('disables the primary button while that plan is busy', () => {
    renderPicker({ busyPlanId: 'pro' });
    expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeDisabled();
  });

  it('states the approximate first charge and the reminder', () => {
    renderPicker();
    expect(screen.getByText(/por volta de 26 de novembro/)).toBeInTheDocument();
    expect(screen.getByText(/Avisamos por e-mail 7 dias antes/)).toBeInTheDocument();
    expect(
      screen.getByText(
        (_c, node) =>
          node?.tagName === 'P' &&
          (node.textContent ?? '')
            .replace(/\s+/g, ' ')
            .startsWith(
              'R$ 0 hoje. Primeira cobrança de R$ 139,90/mês por volta de 26 de novembro',
            ),
      ),
    ).toBeInTheDocument();
  });

  it('keeps Free one click away and opens the full plan list', () => {
    const { props } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no Free' }));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('2 clientes, só você, sem portal de aprovação nem relatórios.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os planos' }));
    expect(props.onShowAllPlans).toHaveBeenCalledTimes(1);
  });

  it('renders no em dash', () => {
    const { container } = renderPicker();
    answer('1 a 2', 'Só eu');
    expect(container.textContent).not.toContain('—');
  });
});
