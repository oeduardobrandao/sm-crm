import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgendaRegra } from '@/store/agenda';
import { descreverRegra, opcoesRepetir, type RepetirOpcaoId } from './agendaLogic';

/** Selected value while a custom rule is active; "Personalizar…" stays a
 *  separate item that only opens the dialog. */
const REGRA_ATUAL = '__regra_atual';

interface RepetirSelectProps {
  inicio: Date;
  repetir: RepetirOpcaoId;
  regra: AgendaRegra | null;
  /** A preset was picked (never 'personalizado'). */
  onEscolher: (id: RepetirOpcaoId, regra: AgendaRegra | null) => void;
  onPersonalizar: () => void;
  disabled?: boolean;
}

/** Repetir presets derived from the start date (spec: RepetirSelect). */
export function RepetirSelect({
  inicio,
  repetir,
  regra,
  onEscolher,
  onPersonalizar,
  disabled,
}: RepetirSelectProps) {
  const opcoes = opcoesRepetir(inicio);
  const presets = opcoes.filter((o) => o.id !== 'personalizado');
  const custom = repetir === 'personalizado' && regra !== null;

  return (
    <Select
      value={custom ? REGRA_ATUAL : repetir}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === REGRA_ATUAL) return;
        if (v === 'personalizado') {
          onPersonalizar();
          return;
        }
        const op = presets.find((o) => o.id === v);
        if (op) onEscolher(op.id, op.regra);
      }}
    >
      <SelectTrigger aria-label="Repetir" className="w-full sm:w-[300px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {presets.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
        {custom && <SelectItem value={REGRA_ATUAL}>{descreverRegra(regra, inicio)}</SelectItem>}
        <SelectSeparator />
        <SelectItem value="personalizado">Personalizar…</SelectItem>
      </SelectContent>
    </Select>
  );
}
