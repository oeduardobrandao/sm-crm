import type { PublishState } from './fields';

export interface SeriesFormValues {
  title: string;
  slug: string;
  description: string;
  displayOrder: string;
  status: PublishState;
}

/** Props both series-form bodies (phone and desktop) receive from SeriesDialog. */
export interface SeriesFormViewProps {
  values: SeriesFormValues;
  onChange: (patch: Partial<SeriesFormValues>) => void;
  slugError: string | null;
  isEdit: boolean;
  deleting: boolean;
  onDelete: () => void;
}
