import { CalendarSync } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';
import type { AgendaTipo } from '../../../../store/agenda';
import type { CamadasGrupoProps } from '../../camadas/CamadasGrupo';
import { CAMADAS_PADRAO } from '../../camadas/camadasStorage';
import { CAMADA_ICONE } from '../../camadas/icones';
import { CAMADA_COR, CAMADA_ROTULO, CAMADAS, CAMADAS_FINANCEIRAS } from '../../camadas/tipos';
import { NICHE_CALENDARS } from '../../nicheCalendars/registry';
import { TIPO_COR, TIPO_LABEL } from '../agendaLogic';
import type { AgendaFiltro, AgendaPessoa } from '../AgendaSidebar';
import './agendaPhone.css';

const TIPOS = Object.keys(TIPO_LABEL) as AgendaTipo[];

export interface AgendaFiltrosSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meuId: string | null;
  pessoas: AgendaPessoa[];
  filtro: AgendaFiltro;
  onFiltroChange: (f: AgendaFiltro) => void;
  camadas: CamadasGrupoProps;
  /** Opens the calendar feed dialog once this sheet is closed. */
  onSincronizar: () => void;
}

const pessoaVisivel = (filtro: AgendaFiltro, meuId: string | null, id: string) =>
  filtro.modo === 'minha' ? id === meuId : !filtro.ocultos.includes(id);

/** People hidden plus layers changed from their default (commemorative dates start
 *  off), for the badge on the header's filters button. */
export function contarFiltrosAtivos(
  filtro: AgendaFiltro,
  meuId: string | null,
  pessoas: AgendaPessoa[],
  camadas: Pick<CamadasGrupoProps, 'ativas' | 'canSeeFinancials'>,
): number {
  const ocultas = pessoas.filter((p) => !pessoaVisivel(filtro, meuId, p.id)).length;
  const alteradas = CAMADAS.filter(
    (id) =>
      (!CAMADAS_FINANCEIRAS.has(id) || camadas.canSeeFinancials === true) &&
      camadas.ativas[id] !== CAMADAS_PADRAO[id],
  ).length;
  return ocultas + alteradas;
}

function Corpo({
  meuId,
  pessoas,
  filtro,
  onFiltroChange,
  camadas,
  onSincronizar,
}: Omit<AgendaFiltrosSheetProps, 'open' | 'onOpenChange'>) {
  const { closeThen } = useSheetActions();
  const ordenadas = [...pessoas].sort((a, b) => Number(b.id === meuId) - Number(a.id === meuId));
  const camadasVisiveis = CAMADAS.filter(
    (id) => !CAMADAS_FINANCEIRAS.has(id) || camadas.canSeeFinancials === true,
  );

  // Same rule as the sidebar checkboxes: toggling a person switches to "Toda a equipe"
  // with everyone currently visible, plus or minus that person.
  function alternarPessoa(id: string, marcar: boolean) {
    const visiveis = new Set(
      pessoas.map((p) => p.id).filter((pid) => pessoaVisivel(filtro, meuId, pid)),
    );
    if (marcar) visiveis.add(id);
    else visiveis.delete(id);
    onFiltroChange({
      modo: 'equipe',
      ocultos: pessoas.map((p) => p.id).filter((pid) => !visiveis.has(pid)),
    });
  }

  return (
    <div className="phone-agenda-filtros">
      <h3 className="phone-agenda-filtros__rotulo">Mostrar</h3>
      <SegmentedControl<AgendaFiltro['modo']>
        aria-label="Mostrar"
        className="phone-agenda-filtros__modo"
        options={[
          { value: 'minha', label: 'Minha agenda' },
          { value: 'equipe', label: 'Toda a equipe' },
        ]}
        value={filtro.modo}
        onChange={(modo) => onFiltroChange({ ...filtro, modo })}
      />

      {ordenadas.length > 0 && (
        <GroupedList header="Pessoas" headerAs="h3">
          {ordenadas.map((p) => (
            <Cell
              key={p.id}
              icon={
                <span className={`avatar phone-agenda-filtros__avatar ${avatarColorClass(p.id)}`}>
                  {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : getInitials(p.nome)}
                </span>
              }
              label={p.id === meuId ? `${p.nome} (você)` : p.nome}
              switch={{
                checked: pessoaVisivel(filtro, meuId, p.id),
                onCheckedChange: (c) => alternarPessoa(p.id, c),
              }}
            />
          ))}
        </GroupedList>
      )}

      <GroupedList header="Camadas" headerAs="h3">
        {camadasVisiveis.map((id) => {
          const Icone = CAMADA_ICONE[id];
          return (
            <Cell
              key={id}
              icon={
                <span
                  className="agenda-camada-swatch agenda-camada-swatch--lg"
                  style={{ borderColor: CAMADA_COR[id], color: CAMADA_COR[id] }}
                >
                  <Icone size={14} strokeWidth={2} />
                </span>
              }
              label={CAMADA_ROTULO[id]}
              switch={{
                checked: camadas.ativas[id],
                onCheckedChange: (c) => camadas.onChange({ ...camadas.ativas, [id]: c }),
              }}
            />
          );
        })}
        {camadas.ativas.comemorativas && (
          <PickerCell
            label="Nicho"
            value={camadas.nichoKey}
            options={NICHE_CALENDARS.map((n) => ({ value: n.key, label: n.label }))}
            onChange={(v) => v && camadas.onNichoChange(v)}
          />
        )}
      </GroupedList>

      <GroupedList aria-label="Sincronizar">
        <Cell
          icon={<CalendarSync aria-hidden="true" />}
          label="Sincronizar com seu calendário"
          chevron
          onClick={() => closeThen(onSincronizar)}
        />
      </GroupedList>

      <GroupedList header="Legenda" headerAs="h3">
        {TIPOS.map((t) => (
          <Cell
            key={t}
            icon={
              <span className="phone-agenda-filtros__dot" style={{ background: TIPO_COR[t] }} />
            }
            label={TIPO_LABEL[t]}
          />
        ))}
      </GroupedList>
      <p className="phone-agenda-filtros__nota">
        Evento com barra tracejada: aguardando sua resposta.
      </p>
    </div>
  );
}

/** "Pessoas e filtros" below 768px (FAgendaFiltros): the desktop sidebar's filters as a
 *  sheet. The mini calendar moved to the header's period picker. */
export function AgendaFiltrosSheet({ open, onOpenChange, ...rest }: AgendaFiltrosSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pessoas e filtros"
      detents={['large']}
    >
      <Corpo {...rest} />
    </BottomSheet>
  );
}
