import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import PeriodoSelect from '../PeriodoSelect';
import type { PeriodoFinanceiro } from '@/store/financeiroV2';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const periodo = (
  inicio: string,
  rotulo: string,
  status: PeriodoFinanceiro['status'],
): PeriodoFinanceiro => ({ inicio, fim: inicio, rotulo, status, transicao: false });

const PERIODOS = [
  periodo('2026-10-01', 'Out 2026', 'aberto'),
  periodo('2026-09-01', 'Set 2026', 'fechado'),
  periodo('2026-08-01', 'Ago 2026', 'reaberto'),
  periodo('2026-11-01', 'Nov 2026', 'futuro'),
];

describe('PeriodoSelect', () => {
  it('has an accessible name and shows the selected rotulo', () => {
    render(
      <PeriodoSelect
        value="2026-10-01"
        onChange={() => {}}
        periodos={PERIODOS}
        aria-label="Período"
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Período' })).toHaveTextContent('Out 2026');
  });

  it('marks closed and reopened periods with a badge, not the others', async () => {
    const user = userEvent.setup();
    render(
      <PeriodoSelect
        value="2026-10-01"
        onChange={() => {}}
        periodos={PERIODOS}
        aria-label="Período"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Período' }));

    expect(await screen.findByRole('option', { name: 'Set 2026 Fechado' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Ago 2026 Reaberto' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Out 2026' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Nov 2026' })).toBeVisible();
  });

  it('reports the chosen inicio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PeriodoSelect
        value="2026-10-01"
        onChange={onChange}
        periodos={PERIODOS}
        aria-label="Período"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Período' }));
    await user.click(await screen.findByRole('option', { name: 'Set 2026 Fechado' }));

    expect(onChange).toHaveBeenCalledWith('2026-09-01');
  });
});
