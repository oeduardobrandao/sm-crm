import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ptClients from '../../../../../../packages/i18n/locales/pt/clients.json';
import enClients from '../../../../../../packages/i18n/locales/en/clients.json';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx',
  'utf8',
);

describe('client finance responsive contracts', () => {
  it('keeps all three finance KPIs in equal shrinkable columns on phones', () => {
    expect(source).toContain('className="kpi-grid cliente-finance-kpis"');
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*\.cliente-finance-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*auto[^}]*max-width:\s*none/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis \.kpi-value\s*\{[^}]*white-space:\s*nowrap/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis \.kpi-value\s*\{[^}]*display:\s*block[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto[^}]*scrollbar-width:\s*none/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis \.kpi-value::-webkit-scrollbar\s*\{[^}]*display:\s*none/s,
    );
  });

  it('uses dedicated empty states instead of empty table rows', () => {
    expect(source).toContain('<ClienteFinanceEmptyState');
    expect(source).toContain('actionHref="/contratos"');
    expect(source).toContain('actionHref="/financeiro"');
    expect(source).not.toMatch(/<TableCell[^>]*colSpan=\{4\}[\s\S]*detail\.noContracts/s);
    expect(source).not.toMatch(/<TableCell[^>]*colSpan=\{4\}[\s\S]*detail\.noTransactions/s);
  });

  it('provides equivalent Portuguese and English empty-state copy', () => {
    expect(ptClients.detail).toMatchObject({
      noContracts: 'Nenhum contrato cadastrado',
      noContractsDescription: 'Os contratos vinculados a este cliente aparecerão aqui.',
      manageContracts: 'Gerenciar contratos',
      noTransactions: 'Nenhuma transação registrada',
      noTransactionsDescription:
        'Os lançamentos financeiros deste cliente aparecerão aqui.',
      viewFinancial: 'Ver financeiro',
    });
    expect(enClients.detail).toMatchObject({
      noContracts: 'No contracts registered',
      noContractsDescription: 'Contracts linked to this client will appear here.',
      manageContracts: 'Manage contracts',
      noTransactions: 'No transactions recorded',
      noTransactionsDescription: 'Financial entries for this client will appear here.',
      viewFinancial: 'View finances',
    });
  });
});
