import type { Ref } from 'react';
import { CheckCheck, Rows3, Users } from 'lucide-react';
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

/** Controles da vista Lista, em linha própria acima da tabela: "Agrupar por",
 *  "Mostrar postados" (só na Lista de Publicações) e o botão do painel
 *  Responsáveis, por último para ficar sobre onde o painel lateral abre. */
export function ListToolbar({
  groupBy,
  groupByOptions,
  onGroupByChange,
  responsaveisOpen,
  onToggleResponsaveis,
  selectedResponsaveis,
  responsaveisToggleRef,
  postados,
}: {
  groupBy: ListGroupBy;
  /** Data de postagem só existe em Publicações: a página decide a lista. */
  groupByOptions: readonly ListGroupBy[];
  onGroupByChange: (groupBy: ListGroupBy) => void;
  responsaveisOpen: boolean;
  onToggleResponsaveis: () => void;
  /** Quantos responsáveis estão marcados no filtro (selo no botão). */
  selectedResponsaveis: number;
  /** O botão Responsáveis: a página devolve o foco a ele quando o X do painel
   *  lateral desmonta o botão que estava focado. */
  responsaveisToggleRef?: Ref<HTMLButtonElement>;
  /** Lista de Publicações com o filtro de status do post vazio: os postados ficam
   *  ocultos até `shown`. `count` é quantos postados a lista tem com os filtros
   *  atuais. Ausente, o botão não aparece. */
  postados?: { count: number; shown: boolean; onToggle: () => void };
}) {
  return (
    // Quebra de linha em vez de passar da largura do celular (o select com a
    // data de postagem mais o selo do botão já passa dos 343px de um 375px).
    // Alinhada à direita a partir de 901px, sobre onde o painel lateral abre.
    <div className="flex flex-wrap items-center gap-2 min-[901px]:justify-end">
      <Select
        value={groupBy}
        onValueChange={(v) => {
          const next = groupByOptions.find((o) => o === v);
          if (next) onGroupByChange(next);
        }}
      >
        {/* md:text-xs: o md:text-sm do SelectTrigger sobrevive ao merge e deixaria o
            select em 14px ao lado do botão de 12px. */}
        <SelectTrigger
          className="h-8 w-auto rounded-full text-xs md:text-xs gap-1.5"
          aria-label="Agrupar por"
        >
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
      {postados && (
        <Button
          type="button"
          variant="outline"
          className={`h-8 rounded-full px-3 text-xs gap-1.5 font-normal mb-0${
            postados.shown ? ' bg-accent' : ''
          }`}
          aria-pressed={postados.shown}
          onClick={postados.onToggle}
        >
          <CheckCheck className="!h-3.5 !w-3.5" aria-hidden="true" />
          Mostrar postados
          {postados.count > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none px-1"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-muted)',
                minWidth: '1.1rem',
                height: '1.1rem',
              }}
            >
              {postados.count}
            </span>
          )}
        </Button>
      )}
      <Button
        ref={responsaveisToggleRef}
        type="button"
        variant="outline"
        // Aberto = fundo accent: o estado do painel fica visível no próprio botão.
        className={`h-8 rounded-full px-3 text-xs gap-1.5 font-normal mb-0${
          responsaveisOpen ? ' bg-accent' : ''
        }`}
        aria-expanded={responsaveisOpen}
        onClick={onToggleResponsaveis}
      >
        {/* !h/!w: o [&_svg]:size-4 do Button vence um h-3.5 sem importante e deixaria o
            ícone em 16px ao lado do Rows3 de 14px. */}
        <Users className="!h-3.5 !w-3.5" aria-hidden="true" />
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
