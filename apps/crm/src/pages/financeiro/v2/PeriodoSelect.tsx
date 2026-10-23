import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { PeriodoFinanceiro } from '@/store/financeiroV2';

interface PeriodoSelectProps {
  /** `inicio` (ISO date) of the selected period. */
  value: string | undefined;
  onChange: (inicio: string) => void;
  /** Rendered in the given order. Closed ('Fechado') and reopened ('Reaberto') periods get a badge. */
  periodos: PeriodoFinanceiro[];
  /** The trigger needs an accessible name: pass `aria-label`, or `id` + a `<Label htmlFor>`. */
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Period picker shared by the Financeiro v2 screens (Rentabilidade, Custos da equipe,
 * Acordo "Vale a partir de"). Options are the `rotulo` of each period.
 */
export function PeriodoSelect({
  value,
  onChange,
  periodos,
  id,
  'aria-label': ariaLabel,
  placeholder = 'Período',
  disabled,
  className,
}: PeriodoSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('w-full sm:w-56', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {periodos.map((p) => (
          <SelectItem key={p.inicio} value={p.inicio}>
            <span className="flex items-center gap-2">
              {p.rotulo}
              {p.status === 'fechado' && (
                <Badge variant="neutral" size="sm">
                  Fechado
                </Badge>
              )}
              {p.status === 'reaberto' && (
                <Badge variant="warning" size="sm">
                  Reaberto
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default PeriodoSelect;
