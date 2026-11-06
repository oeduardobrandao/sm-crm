import { SegmentedControl } from '@mesaas/ios-kit';
import type { MetricsMonth } from '../../lib/api';
import { MrrChart } from './charts';
import { RevenueKpis } from './RevenueKpis';
import { REVENUE_MODE_OPTIONS, type RevenueMode } from './metrics-view';

interface Props {
  months: MetricsMonth[];
  mode: RevenueMode;
  onModeChange: (mode: RevenueMode) => void;
}

export function RevenuePhone({ months, mode, onModeChange }: Props) {
  return (
    <div className="phone-kit">
      <RevenueKpis months={months} />
      <h2 className="phone-group__header">MRR por mês</h2>
      <div className="admin-glass overflow-hidden rounded-2xl border border-border bg-card p-3.5">
        <SegmentedControl
          aria-label="Empilhar por"
          options={REVENUE_MODE_OPTIONS}
          value={mode}
          onChange={onModeChange}
          className="mb-3.5"
        />
        <div className="h-56">
          <MrrChart months={months} mode={mode} compact />
        </div>
      </div>
    </div>
  );
}
