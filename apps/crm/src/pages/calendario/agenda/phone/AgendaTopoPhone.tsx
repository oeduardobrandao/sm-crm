import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { Calendar } from '@/components/ui/calendar';
import { NAV_LABELS, type AgendaViewType } from '../AgendaView';
import './agendaPhone.css';

export type VistaPhone = Exclude<AgendaViewType, 'timeGridWeek'>;

const VISTAS: { value: VistaPhone; key: 'month' | 'day' | 'list' }[] = [
  { value: 'dayGridMonth', key: 'month' },
  { value: 'timeGridDay', key: 'day' },
  { value: 'listWeek', key: 'list' },
];

export interface AgendaTopoPhoneProps {
  titulo: string;
  vista: VistaPhone;
  onVista: (v: VistaPhone) => void;
  onHoje: () => void;
  onAnterior: () => void;
  onProximo: () => void;
  /** People hidden plus layers changed from their default: the filters button's badge. */
  filtrosAtivos: number;
  onFiltros: () => void;
  /** Absent for roles without calendario:editar. */
  onCriar?: () => void;
  dataSelecionada: Date;
  onIrPara: (d: Date) => void;
}

/**
 * Header of the Agenda below 768px (FAgenda): filters, the ink "+" and the bell; the
 * period as subtitle, which opens a month picker to jump to a date; Mês / Dia / Lista,
 * Hoje and the period arrows under it.
 */
export function AgendaTopoPhone({
  titulo,
  vista,
  onVista,
  onHoje,
  onAnterior,
  onProximo,
  filtrosAtivos,
  onFiltros,
  onCriar,
  dataSelecionada,
  onIrPara,
}: AgendaTopoPhoneProps) {
  const { t } = useTranslation('agenda');
  const dateLocale = useDateFnsLocale();
  const [irParaAberto, setIrParaAberto] = useState(false);
  const [mes, setMes] = useState(dataSelecionada);
  const nav = NAV_LABELS[vista];

  return (
    <>
      <PhonePageHeader
        title={t('phone.titulo')}
        subtitle={
          <button
            type="button"
            className="phone-agenda-periodo"
            aria-haspopup="dialog"
            aria-label={titulo ? t('phone.irParaComTitulo', { titulo }) : t('phone.irParaUmaData')}
            onClick={() => {
              setMes(dataSelecionada);
              setIrParaAberto(true);
            }}
          >
            {titulo}
            <ChevronDown aria-hidden="true" />
          </button>
        }
        actions={
          <>
            <PhoneIconButton
              label={t('filtros.titulo')}
              aria-haspopup="dialog"
              badge={filtrosAtivos}
              onClick={onFiltros}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {onCriar && (
              <PhoneIconButton label={t('sidebar.criar')} variant="ink" onClick={onCriar}>
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        <div className="phone-agenda-toolbar">
          <SegmentedControl<VistaPhone>
            aria-label={t('view.viewLabel')}
            className="phone-agenda-toolbar__vistas"
            options={VISTAS.map((v) => ({ value: v.value, label: t(`view.${v.key}`) }))}
            value={vista}
            onChange={onVista}
          />
          <button type="button" className="phone-agenda-toolbar__hoje" onClick={onHoje}>
            {t('view.today')}
          </button>
          <PhoneIconButton label={nav.prev} onClick={onAnterior}>
            <ChevronLeft aria-hidden="true" />
          </PhoneIconButton>
          <PhoneIconButton label={nav.next} onClick={onProximo}>
            <ChevronRight aria-hidden="true" />
          </PhoneIconButton>
        </div>
      </PhonePageHeader>

      <BottomSheet
        open={irParaAberto}
        onOpenChange={setIrParaAberto}
        title={t('phone.irParaData')}
        detents={['fit']}
      >
        <div className="phone-agenda-ir-para">
          <Calendar
            mode="single"
            locale={dateLocale}
            weekStartsOn={1}
            selected={dataSelecionada}
            month={mes}
            onMonthChange={setMes}
            onSelect={(d) => {
              if (!d) return;
              onIrPara(d);
              setIrParaAberto(false);
            }}
          />
        </div>
      </BottomSheet>
    </>
  );
}
