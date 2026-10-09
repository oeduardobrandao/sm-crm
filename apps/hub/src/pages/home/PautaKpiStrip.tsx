export interface PautaKpi {
  label: string;
  value: string;
  emphasized?: boolean;
  action?: { label: string; onClick: () => void };
}

// Hairlines: 2×2 below sm (left rule on odd cells, top rule on the second row),
// one row of four from sm.
const CELL_BORDER = [
  '',
  'border-l',
  'border-t sm:border-t-0 sm:border-l',
  'border-l border-t sm:border-t-0',
];

export function PautaKpiStrip({ kpis, loading }: { kpis: PautaKpi[]; loading: boolean }) {
  return (
    <section className="hub-card grid grid-cols-2 sm:grid-cols-4 overflow-hidden">
      {kpis.map((k, i) => (
        <div
          key={k.label}
          className={`p-4 sm:p-5 flex flex-col gap-3 hub-border ${CELL_BORDER[i] ?? ''}`}
        >
          <div className={k.emphasized ? 'hub-eyebrow' : 'hub-eyebrow-plain'}>{k.label}</div>
          {loading ? (
            <div className="h-8 w-16 rounded-[var(--hub-r-chip)] hub-bg-soft animate-pulse" />
          ) : (
            <div className="font-display hub-display-title text-[2rem] leading-none tracking-tight tabular-nums hub-txt">
              {k.value}
            </div>
          )}
          {!loading && k.action && (
            <button
              type="button"
              onClick={k.action.onClick}
              className="self-start text-[13px] font-semibold hub-txt underline-offset-4 hover:underline"
            >
              {k.action.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
