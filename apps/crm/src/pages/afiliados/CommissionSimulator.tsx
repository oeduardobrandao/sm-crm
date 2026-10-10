import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/services/affiliates';
import { simulateCommission, type CommissionTableRow } from './simulator';

const MAX_COUNT = 999;

/**
 * Simulação de ganhos: quantos indicados em cada plano × comissão por indicado da tabela.
 */
export default function CommissionSimulator({
  rows,
  isLoading,
}: {
  rows: CommissionTableRow[];
  isLoading?: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const countOf = (id: string) => counts[id] ?? (id === 'pro' ? 5 : 0);
  const setCount = (id: string, value: number) =>
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, Math.min(MAX_COUNT, value)) }));

  const effective = Object.fromEntries(rows.map((r) => [r.planId, countOf(r.planId)]));
  const result = simulateCommission(rows, effective);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Simule seus ganhos</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Quantas pessoas você indicaria em cada plano?
      </p>

      {isLoading || rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Carregando planos…</p>
      ) : (
        <ul className="mb-6 space-y-3">
          {rows.map((row) => (
            <li key={row.planId} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.planName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBRL(row.perReferralCents)} por indicado
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Menos indicados no plano ${row.planName}`}
                  onClick={() => setCount(row.planId, countOf(row.planId) - 1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_COUNT}
                  aria-label={`Indicados no plano ${row.planName}`}
                  className="h-8 w-14 rounded-md border border-input bg-background text-center text-sm"
                  value={countOf(row.planId)}
                  onChange={(e) => setCount(row.planId, parseInt(e.target.value, 10) || 0)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Mais indicados no plano ${row.planName}`}
                  onClick={() => setCount(row.planId, countOf(row.planId) + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Por mês, no início</p>
          <p className="text-xl font-semibold" data-testid="sim-monthly">
            {formatBRL(result.firstMonthCents)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total por essas indicações</p>
          <p className="text-xl font-semibold" data-testid="sim-total">
            {formatBRL(result.totalCents)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Estimativa com todos os indicados no plano mensal pago com cartão. Não é garantia de ganho.
      </p>
    </div>
  );
}
