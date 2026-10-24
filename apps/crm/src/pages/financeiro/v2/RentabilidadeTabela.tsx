import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { cn } from '@/lib/utils';
import type { FuncaoFinanceira } from '@/store/financeiroV2';
import { formatMargem } from './format';
import type {
  CelulaFuncao,
  ColunaOrdem,
  LinhaRentabilidade,
  Ordenacao,
  TotalRentabilidade,
} from './rentabilidade';

interface RentabilidadeTabelaProps {
  linhas: LinhaRentabilidade[];
  total: TotalRentabilidade;
  funcoes: FuncaoFinanceira[];
  anual: boolean;
  access: FinancialAccess;
  selecionadoId: number | null;
  /** Omitted in the expanded view, which has no side panel: names are plain text there. */
  onSelect?: (clienteId: number) => void;
  ordem: Ordenacao;
  onOrdenar: (coluna: ColunaOrdem) => void;
  /** Expanded view: the header rows stay put while the table scrolls. */
  fixarCabecalho?: boolean;
}

const NUM = 'text-right tabular-nums whitespace-nowrap';
// Names wrap at 180px instead of squeezing to fit the role columns.
const CLIENTE = 'min-w-[180px]';
// Expanded view. The whole thead sticks (no per-row offsets to keep in sync with row heights),
// with an opaque background so the scrolled rows don't show through and a shadow as its bottom
// line. With collapsed borders Chromium still paints a sliver of the scrolled rows at the seam
// between the two header rows, so this table uses separate borders, which ignore row borders:
// the row lines move onto the cells.
const FIXO = 'sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]';
const SEPARADO =
  'border-separate border-spacing-0 [&_tbody_tr:not(:last-child)_td]:border-b [&_tfoot_td]:border-t';

interface CabecalhoOrdenavelProps {
  coluna: ColunaOrdem;
  ordem: Ordenacao;
  onOrdenar: (coluna: ColunaOrdem) => void;
  numero?: boolean;
  className?: string;
  children: ReactNode;
}

/** Header cell whose label is a button: click sorts by this column, again flips it. */
function CabecalhoOrdenavel({
  coluna,
  ordem,
  onOrdenar,
  numero = true,
  className,
  children,
}: CabecalhoOrdenavelProps) {
  const ativa = ordem.coluna === coluna;
  const Icone = !ativa ? ArrowUpDown : ordem.direcao === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(numero ? NUM : CLIENTE, className)}
    >
      <button
        type="button"
        onClick={() => onOrdenar(coluna)}
        className={cn(
          'group inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          numero && 'flex-row-reverse',
          ativa && 'text-foreground',
        )}
      >
        {children}
        <Icone
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            !ativa &&
              'opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60',
          )}
        />
      </button>
    </TableHead>
  );
}

/**
 * Per-client profitability table: one row per client, one column per função, and a footer
 * that sums the clients (cost outside them, "sem cliente", is noted by the page).
 */
