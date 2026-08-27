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
  notes?: string[];
}

/** Export instructions per source. Static copy: no links OUT (external); internal KB links are fine. */
export const SOURCE_GUIDES: SourceGuide[] = [
  {
    id: 'notion',
    label: 'Notion',
    accept: '.zip,.csv',
    hint: 'Um único export "Markdown & CSV" (.zip) da página que lista seus clientes',
    icon: FileText,
    steps: [
      'No Notion, abra a página mais de cima que contém a lista de clientes (a que mostra todos eles, não a página de um cliente só).',
      'Clique em ••• no canto superior direito e escolha "Exportar".',
      'Em "Formato de exportação", escolha "Markdown & CSV".',
      'Marque "Incluir subpáginas": é isso que traz as bases de dados que estão dentro da página.',
      'Se aparecer a opção de incluir arquivos e imagens, escolha não incluir. O zip fica menor e o limite aqui é de 20 MB por arquivo.',
      'Envie aqui o .zip gerado (ou o .csv, se exportou uma base só).',
    ],
    notes: [
      'Exporte uma vez só, a partir da página de cima. Não é preciso exportar cliente por cliente.',
      'Só tabelas e bases de dados (arquivos CSV) são importadas. Textos de páginas e briefings não entram nesta importação.',
    ],
  },
  {
    id: 'trello',
    label: 'Trello',
    accept: '.json',
    hint: 'Um arquivo .json por quadro',
    icon: SquareKanban,
    steps: [
      'A exportação do Trello é feita quadro a quadro. Abra o quadro que quer trazer.',
      'Vá em Menu → Mais → Imprimir e exportar → "Exportar como JSON".',
      'Salve o arquivo .json. Repita para cada quadro (até 5 por importação).',
      'Envie aqui os arquivos .json.',
    ],
    notes: [
      'Tem mais de 5 quadros? Importe os 5 primeiros e repita o assistente para os demais.',
      'Se você tem o export em CSV do Trello Premium, use a origem "Planilha (CSV)".',
    ],
  },
  {
    id: 'clickup',
    label: 'ClickUp',
    accept: '.csv',
    hint: 'Exportação da Lista em CSV, um arquivo por lista',
    icon: ListChecks,
    steps: [
      'No ClickUp, abra a Lista (ou o Espaço) que quer trazer.',
      'Clique em ••• → "Baixar" (ou "Exportar") e escolha CSV, não XLSX.',
      'Repita para cada lista (até 5 por importação).',
      'Envie aqui os arquivos .csv.',
    ],
    notes: ['O formato Excel (.xlsx) não é aceito. Na hora de exportar, escolha CSV.'],
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
