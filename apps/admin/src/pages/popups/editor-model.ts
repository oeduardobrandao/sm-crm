import type { DragEndEvent } from '@dnd-kit/core';
import {
  SECONDARY_LABEL_ERROR_PREFIX,
  type PageForm,
  type PopupFormErrors,
  type PopupFormState,
} from '../popup-form';
import type { PreviewTheme } from './popup-preview';

/**
 * `validateForm` põe o erro do rótulo secundário em `errors.cta` (mesmo campo do CTA global).
 * Só a exibição separa os dois, para o erro aparecer ao lado do campo certo.
 */
export function splitCtaError(errors: PopupFormErrors | null): {
  cta?: string;
  secondary?: string;
} {
  const msg = errors?.cta;
  if (!msg) return {};
  return msg.startsWith(SECONDARY_LABEL_ERROR_PREFIX) ? { secondary: msg } : { cta: msg };
}

/** Seções do editor. `preview` só existe no iPhone; no desktop a prévia é uma coluna fixa. */
export type EditorSection = 'pages' | 'settings' | 'preview';

export interface NamedOption {
  id: string;
  name: string;
}

export const STATUSES = ['draft', 'active', 'archived'] as const;
export const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  archived: 'Arquivado',
};

/**
 * Tudo que as vistas do editor (desktop e iPhone) leem e chamam. O estado vive na página
 * (PopupsPage), então cruzar 768px com a folha aberta remonta a vista sem perder o rascunho.
 */
export interface PopupEditorModel {
  isEditing: boolean;
  form: PopupFormState;
  page: PageForm;
  pageIndex: number;
  errors: PopupFormErrors | null;
  section: EditorSection;
  setSection: (section: EditorSection) => void;
  theme: PreviewTheme;
  setTheme: (theme: PreviewTheme) => void;
  imageUrls: Record<string, string> | undefined;
  uploading: boolean;
  plans: NamedOption[] | undefined;
  workspaces: NamedOption[] | undefined;
  /** CTA global completo (rótulo e URL). */
  hasCta: boolean;
  /** Algum CTA, global ou de página. */
  anyCta: boolean;
  /** A última página termina com CTA (o placeholder do secundário depende disso). */
  lastHasCta: boolean;
  secondaryLabel: string;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  selectPage: (index: number) => void;
  addPage: () => void;
  removePage: (index: number) => void;
  dragEnd: (e: DragEndEvent) => void;
  updatePage: (patch: Partial<PageForm>) => void;
  /** Campos do popup. `clearErrors` repete o comportamento de hoje do gatilho e dos dias. */
  patchForm: (patch: Partial<PopupFormState>, opts?: { clearErrors?: boolean }) => void;
  setRequireAck: (on: boolean) => void;
  upload: (file: File) => void;
}
