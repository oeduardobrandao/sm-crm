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
import type { CelulaFuncao, LinhaRentabilidade, TotalRentabilidade } from './rentabilidade';

interface RentabilidadeTabelaProps {
  linhas: LinhaRentabilidade[];
  total: TotalRentabilidade;
  funcoes: FuncaoFinanceira[];
  anual: boolean;
  access: FinancialAccess;
  selecionadoId: number | null;
  onSelect: (clienteId: number) => void;
}

const NUM = 'text-right tabular-nums whitespace-nowrap';

/** Per-client profitability table: one row per client, one column per função, a totals footer. */
export function RentabilidadeTabela({
  linhas,
  total,
  funcoes,
  anual,
  access,
  selecionadoId,
  onSelect,
}: RentabilidadeTabelaProps) {
  const brl = (v: number) => formatFinancialBRL(v, access);
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
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableHead colSpan={5} />
          {funcoes.length > 0 && (
            <TableHead
              colSpan={funcoes.length}
              className="h-7 border-l border-border text-center text-[11px] uppercase tracking-wide"
            >
              Custo por função
            </TableHead>
          )}
        </TableRow>
        <TableRow>
          <TableHead>Cliente</TableHead>
          <TableHead className={NUM}>{anual ? 'ARR' : 'MRR'}</TableHead>
          <TableHead className={NUM}>{anual ? 'Custo anual' : 'Custo mensal'}</TableHead>
          <TableHead className={NUM}>{anual ? 'LL anual' : 'Lucro'}</TableHead>
          <TableHead className={NUM}>Margem</TableHead>
          {funcoes.map((f, i) => (
            <TableHead key={f.id} className={cn(NUM, i === 0 && 'border-l border-border')}>
              {f.nome}
            </TableHead>
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
              <TableCell>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={selecionado}
                    onClick={() => onSelect(l.cliente.cliente_id)}
                    className="rounded font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {l.cliente.nome}
                  </button>
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
              {l.funcoes.map((c, i) => (
                <TableCell
                  key={c.funcaoId}
                  className={cn(NUM, 'text-muted-foreground', i === 0 && 'border-l border-border')}
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
          <TableCell>Total</TableCell>
          <TableCell className={NUM}>{brl(total.receita)}</TableCell>
          <TableCell className={NUM}>{brl(total.custo)}</TableCell>
          <TableCell className={NUM}>{brl(total.lucro)}</TableCell>
          <TableCell className={NUM}>{formatMargem(total.margem)}</TableCell>
          {funcoes.map((f, i) => (
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
