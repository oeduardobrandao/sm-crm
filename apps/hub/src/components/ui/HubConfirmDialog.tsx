import { HubDialog } from './HubDialog';

interface HubConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Red confirm button, for removals. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Styled replacement for window.confirm: bottom sheet on phones, dialog on md+. Cancel
 * comes first in the DOM (shown last on phones via flex-col-reverse), so Radix focuses the
 * safe choice on open.
 */
export function HubConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: HubConfirmDialogProps) {
  return (
    <HubDialog open={open} onRequestClose={onCancel} title={title}>
      <div className="hub-bg-card w-full self-end md:self-center md:w-[min(400px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold hub-txt">{title}</h2>
          {description && <p className="text-[13.5px] hub-tx2">{description}</p>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 min-h-[44px] rounded-[4px] hub-btn-secondary text-[13px] font-semibold"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2.5 min-h-[44px] rounded-[4px] text-[13px] font-semibold ${
              destructive ? 'bg-[#b0472e] hover:bg-[#963c27] text-white' : 'hub-btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </HubDialog>
  );
}
