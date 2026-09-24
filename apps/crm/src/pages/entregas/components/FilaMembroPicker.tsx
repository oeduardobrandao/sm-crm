import { User } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Membro } from '../../../store';

/** Seletor "Fila de" da Minha fila. Mora na linha das abas (VistasTabs
 *  `trailing`), não dentro da vista. */
export function FilaMembroPicker({
  membros,
  membroId,
  currentMembroId,
  onChange,
}: {
  membros: Membro[];
  /** Membro efetivo (explícito ou o próprio). null = login sem membro e nada escolhido. */
  membroId: number | null;
  currentMembroId: number | null;
  /** null = "o próprio usuário" (escolher a si mesmo no seletor). */
  onChange: (membroId: number | null) => void;
}) {
  return (
    <Select
      value={membroId != null ? String(membroId) : ''}
      onValueChange={(v) => {
        const id = parseInt(v, 10);
        if (isNaN(id)) return;
        onChange(id === currentMembroId ? null : id);
      }}
    >
      <SelectTrigger className="fila-picker h-8 rounded-full text-xs gap-1.5" aria-label="Fila de">
        <User className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <SelectValue placeholder="Escolha um membro" />
      </SelectTrigger>
      <SelectContent>
        {membros.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.id === currentMembroId ? `${m.nome} (você)` : m.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
