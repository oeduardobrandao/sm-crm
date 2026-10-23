import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseRpc,
  __queueSupabaseResult,
} from '../../lib/__mocks__/supabase';
import {
  excluirFuncao,
  fecharPeriodo,
  getAcordoVersoes,
  getClienteVersoes,
  getEntregasManuais,
  getFinanceiroConfig,
  getFuncoes,
  getPeriodos,
  getPeriodosEditaveis,
  getRentabilidade,
  reabrirPeriodo,
  salvarAcordo,
  salvarAtribuicoes,
  salvarCliente,
  salvarConfig,
  salvarEntregas,
  salvarFuncao,
  seedFinanceiro,
  type AcordoInput,
} from '../financeiroV2';

const rpcCall = (name: string) => __getSupabaseCalls().find((c) => c.table === `rpc:${name}`);

describe('financeiroV2 reads', () => {
  beforeEach(() => __resetSupabaseMock());

  it('getRentabilidade chama financeiro_rentabilidade com p_inicio', async () => {
    __queueSupabaseRpc('financeiro_rentabilidade', { data: { seeded: false } });
    await expect(getRentabilidade('2026-10-01')).resolves.toEqual({ seeded: false });
    expect(rpcCall('financeiro_rentabilidade')?.payload).toEqual({ p_inicio: '2026-10-01' });
  });

  it('getRentabilidade sem argumento manda p_inicio null', async () => {
    __queueSupabaseRpc('financeiro_rentabilidade', { data: { seeded: false } });
    await getRentabilidade();
    expect(rpcCall('financeiro_rentabilidade')?.payload).toEqual({ p_inicio: null });
  });

  it('getRentabilidade propaga o erro', async () => {
    __queueSupabaseRpc('financeiro_rentabilidade', { error: { message: 'periodo_invalido' } });
    await expect(getRentabilidade('2020-01-01')).rejects.toMatchObject({
      message: 'periodo_invalido',
    });
  });

  it('getPeriodos e getPeriodosEditaveis chamam as RPCs de leitura', async () => {
    __queueSupabaseRpc('financeiro_periodos_listar', { data: [{ inicio: '2026-10-01' }] });
    __queueSupabaseRpc('financeiro_periodos_editaveis', { data: [] });
    await expect(getPeriodos()).resolves.toEqual([{ inicio: '2026-10-01' }]);
    await expect(getPeriodosEditaveis()).resolves.toEqual([]);
    expect(rpcCall('financeiro_periodos_listar')).toBeDefined();
    expect(rpcCall('financeiro_periodos_editaveis')).toBeDefined();
  });

  it('getPeriodos propaga o erro', async () => {
    __queueSupabaseRpc('financeiro_periodos_listar', { error: { message: 'boom' } });
    await expect(getPeriodos()).rejects.toMatchObject({ message: 'boom' });
  });

  it('getFinanceiroConfig devolve a linha ou null', async () => {
    __queueSupabaseResult('financeiro_config', 'select', { data: { periodo_dia: 5 } });
    await expect(getFinanceiroConfig()).resolves.toEqual({ periodo_dia: 5 });
    __queueSupabaseResult('financeiro_config', 'select', { data: null });
    await expect(getFinanceiroConfig()).resolves.toBeNull();
    const call = __getSupabaseCalls().find((c) => c.table === 'financeiro_config');
    expect(call?.modifiers.map((m) => m.method)).toContain('maybeSingle');
  });

  it('getFuncoes ordena por ordem', async () => {
    __queueSupabaseResult('financeiro_funcoes', 'select', {
      data: [{ id: 1, nome: 'Videomaker', ordem: 0 }],
    });
    await expect(getFuncoes()).resolves.toHaveLength(1);
    const call = __getSupabaseCalls().find((c) => c.table === 'financeiro_funcoes');
    expect(call?.modifiers).toContainEqual({
      method: 'order',
      args: ['ordem', { ascending: true }],
    });
  });

  it('getAcordoVersoes filtra o membro e ordena por vale_desde desc', async () => {
    __queueSupabaseResult('financeiro_acordo_versoes', 'select', { data: [] });
    await getAcordoVersoes(7);
    const call = __getSupabaseCalls().find((c) => c.table === 'financeiro_acordo_versoes');
    expect(call?.modifiers).toContainEqual({ method: 'eq', args: ['membro_id', 7] });
    expect(call?.modifiers).toContainEqual({
      method: 'order',
      args: ['vale_desde', { ascending: false }],
    });
  });

  it('getClienteVersoes filtra o cliente e ordena por vale_desde desc', async () => {
    __queueSupabaseResult('financeiro_cliente_versoes', 'select', { data: [] });
    await getClienteVersoes(3);
    const call = __getSupabaseCalls().find((c) => c.table === 'financeiro_cliente_versoes');
    expect(call?.modifiers).toContainEqual({ method: 'eq', args: ['cliente_id', 3] });
    expect(call?.modifiers).toContainEqual({
      method: 'order',
      args: ['vale_desde', { ascending: false }],
    });
  });

  it('getEntregasManuais filtra periodo e membro', async () => {
    __queueSupabaseResult('financeiro_entregas_manuais', 'select', {
      data: [{ cliente_id: 1, quantidade: 4 }],
    });
    await expect(getEntregasManuais('2026-10-01', 9)).resolves.toEqual([
      { cliente_id: 1, quantidade: 4 },
    ]);
    const call = __getSupabaseCalls().find((c) => c.table === 'financeiro_entregas_manuais');
    expect(call?.selectArgs).toEqual([['cliente_id, quantidade']]);
    expect(call?.modifiers).toContainEqual({
      method: 'eq',
      args: ['periodo_inicio', '2026-10-01'],
    });
    expect(call?.modifiers).toContainEqual({ method: 'eq', args: ['membro_id', 9] });
  });

  it('as leituras de tabela propagam o erro', async () => {
    __queueSupabaseResult('financeiro_funcoes', 'select', { error: { message: 'denied' } });
    await expect(getFuncoes()).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('financeiroV2 writes', () => {
  beforeEach(() => __resetSupabaseMock());

  it('seedFinanceiro chama financeiro_seed', async () => {
    __queueSupabaseRpc('financeiro_seed', { data: { seeded: true, ja_existia: false } });
    await expect(seedFinanceiro(5)).resolves.toEqual({ seeded: true, ja_existia: false });
    expect(rpcCall('financeiro_seed')?.payload).toEqual({ p_periodo_dia: 5 });
  });

  it('salvarConfig chama financeiro_config_salvar', async () => {
    await salvarConfig(1, 55);
    expect(rpcCall('financeiro_config_salvar')?.payload).toEqual({
      p_periodo_dia: 1,
      p_meta_margem: 55,
    });
  });

  it('salvarFuncao devolve o id e manda p_id null ao inserir', async () => {
    __queueSupabaseRpc('financeiro_funcao_salvar', { data: 12 });
    await expect(salvarFuncao(null, 'Copy', 4)).resolves.toBe(12);
    expect(rpcCall('financeiro_funcao_salvar')?.payload).toEqual({
      p_id: null,
      p_nome: 'Copy',
      p_ordem: 4,
    });
  });

  it('excluirFuncao chama financeiro_funcao_excluir', async () => {
    await excluirFuncao(3);
    expect(rpcCall('financeiro_funcao_excluir')?.payload).toEqual({ p_id: 3 });
  });

  it('salvarCliente chama financeiro_cliente_salvar', async () => {
    await salvarCliente(8, '2026-10-01', 1500, 10, 'ativo');
    expect(rpcCall('financeiro_cliente_salvar')?.payload).toEqual({
      p_cliente_id: 8,
      p_vale_desde: '2026-10-01',
      p_valor_mensal: 1500,
      p_dia_pagamento: 10,
      p_status: 'ativo',
    });
  });

  it('salvarAcordo manda o acordo como jsonb', async () => {
    const acordo: AcordoInput = {
      funcao_id: 1,
      modelo: 'por_entrega',
      valor: 45,
      unidade: 'arte',
      meta_quantidade: null,
      meta_periodo: null,
      limite_clientes: null,
      dia_pagamento: 5,
      vigencia_inicio: null,
      vigencia_fim: null,
      arquivo_path: null,
    };
    await salvarAcordo(2, '2026-10-01', acordo);
    expect(rpcCall('financeiro_acordo_salvar')?.payload).toEqual({
      p_membro_id: 2,
      p_vale_desde: '2026-10-01',
      p_acordo: acordo,
    });
  });

  it('salvarAtribuicoes manda as mudancas', async () => {
    const mudancas = [
      { membro_id: 1, cliente_id: 2, ativo: true },
      { membro_id: 1, cliente_id: 3, ativo: false },
    ];
    await salvarAtribuicoes('2026-10-01', mudancas);
    expect(rpcCall('financeiro_atribuicoes_salvar')?.payload).toEqual({
      p_vale_desde: '2026-10-01',
      p_mudancas: mudancas,
    });
  });

  it('salvarEntregas manda os itens (quantidade null apaga)', async () => {
    const itens = [
      { cliente_id: 1, quantidade: 10 },
      { cliente_id: 2, quantidade: null },
    ];
    await salvarEntregas('2026-10-01', 4, itens);
    expect(rpcCall('financeiro_entregas_salvar')?.payload).toEqual({
      p_inicio: '2026-10-01',
      p_membro_id: 4,
      p_itens: itens,
    });
  });

  it('reabrirPeriodo e fecharPeriodo chamam as RPCs', async () => {
    await reabrirPeriodo('2026-09-01');
    await fecharPeriodo('2026-10-01');
    expect(rpcCall('financeiro_periodo_reabrir')?.payload).toEqual({ p_inicio: '2026-09-01' });
    expect(rpcCall('financeiro_periodo_fechar')?.payload).toEqual({ p_inicio: '2026-10-01' });
  });

  it.each([
    ['seedFinanceiro', 'financeiro_seed', () => seedFinanceiro(1)],
    ['salvarConfig', 'financeiro_config_salvar', () => salvarConfig(1, 55)],
    ['salvarFuncao', 'financeiro_funcao_salvar', () => salvarFuncao(1, 'x', 0)],
    ['excluirFuncao', 'financeiro_funcao_excluir', () => excluirFuncao(1)],
    [
      'salvarCliente',
      'financeiro_cliente_salvar',
      () => salvarCliente(1, '2026-10-01', 1, null, 'ativo'),
    ],
    [
      'salvarAtribuicoes',
      'financeiro_atribuicoes_salvar',
      () => salvarAtribuicoes('2026-10-01', []),
    ],
    ['salvarEntregas', 'financeiro_entregas_salvar', () => salvarEntregas('2026-10-01', 1, [])],
    ['reabrirPeriodo', 'financeiro_periodo_reabrir', () => reabrirPeriodo('2026-10-01')],
    ['fecharPeriodo', 'financeiro_periodo_fechar', () => fecharPeriodo('2026-10-01')],
  ])('%s propaga o erro da RPC', async (_nome, rpc, run) => {
    __queueSupabaseRpc(rpc, { error: { message: 'periodo_fechado' } });
    await expect(run()).rejects.toMatchObject({ message: 'periodo_fechado' });
  });
});
