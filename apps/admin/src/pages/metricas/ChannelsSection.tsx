import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAcquisitionChannels } from '../../lib/api';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Skeleton } from '../../components/ui/skeleton';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { useIsPhone } from '../../hooks/useIsPhone';
import { defaultRange, toDisplayRows, type MonthRange } from './channels-view';
import { ChannelsDesktop } from './ChannelsDesktop';
import { ChannelsPhone } from './ChannelsPhone';

function RangePicker({
  range,
  onChange,
}: {
  range: MonthRange;
  onChange: (r: MonthRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="channels-from">Cadastros de</Label>
        <Input
          id="channels-from"
          type="month"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="channels-to">até</Label>
        <Input
          id="channels-to"
          type="month"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
        />
      </div>
    </div>
  );
}

/** The backend (platform-admin `monthBounds`) answers 400 above this many months, both ends in. */
const MAX_MONTHS = 24;

/** Months in [from, to], both inclusive; NaN when a value is not YYYY-MM. */
function monthSpan(r: MonthRange): number {
  const idx = (v: string) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5, 7)) - 1;
  return idx(r.to) - idx(r.from) + 1;
}

/** "Canais de aquisição" on Métricas. Spec: 2026-11-26-workspace-acquisition-source-design.md §5. */
export function ChannelsSection() {
  const isPhone = useIsPhone();
  const [range, setRange] = useState<MonthRange>(() => defaultRange(new Date()));
  const ordered = range.from <= range.to;
  const tooLong = ordered && monthSpan(range) > MAX_MONTHS;
  const valid = ordered && !tooLong;
  const q = useQuery({
    queryKey: ['acquisition-channels', range.from, range.to],
    queryFn: () => getAcquisitionChannels(range.from, range.to),
    enabled: valid,
    staleTime: 5 * 60 * 1000,
  });
  const rows = useMemo(
    () => (q.data ? toDisplayRows(q.data.channels, range) : []),
    [q.data, range],
  );

  const View = isPhone ? ChannelsPhone : ChannelsDesktop;
  let body;
  if (!ordered) {
    body = (
      <EmptyState title="Período inválido" description="O mês inicial vem depois do mês final." />
    );
  } else if (tooLong) {
    body = (
      <EmptyState title="Período longo demais" description={`Escolha até ${MAX_MONTHS} meses.`} />
    );
  } else if (q.isPending) {
    body = <Skeleton className="h-64 w-full rounded-2xl" />;
  } else if (q.isError) {
    body = (
      <ErrorState
        message="Não foi possível carregar os canais de aquisição."
        onRetry={() => q.refetch()}
      />
    );
  } else {
    body = <View rows={rows} />;
  }

  return (
    <section aria-labelledby="channels-title" className="space-y-3" data-testid="channels-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="channels-title" className="text-base font-semibold">
          Canais de aquisição
        </h2>
        <RangePicker range={range} onChange={setRange} />
      </div>
      {body && !q.isPending && valid && !q.isError ? (
        <GlassPanel flush={!isPhone}>{body}</GlassPanel>
      ) : (
        body
      )}
    </section>
  );
}
