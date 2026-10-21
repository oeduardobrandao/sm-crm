import { describe, expect, it } from 'vitest';
import type { Cliente, ClienteData, Membro, Transacao } from '../../../../store';
import {
  expandirDatasClientes,
  expandirPagamentos,
  expandirRecebimentos,
  mesesDoIntervalo,
} from '../recorrencias';

function cliente(over: Partial<Cliente>): Cliente {
  return {
    id: 1,
    nome: 'Clínica Sorriso',
    sigla: 'CS',
    cor: '#f00',
    plano: 'pro',
    email: '',
    telefone: '',
    status: 'ativo',
    valor_mensal: 1500,
    ...over,
  };
}

function membro(over: Partial<Membro>): Membro {
  return {
    id: 7,
    nome: 'Bruno',
    cargo: 'Designer',
    tipo: 'clt',
    custo_mensal: 3000,
    avatar_url: '',
    ...over,
  };
}

const FEV = [new Date(2026, 1, 1), new Date(2026, 2, 1)] as const;

describe('mesesDoIntervalo', () => {
  it('lists every month touched by a half-open range', () => {
    expect(mesesDoIntervalo(new Date(2026, 10, 30), new Date(2027, 0, 11))).toEqual([
      { ano: 2026, mes0: 10 },
      { ano: 2026, mes0: 11 },
      { ano: 2027, mes0: 0 },
    ]);
    // The exclusive end on the 1st does not pull in that month.
    expect(mesesDoIntervalo(...FEV)).toEqual([{ ano: 2026, mes0: 1 }]);
  });
});

describe('expandirRecebimentos', () => {
  it('day 31 in February falls on the 28th, flagged as adjusted', () => {
    const itens = expandirRecebimentos([cliente({ data_pagamento: 31 })], [], ...FEV);
    expect(itens).toEqual([
      {
        camada: 'recebimentos',
        id: 'recebimentos:2026-02-28',
        dia: '2026-02-28',
        itens: [
          {
            nome: 'Clínica Sorriso',
            valor: 1500,
            pago: false,
            referencia: 'cliente_1_2026_02',
            alvo: { tipo: 'cliente', id: 1 },
            ajustado: true,
            diaConfigurado: 31,
          },
        ],
      },
    ]);
  });

  it('excludes inactive clients and clients without a payment day', () => {
    const itens = expandirRecebimentos(
      [
        cliente({ id: 1, data_pagamento: 10, status: 'pausado' }),
        cliente({ id: 2, data_pagamento: 10, status: 'encerrado' }),
        cliente({ id: 3, data_pagamento: undefined }),
      ],
      [],
      ...FEV,
    );
    expect(itens).toEqual([]);
  });

  it('aggregates a day and marks what a transaction already paid', () => {
    const pago: Transacao = {
      data: '2026-02-10',
      descricao: 'A',
      detalhe: '',
      categoria: '',
      tipo: 'entrada',
      valor: 100,
      referencia_agendamento: 'cliente_2_2026_02',
    };
    const itens = expandirRecebimentos(
      [
        cliente({ id: 1, nome: 'A', data_pagamento: 10 }),
        cliente({ id: 2, nome: 'B', data_pagamento: 10 }),
      ],
      [pago],
      ...FEV,
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      dia: '2026-02-10',
      itens: [
        { nome: 'A', pago: false, ajustado: false },
        { nome: 'B', pago: true, referencia: 'cliente_2_2026_02' },
      ],
    });
  });

  it('a range spanning two months yields both, each with its own reference', () => {
    const itens = expandirRecebimentos(
      [cliente({ data_pagamento: 5 })],
      [],
      new Date(2026, 0, 26),
      new Date(2026, 2, 9),
    );
    expect(itens.map((i) => i.id)).toEqual(['recebimentos:2026-02-05', 'recebimentos:2026-03-05']);
    expect(itens.map((i) => (i.camada === 'recebimentos' ? i.itens[0].referencia : ''))).toEqual([
      'cliente_1_2026_02',
      'cliente_1_2026_03',
    ]);
  });
});

describe('expandirPagamentos', () => {
  it('uses custo_mensal (0 when null) and the membro reference', () => {
    const itens = expandirPagamentos(
      [membro({ data_pagamento: 5, custo_mensal: null })],
      [],
      ...FEV,
    );
    expect(itens).toEqual([
      {
        camada: 'pagamentos',
        id: 'pagamentos:2026-02-05',
        dia: '2026-02-05',
        itens: [
          {
            nome: 'Bruno',
            valor: 0,
            pago: false,
            referencia: 'membro_7_2026_02',
            alvo: { tipo: 'membro', id: 7 },
            ajustado: false,
            diaConfigurado: 5,
          },
        ],
      },
    ]);
  });
});

describe('expandirDatasClientes', () => {
  it('a 02-29 birthday falls on 02-28 in a common year', () => {
    const itens = expandirDatasClientes(
      [cliente({ id: 4, nome: 'Ana', data_aniversario: '02-29' })],
      [],
      ...FEV,
    );
    expect(itens).toEqual([
      {
        camada: 'datas',
        id: 'datas:aniversario:4:2026-02-28',
        dia: '2026-02-28',
        tipo: 'aniversario',
        titulo: 'Aniversário',
        cliente: { id: 4, nome: 'Ana' },
      },
    ]);
  });

  it('repeats birthdays every year of the range and lists important dates', () => {
    const datas: ClienteData[] = [
      { id: 9, cliente_id: 4, titulo: 'Inauguração', data: '2027-01-03' },
      { id: 10, cliente_id: 4, titulo: 'Fora', data: '2027-03-03' },
    ];
    const itens = expandirDatasClientes(
      [cliente({ id: 4, nome: 'Ana', data_aniversario: '12-30' })],
      datas,
      new Date(2026, 11, 1),
      new Date(2027, 1, 1),
    );
    expect(itens.map((i) => (i.camada === 'datas' ? `${i.dia} ${i.titulo}` : ''))).toEqual([
      '2026-12-30 Aniversário',
      '2027-01-03 Inauguração',
    ]);
  });
});
