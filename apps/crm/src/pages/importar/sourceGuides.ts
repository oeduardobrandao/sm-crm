import type { SourceKind } from '@mesaas/import-parsers';
import { i18n } from '@mesaas/i18n';
import { FileText, ListChecks, SquareKanban, Table2, type LucideIcon } from 'lucide-react';

export interface SourceGuide {
  id: SourceKind;
  label: string;
  /** `accept` for the file input — a hint, never the validation. */
  accept: string;
  hint: string;
  /**
   * Each icon describes the SHAPE of the data being imported — a document, a
   * board, a task list, a table — not the vendor's logo. lucide-react is the
   * only icon set this app uses and it carries no Notion/ClickUp brand marks,
   * so the alternative would be hand-inlining third-party trademarks. Shape
   * icons also stay consistent with each other and keep working if a vendor
   * rebrands.
   */
  icon: LucideIcon;
  steps: string[];
  notes?: string[];
}

const TXT = (id: SourceKind, field: 'label' | 'hint') =>
  i18n.t(`importWizard:guides.${id}.${field}`);
const LIST = (id: SourceKind, field: 'steps' | 'notes') =>
  i18n.t(`importWizard:guides.${id}.${field}`, { returnObjects: true }) as unknown as string[];

/**
 * Builds a guide whose copy is resolved through i18n on every read (getters), so it
 * follows the UI language instead of freezing at module load.
 */
function guide(id: SourceKind, accept: string, icon: LucideIcon, withNotes: boolean): SourceGuide {
  return {
    id,
    accept,
    icon,
    get label() {
      return TXT(id, 'label');
    },
    get hint() {
      return TXT(id, 'hint');
    },
    get steps() {
      return LIST(id, 'steps');
    },
    get notes() {
      return withNotes ? LIST(id, 'notes') : undefined;
    },
  };
}

/** Export instructions per source. Static copy: no links OUT (external); internal KB links are fine. */
export const SOURCE_GUIDES: SourceGuide[] = [
  guide('notion', '.zip,.csv', FileText, true),
  guide('trello', '.json', SquareKanban, true),
  guide('clickup', '.csv', ListChecks, true),
  guide('csv', '.csv', Table2, false),
];

export const sourceGuide = (id: SourceKind): SourceGuide =>
  SOURCE_GUIDES.find((s) => s.id === id) ?? SOURCE_GUIDES[3];
