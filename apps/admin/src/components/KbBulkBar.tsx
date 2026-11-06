import { Eye, EyeOff, X } from 'lucide-react';
import type { PublishStatus } from '../lib/kb-bulk';
import { useIsPhone } from '../hooks/useIsPhone';
import { SelectionBar } from './shell/SelectionBar';
import { Button } from './ui/button';

interface Props {
  count: number;
  pending: boolean;
  onSetStatus: (status: PublishStatus) => void;
  onClear: () => void;
}

/**
 * Bulk publish/unpublish actions for the Central de Ajuda lists, on the shell's `SelectionBar`:
 * a floating glass bar centred on the content on desktop, the kit's bottom bar above the tab bar
 * on phones. Renders nothing with no selection. Render it outside any Card/GlassPanel (their
 * glass filter would trap the fixed position) and after the list (the phone bar leaves an
 * in-flow spacer where it is rendered).
 *
 * On phones the bar has to fit 375pt next to the count, so the actions drop their icons and
 * "Limpar seleção" stays out: both lists' "Concluir" header button clears the selection there.
 */
export function KbBulkBar({ count, pending, onSetStatus, onClear }: Props) {
  const isPhone = useIsPhone();
  const size = isPhone ? 'lg' : 'default';
  const phonePill = isPhone ? 'h-10 px-4 text-[15px]' : undefined;
  return (
    <SelectionBar count={count} ariaLabel="Ações em massa">
      <Button
        size={size}
        className={phonePill}
        disabled={pending}
        onClick={() => onSetStatus('published')}
      >
        {!isPhone && <Eye aria-hidden="true" />}
        {`Publicar ${count}`}
      </Button>
      <Button
        size={size}
        variant="secondary"
        className={phonePill}
        disabled={pending}
        onClick={() => onSetStatus('draft')}
      >
        {!isPhone && <EyeOff aria-hidden="true" />}
        Despublicar
      </Button>
      {!isPhone && (
        <Button variant="secondary" disabled={pending} onClick={onClear}>
          <X aria-hidden="true" />
          Limpar seleção
        </Button>
      )}
    </SelectionBar>
  );
}
