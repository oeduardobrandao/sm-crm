import { useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { Calendar } from '@/components/ui/calendar';
import { NAV_LABELS, type AgendaViewType } from '../AgendaView';
import './agendaPhone.css';

export type VistaPhone = Exclude<AgendaViewType, 'timeGridWeek'>;

const VISTAS: { value: VistaPhone; label: string }[] = [
  { value: 'dayGridMonth', label: 'Mês' },
  { value: 'timeGridDay', label: 'Dia' },
  { value: 'listWeek', label: 'Lista' },
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
  const [irParaAberto, setIrParaAberto] = useState(false);
  const [mes, setMes] = useState(dataSelecionada);
  const nav = NAV_LABELS[vista];

  return (
    <>
      <PhonePageHeader
        title="Agenda"
        subtitle={
          <button
            type="button"
            className="phone-agenda-periodo"
            aria-haspopup="dialog"
            aria-label={titulo ? `${titulo}. Ir para uma data` : 'Ir para uma data'}
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
              label="Pessoas e filtros"
              aria-haspopup="dialog"
              badge={filtrosAtivos}
              onClick={onFiltros}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {onCriar && (
              <PhoneIconButton label="Criar evento" variant="ink" onClick={onCriar}>
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        <div className="phone-agenda-toolbar">
          <SegmentedControl<VistaPhone>
            aria-label="Visão"
            className="phone-agenda-toolbar__vistas"
            options={VISTAS}
            value={vista}
            onChange={onVista}
          />
          <button type="button" className="phone-agenda-toolbar__hoje" onClick={onHoje}>
            Hoje
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
        title="Ir para a data"
        detents={['fit']}
      >
        <div className="phone-agenda-ir-para">
          <Calendar
            mode="single"
            locale={ptBR}
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
