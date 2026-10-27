import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface AutoScheduleBadgeProps {
  /** Sem onClick o badge é estático: é assim que ele aparece no clone do
   *  DragOverlay do kanban, onde um botão seria inerte e confuso. */
  onClick?: () => void;
  /** Só muda o tooltip: sem data válida o clique abre o seletor de data antes. */
  needsDate: boolean;
}

/**
 * Indicador persistente da peça 3 da spec: aparece em todo post em
 * aprovado_cliente que passou os gates de shouldOfferAutoSchedule e está esperando um agendamento que
 * nunca vai acontecer sozinho. Quem decide a visibilidade é o caller
 * (shouldOfferAutoSchedule); este componente é só a superfície.
 */
export function AutoScheduleBadge({ onClick, needsDate }: AutoScheduleBadgeProps) {
  const { t } = useTranslation('workflows');
  const title = needsDate
    ? t('autoScheduleBadge.titleNeedsDate')
    : t('autoScheduleBadge.titleReady');
  if (!onClick) {
    return (
      <span className="auto-schedule-badge" title={title} aria-label={title}>
        <CalendarClock className="h-3 w-3" aria-hidden="true" /> {t('autoScheduleBadge.schedule')}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="auto-schedule-badge auto-schedule-badge--action"
      title={title}
      aria-label={title}
      // O badge vive dentro de um card arrastável (kanban) e de uma linha
      // clicável (drawer): sem parar os dois eventos, o clique inicia um drag
      // ou expande o acordeão em vez de abrir o aviso.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" /> {t('autoScheduleBadge.schedule')}
    </button>
  );
}
