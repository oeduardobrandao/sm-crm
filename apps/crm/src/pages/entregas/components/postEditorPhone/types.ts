import type { ReactNode } from 'react';
import type { PostProcessEvent } from '../../../../store';

/** One row of the editor's "…" menu (an ActionSheet). */
export interface PhoneMenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Runs inside the tap (clipboard writes need the gesture on iOS Safari). */
  immediate?: boolean;
}

/**
 * What the host (WorkflowDrawer / StandalonePostDrawer) adds to the phone editor: the
 * header's back and subtitle, its own "…" actions, and the host-level commands that
 * live on the desktop row or drawer header and would otherwise be unreachable from a
 * full-screen editor.
 */
export interface PhoneEditorChrome {
  onBack: () => void;
  /** "Café Aurora · Posts de outubro". */
  subtitle?: ReactNode;
  /** The client's name, for the conversation bubbles ("Café Aurora aprovou o post"). */
  clientName?: string | null;
  /** A content save is pending or in flight ("Salvando…" instead of "Salvo"). */
  saving?: boolean;
  /** Host actions for the "…" menu, in display order. The editor appends its own
   *  (Histórico de versões, Histórico do post). Destructive ones go last. */
  menuActions: PhoneMenuAction[];
  /** Fluxo drawer: the header's "Enviar ao cliente (N)" for this flow's internally
   *  approved posts (same `sendPostsToCliente` command as desktop). */
  sendToClient?: { count: number; sending: boolean; onSend: () => void } | null;
  /** The row's "aguardando agendamento automático" badge (spec peça 3). */
  autoSchedule?: { needsDate: boolean; onClick: () => void } | null;
  /** Process events for "Histórico do post" (the desktop row's timeline popover). */
  processEvents?: PostProcessEvent[];
  /** Aviso entre o cabeçalho e as abas (ex.: banner de rascunho do processo individual). */
  banner?: ReactNode;
}