export function RentabilidadeTabela({
  linhas,
  total,
  funcoes,
  anual,
  access,
  selecionadoId,
  onSelect,
  ordem,
  onOrdenar,
  fixarCabecalho = false,
}: RentabilidadeTabelaProps) {
  const brl = (v: number) => formatFinancialBRL(v, access);
  // A função nobody is assigned to adds an empty column; the side panel still lists it.
  const visiveis = funcoes.filter(
    (f) =>
      (total.porFuncao[f.id] ?? 0) > 0 ||
      linhas.some((l) => l.funcoes.some((c) => c.funcaoId === f.id && c.aInformar)),
  );
  const visivel = new Set(visiveis.map((f) => f.id));
  const sort = { ordem, onOrdenar };
  // A delivery still to inform does not hide what the função's other members already cost.
  const celulaFuncao = (c: CelulaFuncao) => {
    if (c.valor === 0) {
      return c.aInformar ? (
        <span className="text-amber-600 dark:text-amber-400">A informar</span>
      ) : (
        '-'
      );
    }
    if (!c.aInformar) return brl(c.valor);
    return (
      <span className="inline-flex items-center gap-1.5">
        {brl(c.valor)}
        <span className="text-[11px] text-amber-600 dark:text-amber-400">a informar</span>
      </span>
    );
  };

  return (
    <Table className={cn('text-[13px]', fixarCabecalho && SEPARADO)}>
      <TableHeader className={cn(fixarCabecalho && FIXO)}>
        {visiveis.length > 0 && (
          <TableRow className="border-b-0 hover:bg-transparent">
            <TableHead colSpan={5} className="h-7 !py-1" />
            <TableHead
              colSpan={visiveis.length}
              className={cn(
                'h-7 !py-1 border-l border-border text-center text-[11px] uppercase tracking-wide',
              )}
            >
              Custo por função
            </TableHead>
          </TableRow>
        )}
        <TableRow>
          <CabecalhoOrdenavel coluna="cliente" numero={false} {...sort}>
            Cliente
          </CabecalhoOrdenavel>
          <CabecalhoOrdenavel coluna="receita" {...sort}>
            {anual ? 'ARR' : 'MRR'}
          </CabecalhoOrdenavel>
          <CabecalhoOrdenavel coluna="custo" {...sort}>
            {anual ? 'Custo anual' : 'Custo mensal'}
          </CabecalhoOrdenavel>
          <CabecalhoOrdenavel coluna="lucro" {...sort}>
            {anual ? 'LL anual' : 'Lucro'}
          </CabecalhoOrdenavel>
          <CabecalhoOrdenavel coluna="margem" {...sort}>
            Margem
          </CabecalhoOrdenavel>
          {visiveis.map((f, i) => (
            <CabecalhoOrdenavel
              key={f.id}
              coluna={`funcao:${f.id}`}
              className={cn(i === 0 && 'border-l border-border')}
              {...sort}
            >
              {f.nome}
            </CabecalhoOrdenavel>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((l) => {
          const selecionado = l.cliente.cliente_id === selecionadoId;
          const pausado = l.cliente.status === 'pausado';
          return (
            <TableRow
              key={l.cliente.cliente_id}
              data-state={selecionado ? 'selected' : undefined}
              className={cn(pausado && 'text-muted-foreground')}
            >
              <TableCell className={CLIENTE}>
                <span className="flex items-center gap-2">
                  {onSelect ? (
                    <button
                      type="button"
                      aria-pressed={selecionado}
                      onClick={() => onSelect(l.cliente.cliente_id)}
                      className="rounded text-left font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {l.cliente.nome}
                    </button>
                  ) : (
                    <span className="font-semibold">{l.cliente.nome}</span>
                  )}
                  {pausado && (
                    <Badge variant="neutral" size="sm">
                      Pausado
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className={NUM}>{brl(l.receita)}</TableCell>
              <TableCell className={NUM}>{brl(l.custo)}</TableCell>
              <TableCell className={cn(NUM, 'font-semibold')}>{brl(l.lucro)}</TableCell>
              <TableCell className={NUM}>
                <span className="inline-flex items-center gap-2">
                  {l.abaixo && (
                    <Badge variant="warning" size="sm">
                      Abaixo da meta
                    </Badge>
                  )}
                  <span className="font-semibold">{formatMargem(l.margem)}</span>
                </span>
              </TableCell>
              {l.funcoes
                .filter((c) => visivel.has(c.funcaoId))
                .map((c, i) => (
                  <TableCell
                    key={c.funcaoId}
                    className={cn(
                      NUM,
                      'text-muted-foreground',
                      i === 0 && 'border-l border-border',
                    )}
                  >
                    {celulaFuncao(c)}
                  </TableCell>
                ))}
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow className="font-bold">
          <TableCell className={CLIENTE}>Total dos clientes</TableCell>
          <TableCell className={NUM}>{brl(total.receita)}</TableCell>
          <TableCell className={NUM}>{brl(total.custo)}</TableCell>
          <TableCell className={NUM}>{brl(total.lucro)}</TableCell>
          <TableCell className={NUM}>{formatMargem(total.margem)}</TableCell>
          {visiveis.map((f, i) => (
            <TableCell key={f.id} className={cn(NUM, i === 0 && 'border-l border-border')}>
              {total.porFuncao[f.id] ? brl(total.porFuncao[f.id]) : '-'}
            </TableCell>
          ))}
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export default RentabilidadeTabela;
