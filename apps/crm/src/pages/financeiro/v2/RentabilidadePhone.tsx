import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { cn } from '@/lib/utils';
import type { RentabilidadeSeeded } from '@/store/financeiroV2';
import { anualizar, formatMargem } from './format';
import { RentabilidadeDetalhe } from './RentabilidadeDetalhe';
import { MensalAnualToggle } from './MensalAnualToggle';
import type { LinhaRentabilidade } from './rentabilidade';

interface RentabilidadePhoneProps {
  data: RentabilidadeSeeded;
  linhas: LinhaRentabilidade[];
  anual: boolean;
  onAnualChange: (anual: boolean) => void;
  access: FinancialAccess;
}

/**
 * Phone rendering of Rentabilidade: a three-cell summary (four with "Sem cliente"), the Mensal/Anual toggle and
 * one row per client (lowest margin first) with a cost/profit bar. A row opens the
 * client's detail in a bottom sheet.
 */
export function RentabilidadePhone({
  data,
  linhas,
  anual,
  onAnualChange,
  access,
}: RentabilidadePhoneProps) {
  const { t } = useTranslation('financeV2');
  const [abertoId, setAbertoId] = useState<number | null>(null);
  const brl = (v: number) => formatFinancialBRL(v, access);
  const aberto = data.clientes.find((c) => c.cliente_id === abertoId) ?? null;

  // Lucro counts the whole team cost, so the cost outside the clients (which the rows
  // below do not show) gets its own cell when there is any.
  const resumo: Array<readonly [string, string]> = [
    [anual ? t('shared.arr') : t('shared.mrr'), brl(anualizar(data.totais.receita, anual))],
    [anual ? t('shared.lucroAnual') : t('shared.lucro'), brl(anualizar(data.totais.lucro, anual))],
    [t('shared.margem'), formatMargem(data.totais.margem)],
  ];
  if (data.totais.custo_sem_cliente > 0) {
    resumo.push([t('shared.semCliente'), brl(anualizar(data.totais.custo_sem_cliente, anual))]);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <dl
        className={cn(
          'm-0 grid gap-px overflow-hidden rounded-xl border border-border bg-border',
          resumo.length > 3 ? 'grid-cols-2' : 'grid-cols-3',
        )}
      >
        {resumo.map(([label, valor]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5 bg-card p-3">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="m-0 break-words text-sm font-extrabold tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>

      <MensalAnualToggle anual={anual} onChange={onAnualChange} className="flex w-full" />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex justify-between px-3.5 py-2.5 text-xs text-muted-foreground">
          <span>{t('shared.cliente')}</span>
          <span>{anual ? t('shared.lucroAnual') : t('shared.lucro')}</span>
        </div>
        <ul role="list" aria-label={t('shared.clientes')} className="m-0 list-none p-0">
          {linhas.map((l) => {
            const base = Math.max(l.receita, l.custo);
            const largura = (v: number) => (base > 0 ? `${(Math.max(v, 0) / base) * 100}%` : '0%');
            return (
              <li key={l.cliente.cliente_id} className="border-t border-border">
                <button
                  type="button"
                  onClick={() => setAbertoId(l.cliente.cliente_id)}
                  className="flex w-full flex-col gap-1.5 px-3.5 py-2.5 text-left"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">{l.cliente.nome}</span>
                      {l.cliente.status === 'pausado' ? (
                        <Badge variant="neutral" size="sm">
                          {t('shared.pausado')}
                        </Badge>
                      ) : (
                        <Badge variant={l.abaixo ? 'warning' : 'neutral'} size="sm">
                          {formatMargem(l.margem)}
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-bold tabular-nums">{brl(l.lucro)}</span>
                  </span>
                  <span
                    className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <span className="bg-amber-500" style={{ width: largura(l.custo) }} />
                    <span className="bg-green-600" style={{ width: largura(l.lucro) }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex gap-3.5 text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-amber-500" />
          {t('shared.custoEquipe')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-green-600" />
          {t('shared.lucro')}
        </span>
      </div>

      <Sheet open={aberto !== null} onOpenChange={(open) => !open && setAbertoId(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{aberto?.nome ?? t('shared.cliente')}</SheetTitle>
            <SheetDescription>{t('phone.sheetDescription')}</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <RentabilidadeDetalhe
              cliente={aberto}
              funcoes={data.funcoes}
              metaMargem={data.meta_margem}
              access={access}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default RentabilidadePhone;
