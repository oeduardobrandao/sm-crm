import { cn } from '@/lib/utils';

interface MensalAnualToggleProps {
  anual: boolean;
  onChange: (anual: boolean) => void;
  className?: string;
}

const OPCOES = [
  { anual: false, label: 'Mensal' },
  { anual: true, label: 'Anual' },
] as const;

/** Segmented "Mensal | Anual" switch of the Rentabilidade table: two toggle buttons. */
export function MensalAnualToggle({ anual, onChange, className }: MensalAnualToggleProps) {
  return (
    <div
      role="group"
      aria-label="Valores da tabela"
      className={cn('inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]', className)}
    >
      {OPCOES.map((o) => {
        const ativo = o.anual === anual;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.anual)}
            className={cn(
              'flex-1 rounded-lg px-3.5 py-1.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              ativo
                ? 'bg-card font-semibold text-foreground shadow-sm'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default MensalAnualToggle;
