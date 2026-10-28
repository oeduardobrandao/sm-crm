import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { montarCsv } from '../rentabilidade';

const header = (csv: string) => csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0];

describe('montarCsv header in English', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('translates the fixed columns and keeps role names', async () => {
    const funcoes = [{ id: 1, nome: 'Design', ordem: 1 }];
    expect(header(montarCsv([], funcoes, false))).toBe('Cliente;MRR;Custo;Lucro;Margem;Design');
    await i18n.changeLanguage('en');
    expect(header(montarCsv([], funcoes, false))).toBe('Client;MRR;Cost;Profit;Margin;Design');
    expect(header(montarCsv([], funcoes, true))).toBe(
      'Client;ARR;Annual cost;Annual profit;Margin;Design',
    );
  });
});
