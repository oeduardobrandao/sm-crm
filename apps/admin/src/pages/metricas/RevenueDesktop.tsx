import type { MetricsMonth } from '../../lib/api';
import { SegmentedControl } from '@mesaas/ios-kit';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { formatMoney } from '../../lib/subscription';
import { getPlanColor } from '../../lib/plan-colors';
import { latestMonth, monthLabel, REVENUE_MODE_OPTIONS, type RevenueMode } from './metrics-view';
import { MrrChart } from './charts';
import { RevenueKpis } from './RevenueKpis';

interface Props {
  months: MetricsMonth[];
  mode: RevenueMode;
  onModeChange: (mode: RevenueMode) => void;
}

export function RevenueDesktop({ months, mode, onModeChange }: Props) {
  const current = latestMonth(months);
  const plans = [...(current?.by_plan ?? [])].sort((a, b) => b.mrr_cents - a.mrr_cents);
  const total = current?.mrr_cents ?? 0;

  return (
    <div>
      <RevenueKpis months={months} />
      <div className="flex flex-wrap items-start gap-4">
        <GlassPanel
          title="MRR por mês"
          titleId="mrr-chart-title"
          className="flex-[1.8_1_520px]"
          actions={
            <SegmentedControl
              aria-label="Empilhar por"
              options={REVENUE_MODE_OPTIONS}
              value={mode}
              onChange={onModeChange}
            />
          }
        >
          <div className="h-72">
            <MrrChart months={months} mode={mode} />
          </div>
        </GlassPanel>
        {plans.length > 0 ? (
          <GlassPanel
            title="Por plano"
            titleId="mrr-plans-title"
            className="flex-[1_1_280px]"
            flush
            actions={
              current ? (
                <span className="text-[13px] text-muted-foreground">{monthLabel(current)}</span>
              ) : undefined
            }
          >
            <ul aria-labelledby="mrr-plans-title">
              {plans.map((p) => (
                <li
                  key={p.plan_id ?? p.name}
                  className="border-t border-border/60 px-[18px] py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{p.name}</span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(p.mrr_cents, 'brl')}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${total > 0 ? Math.min(100, (p.mrr_cents / total) * 100) : 0}%`,
                        background: getPlanColor(p.name),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </GlassPanel>
        ) : null}
      </div>
    </div>
  );
}
