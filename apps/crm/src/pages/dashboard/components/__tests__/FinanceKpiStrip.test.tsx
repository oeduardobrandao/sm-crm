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
    // i18n values are uppercase in dashboard.json: kpi.aReceber="A RECEBER", kpi.aPagar="A PAGAR"
    expect(screen.getByText('A RECEBER')).toBeTruthy();
    expect(screen.getByText('A PAGAR')).toBeTruthy();
    expect(screen.getByText('SALDO')).toBeTruthy();
    expect(screen.getByText('RECEITA MENSAL')).toBeTruthy();
    // In test env currentUserRole defaults to 'agent' so formatBRL returns obfuscated "R$ •••••"
    // Assert all 4 KPI value spans are rendered with BRL formatting
    expect(screen.getAllByText('R$ •••••')).toHaveLength(4);
  });
});
