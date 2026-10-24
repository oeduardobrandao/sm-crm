import { getClientes } from './clients';
import { getRecorrentes, getTransacoes, referenciaRecorrente } from './finance';
import { getMembros } from './team';
import type { Transacao, TransacaoRecorrente } from './finance';
import type { Cliente } from './clients';
import type { Membro } from './team';
import type { FinancialAccess } from '@/lib/financialAccess';

/** Projects virtual scheduled transactions for the current month from clientes/membros/recorrentes */
export function projetarAgendamentos(
  transacoesFisicas: Transacao[],
  clientes: Cliente[],
  membros: Membro[],
  canSeeFinancials: FinancialAccess,
  recorrentes: TransacaoRecorrente[] = [],
): Transacao[] {
  const transacoes = [...transacoesFisicas];

  // Branch on the explicit capability, NEVER on the value. A legitimately null
  // retainer is indistinguishable from a masked one, and Number(null) is 0 —
  // inference would render phantom "R$ 0" scheduled entries.
  if (canSeeFinancials !== true) return transacoes;

  const now = new Date();
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const ano = now.getFullYear();
  // Payment days 29-31 fall on the last day of shorter months (no "2026-02-31").
  const ultimoDia = new Date(ano, now.getMonth() + 1, 0).getDate();

  const addAgendamento = (
    idRef: string,
    dia: number,
    valor: number,
    desc: string,
    tipo: 'entrada' | 'saida',
    detalhe = 'Agendamento automático',
    categoria = 'Agendamento',
  ) => {
    if (!transacoesFisicas.some((t) => t.referencia_agendamento === idRef)) {
      transacoes.push({
        id: Date.now() + Math.random(),
        tipo,
        valor,
        descricao: desc,
        detalhe,
        categoria,
        data: `${ano}-${mes}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`,
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

  // inicio/fim are always the 1st, so comparing to this month's 1st as text works.
  const primeiroDoMes = `${ano}-${mes}-01`;
  recorrentes
    .filter((r) => r.id != null && r.inicio <= primeiroDoMes && (!r.fim || r.fim >= primeiroDoMes))
    .forEach((r) => {
      addAgendamento(
        referenciaRecorrente(r.id!, ano, now.getMonth() + 1),
        r.dia,
        Number(r.valor),
        r.descricao,
        r.tipo,
        'Recorrente',
        r.categoria,
      );
    });

  return transacoes;
}

export async function getDashboardStats(canSeeFinancials: FinancialAccess) {
  // Skip the transactions fetch entirely when the caller lacks the capability.
  // Before Migration B lands, RLS still returns real rows here — the UI masks
  // aReceber/aPagar behind `canSeeFinancials === true` (DashboardPage.tsx),
  // but the raw transacoes would otherwise sit in the network response and
  // the React Query cache, readable in devtools, in the window between the
  // client deploy and that migration.
  const [clientes, transacoesFisicas, membros, recorrentes] = await Promise.all([
    getClientes(),
    canSeeFinancials === true ? getTransacoes() : Promise.resolve([]),
    getMembros(),
    // The dashboard must not go down with this table (e.g. before its migration lands).
    canSeeFinancials === true ? getRecorrentes().catch(() => []) : Promise.resolve([]),
  ]);

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const transacoes = projetarAgendamentos(
    transacoesFisicas,
    clientes,
    membros,
    canSeeFinancials,
    recorrentes,
  );
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
