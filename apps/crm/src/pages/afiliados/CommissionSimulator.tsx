import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listPublicPricingPlans } from '@/services/billing';
import { formatBRL } from '@/services/affiliates';
import { DEFAULT_COMMISSION_RATE_BPS, formatRate, simulateCommission } from './simulator';

const MAX_COUNT = 999;

/**
 * Simulação de ganhos: quantos indicados em cada plano pago × mensalidade × percentual.
 * Lê os preços reais da tabela pública de planos (mesma fonte da página de preços).
 */
export default function CommissionSimulator({
  rateBps = DEFAULT_COMMISSION_RATE_BPS,
}: {
  rateBps?: number;
}) {
  const { data: plans } = useQuery({
    queryKey: ['public-pricing-plans'],
    queryFn: listPublicPricingPlans,
    staleTime: 10 * 60 * 1000,
  });
  const paidPlans = useMemo(() => (plans ?? []).filter((p) => (p.price_brl ?? 0) > 0), [plans]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const countOf = (id: string) => counts[id] ?? (id === 'pro' ? 5 : 0);
  const setCount = (id: string, value: number) =>
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, Math.min(MAX_COUNT, value)) }));

  const result = simulateCommission(
    paidPlans.map((p) => ({ priceCents: p.price_brl ?? 0, count: countOf(p.id) })),
    rateBps,
  );

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Simule seus ganhos</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Quantas pessoas você indicaria em cada plano? Você recebe {formatRate(rateBps)} de cada
        mensalidade paga.
      </p>

      {paidPlans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Carregando planos…</p>
      ) : (
        <ul className="mb-6 space-y-3">
          {paidPlans.map((plan) => (
            <li key={plan.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{plan.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBRL(plan.price_brl ?? 0)}/mês
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Menos indicados no plano ${plan.name}`}
                  onClick={() => setCount(plan.id, countOf(plan.id) - 1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_COUNT}
                  aria-label={`Indicados no plano ${plan.name}`}
                  className="h-8 w-14 rounded-md border border-input bg-background text-center text-sm"
                  value={countOf(plan.id)}
                  onChange={(e) => setCount(plan.id, parseInt(e.target.value, 10) || 0)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Mais indicados no plano ${plan.name}`}
                  onClick={() => setCount(plan.id, countOf(plan.id) + 1)}
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
          <p className="text-xs text-muted-foreground">Por mês</p>
          <p className="text-xl font-semibold" data-testid="sim-monthly">
            {formatBRL(result.monthlyCents)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Em 12 meses</p>
          <p className="text-xl font-semibold" data-testid="sim-yearly">
            {formatBRL(result.yearlyCents)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Estimativa com todos os indicados pagando o plano mensal com cartão. Não é garantia de
        ganho.
      </p>
    </div>
  );
}
