const PERIODS = [30, 60, 90] as const;

interface PeriodSelectorProps {
  value: number;
  onChange: (period: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex rounded-lg bg-stone-100 dark:bg-white/[0.06] p-0.5 gap-0.5">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          data-active={p === value ? 'true' : undefined}
          onClick={() => p !== value && onChange(p)}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            p === value
              ? 'bg-[#eab308] text-stone-900'
              : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
          }`}
        >
          {p}d
        </button>
      ))}
    </div>
  );
}
