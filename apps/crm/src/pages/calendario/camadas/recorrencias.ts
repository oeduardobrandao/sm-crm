import { format } from 'date-fns';
import type { Cliente, ClienteData, Membro, Transacao } from '../../../store';
import type { CamadaItem, CamadaPagamento } from './tipos';

/** Local `yyyy-MM-dd`. */
export const diaLocal = (d: Date) => format(d, 'yyyy-MM-dd');

const pad2 = (n: number) => String(n).padStart(2, '0');
const diasNoMes = (ano: number, mes0: number) => new Date(ano, mes0 + 1, 0).getDate();

/** Every (year, month0) touched by [inicio, fim). `fim` is exclusive. */
export function mesesDoIntervalo(inicio: Date, fim: Date): { ano: number; mes0: number }[] {
  const meses: { ano: number; mes0: number }[] = [];
  const ultimo = new Date(fim.getTime() - 1);
  let ano = inicio.getFullYear();
  let mes0 = inicio.getMonth();
  while (
    ano < ultimo.getFullYear() ||
    (ano === ultimo.getFullYear() && mes0 <= ultimo.getMonth())
  ) {
    meses.push({ ano, mes0 });
    mes0 += 1;
    if (mes0 === 12) {
      mes0 = 0;
      ano += 1;
    }
  }
  return meses;
}

const dentro = (d: Date, inicio: Date, fim: Date) => d >= inicio && d < fim;

/** `referencia_agendamento` the "Calendário" tab writes when confirming. */
export const referenciaPagamento = (
  tipo: 'cliente' | 'membro',
  id: number,
  ano: number,
  mes0: number,
) => `${tipo}_${id}_${ano}_${pad2(mes0 + 1)}`;

interface Recorrente {
  id: number;
  nome: string;
  valor: number;
  dia: number;
}

function expandirMensais(
  camada: 'recebimentos' | 'pagamentos',
  alvo: 'cliente' | 'membro',
  recorrentes: Recorrente[],
  transacoes: Transacao[],
  inicio: Date,
  fim: Date,
): CamadaItem[] {
  const pagos = new Set(
    transacoes.map((t) => t.referencia_agendamento).filter((r): r is string => !!r),
  );
  const porDia = new Map<string, CamadaPagamento[]>();
  for (const { ano, mes0 } of mesesDoIntervalo(inicio, fim)) {
    const total = diasNoMes(ano, mes0);
    for (const r of recorrentes) {
      const dia = Math.min(r.dia, total);
      const data = new Date(ano, mes0, dia);
      if (!dentro(data, inicio, fim)) continue;
      const referencia = referenciaPagamento(alvo, r.id, ano, mes0);
      const chave = diaLocal(data);
      const lista = porDia.get(chave) ?? [];
      lista.push({
        nome: r.nome,
        valor: r.valor,
        pago: pagos.has(referencia),
        referencia,
        alvo: { tipo: alvo, id: r.id },
        ajustado: r.dia > total,
        diaConfigurado: r.dia,
      });
      porDia.set(chave, lista);
    }
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, itens]) => ({ camada, id: `${camada}:${dia}`, dia, itens }));
}

const diaValido = (d: number | null | undefined): d is number =>
  typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31;

/** Monthly client receivables (`data_pagamento`), active clients only, aggregated per day. */
export function expandirRecebimentos(
  clientes: Cliente[],
  transacoes: Transacao[],
  inicio: Date,
  fim: Date,
): CamadaItem[] {
  const recorrentes = clientes
    .filter((c) => c.status === 'ativo' && c.id != null && diaValido(c.data_pagamento))
    .map((c) => ({ id: c.id!, nome: c.nome, valor: c.valor_mensal, dia: c.data_pagamento! }));
  return expandirMensais('recebimentos', 'cliente', recorrentes, transacoes, inicio, fim);
}

/** Monthly team payments (`data_pagamento`), aggregated per day. */
export function expandirPagamentos(
  membros: Membro[],
  transacoes: Transacao[],
  inicio: Date,
  fim: Date,
): CamadaItem[] {
  const recorrentes = membros
    .filter((m) => m.id != null && diaValido(m.data_pagamento))
    .map((m) => ({ id: m.id!, nome: m.nome, valor: m.custo_mensal || 0, dia: m.data_pagamento! }));
  return expandirMensais('pagamentos', 'membro', recorrentes, transacoes, inicio, fim);
}

/**
 * Client birthdays (`data_aniversario` "MM-DD", every year of the range; 02-29
 * falls on 02-28 in common years) and important dates (`cliente_datas`). Like the
 * "Calendário" tab, birthdays are not filtered by client status.
 */
export function expandirDatasClientes(
  clientes: Cliente[],
  datas: ClienteData[],
  inicio: Date,
  fim: Date,
): CamadaItem[] {
  const itens: CamadaItem[] = [];
  const anos = [...new Set(mesesDoIntervalo(inicio, fim).map((m) => m.ano))];
  for (const c of clientes) {
    if (c.id == null || !c.data_aniversario) continue;
    const [mm, dd] = c.data_aniversario.split('-').map(Number);
    if (!mm || !dd || mm < 1 || mm > 12) continue;
    for (const ano of anos) {
      const data = new Date(ano, mm - 1, Math.min(dd, diasNoMes(ano, mm - 1)));
      if (!dentro(data, inicio, fim)) continue;
      const dia = diaLocal(data);
      itens.push({
        camada: 'datas',
        id: `datas:aniversario:${c.id}:${dia}`,
        dia,
        tipo: 'aniversario',
        titulo: 'Aniversário',
        cliente: { id: c.id, nome: c.nome },
      });
    }
  }
  const nomes = new Map(clientes.map((c) => [c.id, c.nome]));
  for (const d of datas) {
    const data = new Date(`${d.data}T00:00:00`);
    if (isNaN(data.getTime()) || !dentro(data, inicio, fim)) continue;
    itens.push({
      camada: 'datas',
      id: `datas:data:${d.id ?? `${d.cliente_id}-${d.data}`}`,
      dia: diaLocal(data),
      tipo: 'data',
      titulo: d.titulo,
      cliente: { id: d.cliente_id, nome: nomes.get(d.cliente_id) ?? '' },
    });
  }
  return itens.sort((a, b) => ('dia' in a && 'dia' in b ? a.dia.localeCompare(b.dia) : 0));
}
