import { lazyLabels } from '../postLabels';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilaOrdem } from '../minhaFila';

export const FILA_ORDEM_OPTIONS: FilaOrdem[] = ['prazo', 'publicacao'];

export const FILA_ORDEM_LABELS: Record<FilaOrdem, string> = lazyLabels(
  FILA_ORDEM_OPTIONS,
  (k) => `entregas:filaOrdemPicker.${k}`,
);
const OPTIONS = FILA_ORDEM_OPTIONS;

/** Seletor "Ordenar" da Minha fila, ao lado do FilaMembroPicker na linha das
 *  abas: decide se as seções seguem o prazo da etapa ou a data de publicação. */
export function FilaOrdemPicker({
  ordem,
  onChange,
}: {
  ordem: FilaOrdem;
  onChange: (ordem: FilaOrdem) => void;
}) {
  const { t } = useTranslation('entregas');
  return (
    <Select
      value={ordem}
      onValueChange={(v) => {
        const next = OPTIONS.find((o) => o === v);
        if (next) onChange(next);
      }}
    >
      {/* md:text-xs: o md:text-sm do SelectTrigger sobrevive ao merge (como no ListToolbar). */}
      <SelectTrigger
        className="h-8 w-auto rounded-full text-xs md:text-xs gap-1.5"
        aria-label={t('filaOrdemPicker.aria')}
      >
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)' }}>{t('filaOrdemPicker.sortLabel')}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o} value={o}>
            {FILA_ORDEM_LABELS[o]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
