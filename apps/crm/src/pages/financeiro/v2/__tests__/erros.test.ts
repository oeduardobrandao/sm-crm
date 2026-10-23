import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { avisarErroFinanceiro, ehNaoConfigurado, mensagemErroFinanceiro } from '../erros';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('mensagemErroFinanceiro', () => {
  it.each([
    ['periodo_fechado', 'Este período está fechado. Escolha outro em Vale a partir de.'],
    ['cliente_encerrado', 'Este cliente está encerrado neste período.'],
    ['sem_atribuicao', 'Atribua a pessoa ao cliente antes de informar entregas.'],
    ['nao_configurado', 'O financeiro ainda não foi montado.'],
    ['periodo_invalido', 'Esse período não existe mais. Escolha outro.'],
    ['financial_access_denied', 'Você não tem permissão para alterar o financeiro.'],
    ['funcao_duplicada', 'Já existe uma função com esse nome.'],
  ])('maps %s', (token, copy) => {
    expect(mensagemErroFinanceiro(pg(token))).toBe(copy);
  });

  it('matches the token inside a longer message', () => {
    expect(mensagemErroFinanceiro(pg('ERROR: periodo_fechado: 2026-09-01'))).toBe(
      'Este período está fechado. Escolha outro em Vale a partir de.',
    );
  });

  it('maps not_found by message or by P0002', () => {
    const copy = 'Não encontramos esse registro. Atualize a página.';
    expect(mensagemErroFinanceiro(pg('not_found', 'P0002'))).toBe(copy);
    expect(mensagemErroFinanceiro(pg('no data', 'P0002'))).toBe(copy);
    expect(mensagemErroFinanceiro(pg('not_found'))).toBe(copy);
  });

  it('matches whole tokens only', () => {
    expect(mensagemErroFinanceiro(pg('membro_not_found'))).toBeNull();
    expect(mensagemErroFinanceiro(pg('not_found_x'))).toBeNull();
    expect(mensagemErroFinanceiro(pg('xperiodo_fechado'))).toBeNull();
  });

  it('returns null for anything else', () => {
    expect(mensagemErroFinanceiro(pg('boom', 'XX000'))).toBeNull();
    expect(mensagemErroFinanceiro(new Error('network down'))).toBeNull();
    expect(mensagemErroFinanceiro(null)).toBeNull();
    expect(mensagemErroFinanceiro('periodo_fechado')).toBeNull();
    expect(mensagemErroFinanceiro({})).toBeNull();
  });
});

describe('ehNaoConfigurado', () => {
  it('is true only for nao_configurado', () => {
    expect(ehNaoConfigurado(pg('nao_configurado'))).toBe(true);
    expect(ehNaoConfigurado(pg('periodo_fechado'))).toBe(false);
    expect(ehNaoConfigurado(undefined)).toBe(false);
  });
});

describe('avisarErroFinanceiro', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toasts the mapped copy and refreshes the layout on nao_configurado', () => {
    const qc = { invalidateQueries: vi.fn() };
    avisarErroFinanceiro(pg('nao_configurado'), 'Erro genérico', qc as never);
    expect(toast.error).toHaveBeenCalledWith('O financeiro ainda não foi montado.');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] });
  });

  it('falls back to the caller copy without touching the cache', () => {
    const qc = { invalidateQueries: vi.fn() };
    avisarErroFinanceiro(new Error('x'), 'Erro genérico', qc as never);
    expect(toast.error).toHaveBeenCalledWith('Erro genérico');
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });
});
