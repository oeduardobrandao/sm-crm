import type { ReactNode } from 'react';
import { format, isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { cn } from '@/lib/utils';
import './calendarioPhone.css';

/** Weekday indexes, Sunday first; the initial comes from `common:weekdays` (D S T Q Q S S). */
const SEMANA = [0, 1, 2, 3, 4, 5, 6] as const;

export interface MesGridPhoneProps {
  /** Any day of the month shown. */
  mes: Date;
  /** 0 = Sunday first (classic Calendário), 1 = Monday first (Agenda, like its grid). */
  weekStartsOn: 0 | 1;
  selecionado: Date;
  onSelect: (dia: Date) => void;
  /** Dot colours of a day, one per kind of item (at most 4 are drawn). */
  dotsDoDia: (dia: Date) => string[];
  /** What the day holds, appended to its accessible name ("2 eventos"). */
  resumoDoDia?: (dia: Date) => string;
  /** Title row with the month nav, when the page has no toolbar of its own. */
  cabecalho?: ReactNode;
}

/**
 * Compact month grid of the phone calendars (C0bCalendario): day numbers with up to four
 * dots, today in the accent, the selected day inked. Days of the neighbouring months are
 * left blank; the list of the selected day goes under it.
 */
export function MesGridPhone({
  mes,
  weekStartsOn,
  selecionado,
  onSelect,
  dotsDoDia,
  resumoDoDia,
  cabecalho,
}: MesGridPhoneProps) {
  const year = mes.getFullYear();
  const month = mes.getMonth();
  const diasNoMes = new Date(year, month + 1, 0).getDate();
  const vazios = (new Date(year, month, 1).getDay() - weekStartsOn + 7) % 7;
  const { t } = useTranslation('calendario');
  const locale = useDateFnsLocale();
  const nomeMes = format(mes, 'MMMM', { locale });
  const hoje = new Date();
  const semana = [...SEMANA.slice(weekStartsOn), ...SEMANA.slice(0, weekStartsOn)];

  return (
    <div className="phone-cal-month">
      {cabecalho}
      <div className="phone-cal-month__weekdays" aria-hidden="true">
        {semana.map((d) => (
          <span key={d}>{t(`weekdays.${d}`).charAt(0)}</span>
        ))}
      </div>
      <div className="phone-cal-month__grid">
        {Array.from({ length: vazios }, (_, i) => (
          <span key={`vazio-${i}`} />
        ))}
        {Array.from({ length: diasNoMes }, (_, i) => {
          const dia = new Date(year, month, i + 1);
          const dots = dotsDoDia(dia);
          const resumo = resumoDoDia?.(dia);
          const selected = isSameDay(dia, selecionado);
          return (
            <button
              key={i}
              type="button"
              className={cn(
                'phone-cal-month__day',
                isSameDay(dia, hoje) && 'phone-cal-month__day--today',
                selected && 'phone-cal-month__day--selected',
              )}
              aria-pressed={selected}
              aria-label={`${t('shared.dayMonth', { day: i + 1, month: nomeMes })}${resumo ? `, ${resumo}` : ''}`}
              onClick={() => onSelect(dia)}
            >
              {i + 1}
              <span className="phone-cal-month__dots" aria-hidden="true">
                {dots.slice(0, 4).map((cor, j) => (
                  <i key={j} style={{ background: cor }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
