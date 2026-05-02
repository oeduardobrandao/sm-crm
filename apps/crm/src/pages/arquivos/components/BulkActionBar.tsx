import { ArrowRight, Download, Copy, Trash2, X } from 'lucide-react';

interface BulkActionBarProps {
  count: number;
  onMove: () => void;
  onCopy: () => void;
  onZip: () => void;
  onDelete: () => void;
  onClear: () => void;
  isMoving?: boolean;
  isCopying?: boolean;
  isDeleting?: boolean;
  isZipping?: boolean;
}

export function BulkActionBar({
  count,
  onMove,
  onCopy,
  onZip,
  onDelete,
  onClear,
  isMoving,
  isCopying,
  isDeleting,
  isZipping,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const busy = isMoving || isCopying || isDeleting || isZipping;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--surface-main)] border border-[var(--border-color)] shadow-lg">
      <span className="text-sm font-bold text-[var(--primary-color)] tabular-nums min-w-[24px] text-center">
        {count}
      </span>

      <div className="w-px h-5 bg-[var(--border-color)]" />

      <button
        onClick={onMove}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        Mover
      </button>

      <button
        onClick={onCopy}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <Copy className="h-3.5 w-3.5" />
        Copiar
      </button>

      <button
        onClick={onZip}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[var(--surface-hover)] hover:bg-[var(--surface-darker)] transition-colors disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" />
        ZIP
      </button>

      <button
        onClick={onDelete}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-[rgba(245,90,66,0.1)] text-[var(--danger)] hover:bg-[rgba(245,90,66,0.2)] transition-colors disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </button>

      <div className="w-px h-5 bg-[var(--border-color)]" />

      <button
        onClick={onClear}
        className="p-1 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
        title="Limpar seleção"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
