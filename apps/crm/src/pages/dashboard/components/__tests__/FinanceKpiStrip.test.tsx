import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FinanceKpiStrip } from '../FinanceKpiStrip';

describe('FinanceKpiStrip', () => {
  it('renders the four KPI labels and formatted BRL values', () => {
    render(
      <FinanceKpiStrip
        aReceber={18400}
        aPagar={7100}
        saldoProjetado={11300}
        receitaMensal={24000}
      />,
    );
    // i18n values in dashboard.json: kpi.aReceber="A receber", kpi.aPagar="A pagar"
    expect(screen.getByText('A receber')).toBeTruthy();
    expect(screen.getByText('A pagar')).toBeTruthy();
    expect(screen.getByText('Saldo')).toBeTruthy();
    expect(screen.getByText('Receita mensal')).toBeTruthy();
    // In test env currentUserRole defaults to 'agent' so formatBRL returns obfuscated "R$ •••••"
    // Assert all 4 KPI value spans are rendered with BRL formatting
    expect(screen.getAllByText('R$ •••••')).toHaveLength(4);
  });
});
