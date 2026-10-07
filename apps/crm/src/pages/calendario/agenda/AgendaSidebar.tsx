import { useEffect, useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { CalendarSync, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';
import type { AgendaTipo } from '../../../store/agenda';
import { TIPO_COR, TIPO_LABEL } from './agendaLogic';

export interface AgendaPessoa {
  id: string;
  nome: string;
  avatarUrl: string | null;
}

/** 'minha' = only events I organize or join. 'equipe' = everyone except the
 *  people in `ocultos` (a hide-list, so new members show up by default). */
export interface AgendaFiltro {
  modo: 'minha' | 'equipe';
  ocultos: string[];
}

export const FILTRO_PADRAO: AgendaFiltro = { modo: 'equipe', ocultos: [] };

/** Ids for filtrarPorPessoas; null = no filter. */
export function idsDoFiltro(
  filtro: AgendaFiltro,
  meuId: string | null,
  pessoas: AgendaPessoa[],
): string[] | null {
  if (filtro.modo === 'minha') return meuId ? [meuId] : [];
  if (filtro.ocultos.length === 0) return null;
  const ocultos = new Set(filtro.ocultos);
  return pessoas.map((p) => p.id).filter((id) => !ocultos.has(id));
}

function pessoaVisivel(filtro: AgendaFiltro, meuId: string | null, id: string): boolean {
  return filtro.modo === 'minha' ? id === meuId : !filtro.ocultos.includes(id);
}

const TIPOS = Object.keys(TIPO_LABEL) as AgendaTipo[];

export interface AgendaSidebarProps {
  meuId: string | null;
  pessoas: AgendaPessoa[];
  filtro: AgendaFiltro;
  onFiltroChange: (f: AgendaFiltro) => void;
  dataSelecionada: Date;
  onDataChange: (d: Date) => void;
  /** Absent for roles without calendario:editar: the button is not rendered. */
  onCriar?: () => void;
  /** Opens the personal calendar feed dialog. Read-only for the user, so it is
   *  not gated by calendario:editar; absent, the entry is not rendered. */
  onSincronizar?: () => void;
}

export default function AgendaSidebar({
  meuId,
  pessoas,
  filtro,
  onFiltroChange,
  dataSelecionada,
  onDataChange,
  onCriar,
  onSincronizar,
}: AgendaSidebarProps) {
  const [mes, setMes] = useState(dataSelecionada);
  useEffect(() => setMes(dataSelecionada), [dataSelecionada]);

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

  // "Você" first, then the roster order.
  const ordenadas = [...pessoas].sort((a, b) => Number(b.id === meuId) - Number(a.id === meuId));

  return (
    <div className="agenda-sidebar">
      {onCriar && (
        <Button type="button" size="lg" className="agenda-sidebar__criar" onClick={onCriar}>
          <Plus aria-hidden="true" />
          Criar evento
        </Button>
      )}

      <div className="agenda-sidebar__card">
        <Calendar
          mode="single"
          locale={ptBR}
          weekStartsOn={1}
          selected={dataSelecionada}
          month={mes}
          onMonthChange={setMes}
          onSelect={(d) => d && onDataChange(d)}
          className="agenda-mini"
        />
      </div>

      <div className="agenda-sidebar__grupo">
        <ToggleGroup
          type="single"
          className="agenda-segmented agenda-segmented--full"
          aria-label="Mostrar"
          value={filtro.modo}
          onValueChange={(next) =>
            next && onFiltroChange({ ...filtro, modo: next as AgendaFiltro['modo'] })
          }
        >
          <ToggleGroupItem value="minha" className="agenda-segmented__item">
            Minha agenda
          </ToggleGroupItem>
          <ToggleGroupItem value="equipe" className="agenda-segmented__item">
            Toda a equipe
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="agenda-sidebar__rotulo">Pessoas</div>
        <ul className="agenda-pessoas">
          {ordenadas.map((p) => {
            const eu = p.id === meuId;
            return (
              <li key={p.id}>
                <label className="agenda-pessoa">
                  <Checkbox
                    aria-label={p.nome}
                    checked={pessoaVisivel(filtro, meuId, p.id)}
                    onCheckedChange={(c) => alternarPessoa(p.id, c === true)}
                  />
                  <span
                    className={`avatar agenda-pessoa__avatar ${avatarColorClass(p.id)}`}
                    aria-hidden="true"
                  >
                    {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : getInitials(p.nome)}
                  </span>
                  <span className="agenda-pessoa__nome">{eu ? `${p.nome} (você)` : p.nome}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="agenda-legenda">
        <div className="agenda-sidebar__rotulo">Legenda</div>
        {TIPOS.map((t) => (
          <div key={t} className="agenda-legenda__item">
            <span
              className="agenda-ev__dot"
              style={{ background: TIPO_COR[t] }}
              aria-hidden="true"
            />
            {TIPO_LABEL[t]}
          </div>
        ))}
        <div className="agenda-legenda__nota">Borda tracejada: aguardando sua resposta</div>
      </div>

      {onSincronizar && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={onSincronizar}
        >
          <CalendarSync aria-hidden="true" />
          Sincronizar com seu calendário
        </Button>
      )}
    </div>
  );
}
