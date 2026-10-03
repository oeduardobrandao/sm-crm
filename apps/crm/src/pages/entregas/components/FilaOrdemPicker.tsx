import { ArrowUpDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilaOrdem } from '../minhaFila';

const FILA_ORDEM_LABELS: Record<FilaOrdem, string> = {
  prazo: 'Prazo da etapa',
  publicacao: 'Data de publicação',
};

const OPTIONS = Object.keys(FILA_ORDEM_LABELS) as FilaOrdem[];

/** Seletor "Ordenar" da Minha fila, ao lado do FilaMembroPicker na linha das
 *  abas: decide se as seções seguem o prazo da etapa ou a data de publicação. */
export function FilaOrdemPicker({
  ordem,
  onChange,
}: {
  ordem: FilaOrdem;
  onChange: (ordem: FilaOrdem) => void;
}) {
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
        aria-label="Ordenar fila por"
      >
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span style={{ color: 'var(--text-muted)' }}>Ordenar:</span>
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
