import type {
  ClienteRentabilidade,
  FuncaoFinanceira,
  MembroRentabilidade,
  PessoaRentabilidade,
  RentabilidadeSeeded,
} from '@/store/financeiroV2';

// The spreadsheet scenario of the Financeiro v2 plan (out 2026, 15 clients, 5
// members): exactly what Task 4's SQL fixture produces. Treat as read-only; clone
// with structuredClone to build variants.

const funcoes: FuncaoFinanceira[] = [
  { id: 1, nome: 'Videomaker', ordem: 0 },
  { id: 2, nome: 'Design', ordem: 1 },
  { id: 3, nome: 'Edição de vídeo', ordem: 2 },
  { id: 4, nome: 'Gestão de projetos', ordem: 3 },
  { id: 5, nome: 'Copy', ordem: 4 },
];

const receitas: Array<[id: number, nome: string, receita: number]> = [
  [1, 'Cinara', 2000],
  [2, 'Roberta', 2000],
  [3, 'Tyciana', 1500],
  [4, 'Gabriel', 2100],
  [5, 'Maria Paula', 2000],
  [6, 'Yasmin', 2000],
  [7, 'Vanessa', 2200],
  [8, 'Crícia', 1500],
  [9, 'Talitha', 2500],
  [10, 'Matheus', 2000],
  [11, 'Beatriz', 2000],
  [12, 'Marina', 2000],
  [13, 'Richelle', 2200],
  [14, 'Deborah', 2300],
  [15, 'Larissa', 2300],
];

const TALITHA = 9;

const membros: MembroRentabilidade[] = [
  membro(1, 'Caio', 1, 'mensal_meta', 2310, 14, null, 165),
  membro(2, 'Lia', 1, 'mensal_meta', 550, 1, null, 550),
  membro(3, 'Ana', 2, 'mensal_meta', 3900, 15, null, 260),
  membro(4, 'Bruno', 3, 'mensal_meta', 3150, 15, null, 210),
  membro(5, 'Duda', 4, 'mensal_limite', 2400, 15, 20, 160),
];

function membro(
  membro_id: number,
  nome: string,
  funcao_id: number,
  modelo: MembroRentabilidade['modelo'],
  custo: number,
  n_clientes: number,
  limite_clientes: number | null,
  por_cliente: number,
): MembroRentabilidade {
  return {
    membro_id,
    nome,
    funcao_id,
    modelo,
    custo,
    n_clientes,
    limite_clientes,
    por_cliente,
    a_informar: false,
  };
}

function rateio(m: MembroRentabilidade): PessoaRentabilidade {
  return {
    membro_id: m.membro_id,
    nome: m.nome,
    funcao_id: m.funcao_id,
    regra: 'rateio',
    valor: m.por_cliente ?? 0,
    total: m.custo,
    n_clientes: m.n_clientes,
    quantidade: null,
    valor_unitario: null,
  };
}

const [caio, lia, ana, bruno, duda] = membros;

function cliente(id: number, nome: string, receita: number): ClienteRentabilidade {
  const talitha = id === TALITHA;
  const pessoas: PessoaRentabilidade[] = talitha
    ? [{ ...rateio(lia), regra: 'exclusivo' }, rateio(ana), rateio(bruno), rateio(duda)]
    : [rateio(caio), rateio(ana), rateio(bruno), rateio(duda)];
  const por_funcao: Record<string, number> = {};
  for (const p of pessoas) {
    const key = String(p.funcao_id);
    por_funcao[key] = (por_funcao[key] ?? 0) + p.valor;
  }
  const custo = pessoas.reduce((acc, p) => acc + p.valor, 0);
  const lucro = receita - custo;
  return {
    cliente_id: id,
    nome,
    status: 'ativo',
    receita,
    custo,
    lucro,
    margem: Math.round((lucro / receita) * 10000) / 10000,
    a_informar: false,
    por_funcao,
    pessoas,
  };
}

// Ordered by nome (pt-BR collation), like the database, not by id.
const clientes = receitas
  .map(([id, nome, receita]) => cliente(id, nome, receita))
  .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

const planilhaSeeded: RentabilidadeSeeded = {
  seeded: true,
  periodo: {
    inicio: '2026-10-01',
    fim: '2026-11-01',
    rotulo: 'out 2026',
    status: 'aberto',
    transicao: false,
    fator: 1,
  },
  meta_margem: 55,
  funcoes,
  clientes,
  membros,
  totais: {
    receita: 30600,
    custo_clientes: 12310,
    custo_sem_cliente: 0,
    custo_total: 12310,
    lucro: 18290,
    margem: 0.5977,
    por_funcao: { '1': 2860, '2': 3900, '3': 3150, '4': 2400 },
  },
  incompleto: false,
};

// Typed as the seeded variant (assignable to Rentabilidade) so tests read
// `planilha.clientes` without narrowing.
export const planilha: RentabilidadeSeeded = planilhaSeeded;
