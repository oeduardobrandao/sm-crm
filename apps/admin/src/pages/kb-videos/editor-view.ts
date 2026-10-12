import type { RefObject } from 'react';
import type { KbVideo } from '../../lib/api';
import type { BadgeSpec } from '../../lib/kb-video-status';
import type { PublishState } from './fields';

export interface EditorValues {
  title: string;
  slug: string;
  description: string;
  seriesId: string;
  articleId: string;
  displayOrder: string;
  status: PublishState;
}

export interface TitledOption {
  id: string;
  title: string;
}

/** What KbVideoEditorPage hands to the phone and desktop editors. Data and handlers only. */
export interface KbVideoEditorViewProps {
  isEdit: boolean;
  video: KbVideo | undefined;
  values: EditorValues;
  onChange: (patch: Partial<EditorValues>) => void;
  seriesOptions: TitledOption[];
  articleOptions: TitledOption[];
  slugError: string | null;
  /** The "Publicado" status is refused until the file is ready (and it isn't published yet). */
  publishLocked: boolean;
  badge: BadgeSpec | null;
  /** Upload progress 0..1, or null when no upload is in flight. */
  progress: number | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  onCancelUpload: () => void;
  /** A background refetch (pending poll) is running. */
  fetching: boolean;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
  onDelete: () => void;
  deleting: boolean;
}

export const PUBLISH_LOCKED_HINT =
  'Só é possível publicar depois que o vídeo terminar de processar.';
