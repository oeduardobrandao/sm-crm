import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { rotuloPeriodo } from './periodos';

interface PeriodoSelectProps {
  /** `inicio` (ISO date) of the selected period. */
  value: string | undefined;
  onChange: (inicio: string) => void;
  /** Closed ('Fechado') and reopened ('Reaberto') periods get a badge. Sorted here by `inicio`. */
  periodos: PeriodoFinanceiro[];
  /** 'recente' (default) = newest first; 'cronologica' = oldest first. */
  ordem?: 'recente' | 'cronologica';
  /** The trigger needs an accessible name: pass `aria-label`, or `id` + a `<Label htmlFor>`. */
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Period picker shared by the Financeiro v2 screens (Rentabilidade, Custos da equipe,
 * Acordo "Vale a partir de"). Options are the label of each period (`rotuloPeriodo`).
 */
export function PeriodoSelect({
  value,
  onChange,
  periodos,
  ordem = 'recente',
  id,
  'aria-label': ariaLabel,
  placeholder,
  disabled,
  className,
}: PeriodoSelectProps) {
  // useTranslation re-renders on a language switch, so the labels below follow it.
  const { t } = useTranslation('financeV2');
  // The RPCs disagree on order (editáveis oldest first, listar newest first): never rely on it.
  const ordenados = useMemo(() => {
    const lista = [...periodos].sort((a, b) => a.inicio.localeCompare(b.inicio));
    return ordem === 'cronologica' ? lista : lista.reverse();
  }, [periodos, ordem]);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('w-full sm:w-56', className)}>
        <SelectValue placeholder={placeholder ?? t('periodoSelect.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {ordenados.map((p) => (
          <SelectItem key={p.inicio} value={p.inicio}>
            <span className="flex items-center gap-2">
              {rotuloPeriodo(p)}
              {p.status === 'fechado' && (
                <Badge variant="neutral" size="sm">
                  {t('shared.fechado')}
                </Badge>
              )}
              {p.status === 'reaberto' && (
                <Badge variant="warning" size="sm">
                  {t('shared.reaberto')}
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
