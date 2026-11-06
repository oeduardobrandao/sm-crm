import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { avisarErroFinanceiro, mensagemErroFinanceiro } from '../erros';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('mensagemErroFinanceiro in English', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it.each([
    ['periodo_fechado', 'This period is closed. Pick another one in Applies from.'],
    ['cliente_encerrado', 'This client is closed in this period.'],
    ['sem_atribuicao', 'Assign the person to the client before entering deliverables.'],
    ['nao_configurado', 'Finance has not been set up yet.'],
    ['periodo_invalido', 'This period no longer exists. Pick another one.'],
    ['not_found', "We couldn't find this record. Refresh the page."],
    ['financial_access_denied', "You don't have permission to change finance."],
    ['funcao_duplicada', 'A role with this name already exists.'],
  ])('maps %s', async (token, copy) => {
    await i18n.changeLanguage('en');
    expect(mensagemErroFinanceiro(pg(token))).toBe(copy);
  });

  it('maps P0002 to not_found', async () => {
    await i18n.changeLanguage('en');
    expect(mensagemErroFinanceiro(pg('no data', 'P0002'))).toBe(
      "We couldn't find this record. Refresh the page.",
    );
  });

  it('avisarErroFinanceiro toasts the English copy', async () => {
    await i18n.changeLanguage('en');
    avisarErroFinanceiro(pg('periodo_fechado'), 'fallback', { invalidateQueries: vi.fn() });
    expect(toast.error).toHaveBeenCalledWith(
      'This period is closed. Pick another one in Applies from.',
    );
  });
});
