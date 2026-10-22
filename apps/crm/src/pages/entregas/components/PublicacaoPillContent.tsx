import { CalendarCheck, CalendarClock, CalendarOff } from 'lucide-react';
import type { PublicacaoPill } from '../boardEntity';

const ICONS = {
  publicado: CalendarCheck,
  agendado: CalendarClock,
  sem_data: CalendarOff,
} as const;

/** Miolo da pill de data de publicação dos cards de post (desktop e celular):
 *  ícone do estado + dia curto à vista, a forma longa só para leitor de tela. */
export function PublicacaoPillContent({ pill }: { pill: PublicacaoPill }) {
  const Icon = ICONS[pill.estado];
  return (
    <>
      <Icon
        size={11}
        aria-hidden="true"
        style={{ display: 'inline-block', flexShrink: 0, marginRight: 4, verticalAlign: '-1px' }}
      />
      <span aria-hidden="true">{pill.text}</span>
      <span className="sr-only">{pill.title}</span>
    </>
  );
}
