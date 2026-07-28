import { getClientes } from './clients';
import { getTransacoes } from './finance';
import { getMembros } from './team';
import type { Transacao } from './finance';
import type { Cliente } from './clients';
import type { Membro } from './team';
import type { FinancialAccess } from '@/lib/financialAccess';

/** Projects virtual scheduled transactions for the current month from clientes/membros */
export function projetarAgendamentos(
  transacoesFisicas: Transacao[],
  clientes: Cliente[],
  membros: Membro[],
  canSeeFinancials: FinancialAccess,
): Transacao[] {
  const transacoes = [...transacoesFisicas];

  // Branch on the explicit capability, NEVER on the value. A legitimately null
  // retainer is indistinguishable from a masked one, and Number(null) is 0 —
  // inference would render phantom "R$ 0" scheduled entries.
  if (canSeeFinancials !== true) return transacoes;

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

export async function getDashboardStats(canSeeFinancials: FinancialAccess) {
  const [clientes, transacoesFisicas, membros] = await Promise.all([
    getClientes(),
    getTransacoes(),
    getMembros(),
  ]);

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const transacoes = projetarAgendamentos(transacoesFisicas, clientes, membros, canSeeFinancials);
  const transacoesMes = transacoes.filter((t) => t.data.startsWith(mesAtual));
  const clientesAtivos = clientes.filter((c) => c.status === 'ativo');

  // null, not 0: the dashboard must render a mask, not a believable R$ 0.
  const authorized = canSeeFinancials === true;
  const receitaMensal = authorized
    ? clientesAtivos.reduce((sum, c) => sum + Number(c.valor_mensal), 0)
    : null;
  const despesaTotal = authorized
    ? transacoesMes.filter((t) => t.tipo === 'saida').reduce((s, t) => s + Number(t.valor), 0)
    : null;

  return {
    clientes,
    clientesAtivos,
    receitaMensal,
    despesaTotal,
    saldo: authorized ? (receitaMensal as number) - (despesaTotal as number) : null,
    transacoes: transacoesMes,
  };
}
