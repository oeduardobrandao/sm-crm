import { createPortal } from 'react-dom';
import { Eye, EyeOff, X } from 'lucide-react';
import type { PublishStatus } from '../lib/kb-bulk';
import { Button } from './ui/button';

interface Props {
  count: number;
  pending: boolean;
  onSetStatus: (status: PublishStatus) => void;
  onClear: () => void;
}

/**
 * Bulk publish/unpublish toolbar for the Central de Ajuda lists. Renders nothing with no selection.
 * Floats over the page (portaled to body, so no transformed ancestor can trap the fixed position)
 * instead of sitting in the flow: appearing in the flow would push the list down under the cursor
 * right after the first checkbox click. From md up it centres on the content column beside
 * AdminLayout's 220px sidebar, and z-30 keeps it under the mobile drawer and its backdrop.
 */
export function KbBulkBar({ count, pending, onSetStatus, onClear }: Props) {
  if (count === 0) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Ações em massa"
      className="glass-surface fixed bottom-6 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 md:left-[calc(50%+110px)] md:w-[calc(100%-220px-4rem)] flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg"
    >
      <span className="mr-auto text-sm font-medium tabular-nums" aria-live="polite">
        {count === 1 ? '1 selecionado' : `${count} selecionados`}
      </span>
      <Button size="sm" disabled={pending} onClick={() => onSetStatus('published')}>
        <Eye />
        Publicar
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onSetStatus('draft')}>
        <EyeOff />
        Despublicar
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onClear}>
        <X />
        Limpar seleção
      </Button>
    </div>,
    document.body,
  );
}
