import { Badge } from '@/components/ui/badge';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { cn } from '@/lib/utils';
import type { ClienteRentabilidade, FuncaoFinanceira } from '@/store/financeiroV2';
import { abaixoDaMeta, formatMargem, regraTexto } from './format';

interface RentabilidadeDetalheProps {
  cliente: ClienteRentabilidade | null;
  funcoes: FuncaoFinanceira[];
  /** In percentage points (55 = 55%). */
  metaMargem: number;
  access: FinancialAccess;
}

// One colour per função, by position (wraps after six), and green for the profit.
const CORES_FUNCAO = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-slate-500',
];
const COR_LUCRO = 'bg-green-600';

interface Segmento {
  key: string;
  label: string;
  valor: number;
  cor: string;
}

/**
 * Side panel of the Rentabilidade table: where a client's fee goes (stacked bar per
 * função plus profit) and who serves the client, with how each share was computed.
 * Values are monthly, whatever the table's Mensal/Anual toggle says.
 */
export function RentabilidadeDetalhe({
  cliente,
  funcoes,
  metaMargem,
  access,
}: RentabilidadeDetalheProps) {
  if (!cliente) {
    return (
      <p className="text-sm text-muted-foreground">
        Selecione um cliente para ver de onde vem o custo.
      </p>
    );
  }

  const brl = (v: number) => formatFinancialBRL(v, access);
  const nomeFuncao = (id: number | null) => funcoes.find((f) => f.id === id)?.nome ?? null;

  const segmentos: Segmento[] = funcoes
    .map((f, i) => ({
      key: `f${f.id}`,
      label: f.nome,
      valor: cliente.por_funcao[String(f.id)] ?? 0,
      cor: CORES_FUNCAO[i % CORES_FUNCAO.length],
    }))
    .filter((s) => s.valor > 0);
  if (cliente.lucro > 0) {
    segmentos.push({ key: 'lucro', label: 'Lucro', valor: cliente.lucro, cor: COR_LUCRO });
  }
  // Percentages are of the fee; widths of the bar's whole, which a loss makes exceed the fee.
  const base = Math.max(
    cliente.receita,
    segmentos.reduce((acc, s) => acc + s.valor, 0),
  );
  const pct = (v: number) => `${Math.round((v / cliente.receita) * 100)}%`;
  const barLabel = segmentos.map((s) => `${s.label} ${pct(s.valor)}`).join(', ');

  const semNinguem = funcoes.filter((f) => !cliente.pessoas.some((p) => p.funcao_id === f.id));
  const abaixo = abaixoDaMeta(cliente.margem, metaMargem);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Cliente selecionado</span>
          <span className="break-words text-lg font-bold leading-snug">{cliente.nome}</span>
        </div>
        {cliente.status === 'pausado' ? (
          <Badge variant="neutral">Pausado</Badge>
        ) : (
          <Badge variant={abaixo ? 'warning' : 'success'}>
            {formatMargem(cliente.margem)} de margem
          </Badge>
        )}
      </div>

      {/* One row per figure: the panel can be 300px wide and amounts reach R$ 100.000,00. */}
      <dl className="m-0 flex flex-col divide-y divide-border rounded-lg border border-border">
        {(
          [
            ['Mensalidade', cliente.receita],
            ['Custo', cliente.custo],
            ['Lucro', cliente.lucro],
          ] as const
        ).map(([label, valor]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 whitespace-nowrap text-[15px] font-bold tabular-nums">
              {brl(valor)}
            </dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">Para onde vai a mensalidade</h3>
        {cliente.receita > 0 && segmentos.length > 0 ? (
          <>
            <div
              role="img"
              aria-label={barLabel}
              className="flex h-3 overflow-hidden rounded-full bg-muted"
            >
              {segmentos.map((s) => (
                <div
                  key={s.key}
                  className={s.cor}
                  style={{ width: `${(s.valor / base) * 100}%` }}
                />
              ))}
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-xs text-muted-foreground">
              {segmentos.map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-sm', s.cor)} aria-hidden="true" />
                  {s.label} {pct(s.valor)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Sem mensalidade neste período.</p>
        )}
      </section>

      <section className="flex flex-col">
        <h3 className="mb-1 text-[13px] font-semibold">Quem atende este cliente</h3>
        <ul className="m-0 list-none p-0">
          {cliente.pessoas.map((p) => {
            const funcao = nomeFuncao(p.funcao_id);
            return (
              <li
                key={`${p.membro_id}-${p.funcao_id ?? 'x'}`}
                className="flex items-center gap-3 border-t border-border py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-semibold">
                    {p.nome}
                    {funcao && (
                      <span className="font-normal text-muted-foreground"> · {funcao}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {regraTexto(p, access, undefined, cliente.status === 'pausado')}
                  </span>
                </div>
                <span className="text-[13px] font-bold tabular-nums">{brl(p.valor)}</span>
              </li>
            );
          })}
          {semNinguem.length > 0 && (
            <li className="border-t border-border py-2 text-xs text-muted-foreground">
              Ninguém atribuído em {semNinguem.map((f) => f.nome).join(', ')}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

export default RentabilidadeDetalhe;
