export type SourceKind = 'trello' | 'notion' | 'clickup' | 'csv';

export interface ImportRow {
  key: string; // stable source key: trello card id, "<file>:<rowIndex>", clickup task id
  cells: Record<string, string>; // header -> raw string value
  listName?: string; // kanban column / status origin (Trello list, ClickUp status)
  dueDate?: string | null; // ISO string when the source has a first-class date
  description?: string; // long-form body (markdown or plain text)
  checklist?: string[]; // flattened checklist item texts
  sourceUrl?: string; // deep link back to the source item, when the source has one
}

export interface ImportCollection {
  id: string; // board id or filename
  name: string; // board/database/file display name
  source: SourceKind;
  columns: string[]; // ordered union of row cell keys
  listNames: string[]; // distinct listName values in row order
  rows: ImportRow[];
}

export interface ImportBundle {
  source: SourceKind;
  collections: ImportCollection[];
  warnings: string[];
}

export type Destination = 'clientes' | 'posts' | 'entregas' | 'ideias' | 'ignorar';

export const POST_STATUS_TARGETS = [
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'postado',
] as const;
export type PostStatusTarget = (typeof POST_STATUS_TARGETS)[number];

export interface ColumnRoles {
  title?: string;
  date?: string;
  status?: string;
  client?: string;
  caption?: string;
  email?: string;
  phone?: string;
  monthlyValue?: string;
  specialty?: string;
  tipo?: string;
  url?: string; // -> Cliente.notion_page_url when destination === 'clientes'
}

export interface CollectionMapping {
  collectionId: string;
  destination: Destination;
  columnRoles: ColumnRoles;
  statusMap: Record<string, PostStatusTarget>; // source status/list -> post status
  clientAssignment: { mode: 'column'; column: string } | { mode: 'fixed'; clienteNome: string };
}

export interface MappingProposal {
  collections: CollectionMapping[];
}
