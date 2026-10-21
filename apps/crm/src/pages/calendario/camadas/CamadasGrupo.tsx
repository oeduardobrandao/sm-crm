import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FinancialAccess } from '@/lib/financialAccess';
import { NICHE_CALENDARS } from '../nicheCalendars/registry';
import { CAMADA_ICONE } from './icones';
import {
  CAMADA_COR,
  CAMADA_ROTULO,
  CAMADAS,
  CAMADAS_FINANCEIRAS,
  type CamadaId,
  type CamadasAtivas,
} from './tipos';

export interface CamadasGrupoProps {
  ativas: CamadasAtivas;
  onChange: (ativas: CamadasAtivas) => void;
  /** Receivables and team payments only exist for literal `true`. */
  canSeeFinancials: FinancialAccess | undefined;
  nichoKey: string;
  onNichoChange: (key: string) => void;
}

/** "Camadas" group of the Agenda sidebar: one toggle per read-only layer, with
 *  the niche picker under "Datas comemorativas" while it is on. */
export function CamadasGrupo({
  ativas,
  onChange,
  canSeeFinancials,
  nichoKey,
  onNichoChange,
}: CamadasGrupoProps) {
  const nichoId = useId();
  const visiveis = CAMADAS.filter(
    (id) => !CAMADAS_FINANCEIRAS.has(id) || canSeeFinancials === true,
  );

  function alternar(id: CamadaId, ligada: boolean) {
    onChange({ ...ativas, [id]: ligada });
  }

  return (
    <div className="agenda-sidebar__grupo" role="group" aria-label="Camadas">
      <div className="agenda-sidebar__rotulo">Camadas</div>
      <ul className="agenda-pessoas">
        {visiveis.map((id) => {
          const Icone = CAMADA_ICONE[id];
          return (
            <li key={id}>
              <label className="agenda-pessoa">
                <Checkbox
                  aria-label={CAMADA_ROTULO[id]}
                  checked={ativas[id]}
                  onCheckedChange={(c) => alternar(id, c === true)}
                />
                <span
                  className="agenda-camada-swatch"
                  style={{ borderColor: CAMADA_COR[id], color: CAMADA_COR[id] }}
                  aria-hidden="true"
                >
                  <Icone size={12} strokeWidth={2} />
                </span>
                <span className="agenda-pessoa__nome">{CAMADA_ROTULO[id]}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {ativas.comemorativas && (
        <div className="agenda-camadas__nicho">
          <label htmlFor={nichoId} className="agenda-camadas__nicho-rotulo">
            Nicho
          </label>
          <Select value={nichoKey} onValueChange={onNichoChange}>
            <SelectTrigger id={nichoId} aria-label="Nicho" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NICHE_CALENDARS.map((n) => (
                <SelectItem key={n.key} value={n.key}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
