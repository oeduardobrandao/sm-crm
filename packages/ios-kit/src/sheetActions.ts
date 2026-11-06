import { createContext, useContext } from 'react';

export interface SheetActions {
  /** Closes the sheet (pops its history entry). */
  close: () => void;
  /** Closes the sheet, then runs `fn` once its history entry is gone. Use it for rows that navigate. */
  closeThen: (fn: () => void) => void;
}

export const SheetActionsContext = createContext<SheetActions | null>(null);

/** Inside a `BottomSheet`, `ActionSheet` or `ContextMenu`: close it, optionally then navigate. */
export function useSheetActions(): SheetActions {
  const ctx = useContext(SheetActionsContext);
  if (!ctx) throw new Error('useSheetActions must be used inside a phone sheet');
  return ctx;
}
