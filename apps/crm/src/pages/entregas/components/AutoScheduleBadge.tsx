import { CalendarClock } from 'lucide-react';

export interface AutoScheduleBadgeProps {
  /** Sem onClick o badge é estático: é assim que ele aparece no clone do
   *  DragOverlay do kanban, onde um botão seria inerte e confuso. */
  onClick?: () => void;
  /** Só muda o tooltip: sem data válida o clique abre o seletor de data antes. */
  needsDate: boolean;
}

const TITLE_READY = 'Este cliente agenda automaticamente. Clique para agendar este post.';
const TITLE_NEEDS_DATE =
  'Este cliente agenda automaticamente, mas este post não tem data válida. Clique para definir a data e agendar.';

/**
 * Indicador persistente da peça 3 da spec: aparece em todo post em
 * aprovado_cliente que passou os gates de shouldOfferAutoSchedule e está esperando um agendamento que
 * nunca vai acontecer sozinho. Quem decide a visibilidade é o caller
 * (shouldOfferAutoSchedule); este componente é só a superfície.
 */
export function AutoScheduleBadge({ onClick, needsDate }: AutoScheduleBadgeProps) {
  const title = needsDate ? TITLE_NEEDS_DATE : TITLE_READY;
  if (!onClick) {
    return (
      <span className="auto-schedule-badge" title={title}>
        <CalendarClock className="h-3 w-3" aria-hidden="true" /> Agendar
      </span>
    );
  }
  return (
    <button
      type="button"
      className="auto-schedule-badge auto-schedule-badge--action"
      title={title}
      // O badge vive dentro de um card arrastável (kanban) e de uma linha
      // clicável (drawer): sem parar os dois eventos, o clique inicia um drag
      // ou expande o acordeão em vez de abrir o aviso.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" /> Agendar
    </button>
  );
}
