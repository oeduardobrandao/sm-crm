import { Rows3, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ListGroupBy } from '../viewQuery';

const LIST_GROUP_BY_LABELS: Record<ListGroupBy, string> = {
  prazo: 'Prazo da etapa',
  postagem: 'Data de postagem',
  cliente: 'Cliente',
  responsavel: 'Responsável',
  etapa: 'Etapa',
  nenhum: 'Nenhum',
};

/** Controles da vista Lista, na linha das abas: "Agrupar por" e o botão do
 *  painel Responsáveis. */
export function ListToolbar({
  groupBy,
  groupByOptions,
  onGroupByChange,
  responsaveisOpen,
  onToggleResponsaveis,
  selectedResponsaveis,
}: {
  groupBy: ListGroupBy;
  /** Data de postagem só existe em Publicações: a página decide a lista. */
  groupByOptions: readonly ListGroupBy[];
  onGroupByChange: (groupBy: ListGroupBy) => void;
  responsaveisOpen: boolean;
  onToggleResponsaveis: () => void;
  /** Quantos responsáveis estão marcados no filtro (selo no botão). */
  selectedResponsaveis: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={groupBy}
        onValueChange={(v) => {
          const next = groupByOptions.find((o) => o === v);
          if (next) onGroupByChange(next);
        }}
      >
        <SelectTrigger className="h-8 w-auto rounded-full text-xs gap-1.5" aria-label="Agrupar por">
          <Rows3 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span style={{ color: 'var(--text-muted)' }}>Agrupar:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groupByOptions.map((o) => (
            <SelectItem key={o} value={o}>
              {LIST_GROUP_BY_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        // Aberto = fundo accent: o estado do painel fica visível no próprio botão.
        className={`h-8 rounded-full px-3 text-xs gap-1.5 font-normal mb-0${
          responsaveisOpen ? ' bg-accent' : ''
        }`}
        aria-expanded={responsaveisOpen}
        onClick={onToggleResponsaveis}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Responsáveis
        {selectedResponsaveis > 0 && (
          <span
            className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none"
            style={{
              background: 'var(--primary-color)',
              color: '#000',
              width: '1.1rem',
              height: '1.1rem',
            }}
          >
            {selectedResponsaveis}
          </span>
        )}
      </Button>
    </div>
  );
}
