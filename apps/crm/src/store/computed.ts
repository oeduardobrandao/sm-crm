import { getClientes } from './clients';
import { getTransacoes } from './finance';
import { getMembros } from './team';
import type { Transacao } from './finance';
import type { Cliente } from './clients';
import type { Membro } from './team';

/** Projects virtual scheduled transactions for the current month from clientes/membros */
export function projetarAgendamentos(
  transacoesFisicas: Transacao[],
  clientes: Cliente[],
  membros: Membro[],
): Transacao[] {
  const transacoes = [...transacoesFisicas];
  const now = new Date();
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const ano = now.getFullYear();

  const addAgendamento = (
    idRef: string,
    dia: number,
    valor: number,
    desc: string,
    tipo: 'entrada' | 'saida',
  ) => {
    if (!transacoesFisicas.some((t) => t.referencia_agendamento === idRef)) {
      transacoes.push({
        id: Date.now() + Math.random(),
        tipo,
        valor,
        descricao: desc,
        detalhe: 'Agendamento automático',
        categoria: 'Agendamento',
        data: `${ano}-${mes}-${String(dia).padStart(2, '0')}`,
        status: 'agendado',
        referencia_agendamento: idRef,
      } as Transacao);
    }
  };

  clientes
    .filter((c) => c.status === 'ativo' && c.data_pagamento)
    .forEach((c) => {
      addAgendamento(
        `cliente_${c.id}_${ano}_${mes}`,
        c.data_pagamento!,
        Number(c.valor_mensal),
        c.nome,
        'entrada',
      );
    });

  membros
    .filter((m) => m.data_pagamento)
    .forEach((m) => {
      addAgendamento(
        `membro_${m.id}_${ano}_${mes}`,
        m.data_pagamento!,
        Number(m.custo_mensal),
        m.nome,
        'saida',
      );
    });

  return transacoes;
}

export async function getDashboardStats() {
  const [clientes, transacoesFisicas, membros] = await Promise.all([
    getClientes(),
    getTransacoes(),
    getMembros(),
  ]);

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const transacoes = projetarAgendamentos(transacoesFisicas, clientes, membros);
  const transacoesMes = transacoes.filter((t) => t.data.startsWith(mesAtual));

  const clientesAtivos = clientes.filter((c) => c.status === 'ativo');
  const receitaMensal = clientesAtivos.reduce((sum, c) => sum + Number(c.valor_mensal), 0);
  const despesas = transacoesMes.filter((t) => t.tipo === 'saida');
  const despesaTotal = despesas.reduce((sum, t) => sum + Number(t.valor), 0);

  return {
    clientes,
    clientesAtivos,
    receitaMensal,
    despesaTotal,
    saldo: receitaMensal - despesaTotal,
    transacoes: transacoesMes,
  };
}
