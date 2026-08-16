import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ptClients from '../../../../../../packages/i18n/locales/pt/clients.json';
import enClients from '../../../../../../packages/i18n/locales/en/clients.json';

const css = readFileSync('apps/crm/style.css', 'utf8');

/**
 * These two checks are pure CSS/i18n contracts with no dependency on which
 * component renders the finance markup, so they survived the cliente-detalhe
 * tab-shell restructuring untouched — see git history for this file's other
 * tests, which asserted on ClienteDetalhePage.tsx's source directly and
 * belong with whichever task rebuilds Financeiro's content (FinanceiroTab).
 */
describe('client finance responsive contracts', () => {
  it('keeps finance empty-state actions at least 44px tall', () => {
    expect(css).toMatch(/\.cliente-finance-empty__action\s*\{[^}]*min-height:\s*44px/s);
  });

  it('provides equivalent Portuguese and English empty-state copy', () => {
    expect(ptClients.detail).toMatchObject({
      noContracts: 'Nenhum contrato cadastrado',
      noContractsDescription: 'Os contratos vinculados a este cliente aparecerão aqui.',
      manageContracts: 'Gerenciar contratos',
      noTransactions: 'Nenhuma transação registrada',
      noTransactionsDescription: 'Os lançamentos financeiros deste cliente aparecerão aqui.',
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
