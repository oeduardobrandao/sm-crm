import { useEffect, useState, type ReactNode } from 'react';
import { ActionSheet, type ActionSheetAction } from './ActionSheet';

export interface PhoneConfirmSheetProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  actions: ActionSheetAction[];
  /** Dismissed without a choice (Cancelar, backdrop, Escape, Back). */
  onCancel: () => void;
  cancelLabel?: string;
}

/**
 * The desktop confirmation dialogs' phone face: an action sheet with the same copy
 * and the same callbacks. The parent keeps owning `open`; a picked action closes the
 * sheet right away (its history entry pops first) and only then runs, so the parent
 * still reads its own state when the confirm handler fires. `onCancel` runs only for
 * a real dismissal, never on the way to a confirm.
 */
export function PhoneConfirmSheet({
  open,
  title,
  message,
  actions,
  onCancel,
  cancelLabel,
}: PhoneConfirmSheetProps) {
  // Closed locally after a choice while the parent's `open` is still true (some
  // confirm handlers only clear their target after an await).
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!open) setHidden(false);
  }, [open]);
  // A new target opened while the previous confirm was still settling.
  const sessionKey = `${String(title)}|${typeof message === 'string' ? message : ''}`;
  useEffect(() => {
    setHidden(false);
  }, [sessionKey]);

  return (
    <ActionSheet
      open={open && !hidden}
      onOpenChange={(next) => {
        if (!next) setHidden(true);
      }}
      onDismiss={onCancel}
      title={title}
      message={message}
      actions={actions}
      cancelLabel={cancelLabel}
    />
  );
}
