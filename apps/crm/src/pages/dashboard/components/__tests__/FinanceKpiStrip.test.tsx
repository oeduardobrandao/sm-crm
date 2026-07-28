import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FinanceKpiStrip } from '../FinanceKpiStrip';

describe('FinanceKpiStrip', () => {
  it('renders the four KPI labels and real BRL values when authorized', () => {
    render(
      <FinanceKpiStrip
        aReceber={18400}
        aPagar={7100}
        saldoProjetado={11300}
        receitaMensal={24000}
        canSeeFinancials={true}
      />,
    );
    // i18n values in dashboard.json: kpi.aReceber="A receber", kpi.aPagar="A pagar"
    expect(screen.getByText('A receber')).toBeTruthy();
    expect(screen.getByText('A pagar')).toBeTruthy();
    expect(screen.getByText('Saldo')).toBeTruthy();
    expect(screen.getByText('Receita mensal')).toBeTruthy();
    expect(screen.getByText('R$ 18.400,00')).toBeTruthy();
    expect(screen.getByText('R$ 7.100,00')).toBeTruthy();
    expect(screen.getByText('R$ 11.300,00')).toBeTruthy();
    expect(screen.getByText('R$ 24.000,00')).toBeTruthy();
    expect(screen.queryByText('R$ •••••')).not.toBeInTheDocument();
  });

  it('masks all four KPI values when the capability is denied', () => {
    render(
      <FinanceKpiStrip
        aReceber={18400}
        aPagar={7100}
        saldoProjetado={11300}
        receitaMensal={24000}
        canSeeFinancials={false}
      />,
    );
    expect(screen.getAllByText('R$ •••••')).toHaveLength(4);
  });

  it('masks rather than showing R$ 0,00 when the aggregates resolve to null', () => {
    render(
      <FinanceKpiStrip
        aReceber={0}
        aPagar={0}
        saldoProjetado={null}
        receitaMensal={null}
        canSeeFinancials={false}
      />,
    );
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
    expect(screen.getAllByText('R$ •••••')).toHaveLength(4);
  });
});
