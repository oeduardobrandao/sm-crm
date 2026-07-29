import type { SourceKind } from '@mesaas/import-parsers';
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
}

/** Export instructions per source. Static copy: no screenshots, no links out. */
export const SOURCE_GUIDES: SourceGuide[] = [
  {
    id: 'notion',
    label: 'Notion',
    accept: '.zip,.csv',
    hint: 'Exportação em Markdown & CSV (.zip) ou um CSV isolado',
    icon: FileText,
    steps: [
      'Abra a página ou a base de dados no Notion.',
      'Clique em ••• (canto superior direito) e escolha "Exportar".',
      'Em "Formato de exportação", escolha "Markdown & CSV".',
      'Marque "Incluir subpáginas" e confirme a exportação.',
      'Envie aqui o .zip que o Notion disponibiliza (ou o .csv, se exportou uma base só).',
    ],
  },
  {
    id: 'trello',
    label: 'Trello',
    accept: '.json',
    hint: 'Exportação do quadro em JSON',
    icon: SquareKanban,
    steps: [
      'Abra o quadro no Trello.',
      'Vá em Menu → Mais → Imprimir e exportar → "Exportar como JSON".',
      'Salve o arquivo .json e envie aqui.',
    ],
  },
  {
    id: 'clickup',
    label: 'ClickUp',
    accept: '.csv',
    hint: 'Exportação de Lista ou Espaço em CSV',
    icon: ListChecks,
    steps: [
      'No ClickUp, abra a Lista ou o Espaço que quer trazer.',
      'Clique em ••• → "Baixar" (ou "Exportar") → CSV.',
      'Envie aqui o arquivo .csv.',
    ],
  },
  {
    id: 'csv',
    label: 'Planilha (CSV)',
    accept: '.csv',
    hint: 'Qualquer planilha salva em CSV',
    icon: Table2,
    steps: [
      'No Google Sheets: Arquivo → Fazer download → Valores separados por vírgula (.csv).',
      'No Excel: Arquivo → Salvar como → CSV.',
      'A primeira linha do arquivo precisa conter os títulos das colunas.',
      'Envie aqui o arquivo .csv.',
    ],
  },
];

export const sourceGuide = (id: SourceKind): SourceGuide =>
  SOURCE_GUIDES.find((s) => s.id === id) ?? SOURCE_GUIDES[3];
