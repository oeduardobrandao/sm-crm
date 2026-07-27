// Wire contract for the data-import edge function.
// Mirrors docs/superpowers/plans/2026-07-27-data-import-wizard.md ("Shared
// contracts" section, verbatim). Deliberately independent of
// packages/import-parsers/src/types.ts: edge function code must not import
// from packages/ — deploy bundling only follows paths under
// supabase/functions/.

export type ClienteRef = { type: "existing"; clienteId: number } | { type: "created"; sourceKey: string };

export interface CommitClienteRow {
  kind: "cliente";
  sourceKey: string;
  nome: string;
  email?: string;
  telefone?: string;
  especialidade?: string;
  valorMensal?: number;
  notionPageUrl?: string;
  merge?: { clienteId: number }; // fill-only-empty-fields merge target
}
export interface CommitContainerRow {
  kind: "container";
  sourceKey: string; // "container:<clienteKey>:<n>"
  clienteRef: ClienteRef;
  titulo: string;
}
export interface CommitTemplateRow {
  kind: "template";
  sourceKey: string; // "template:<boardId>"
  nome: string;
  etapas: string[]; // etapa names, in board column order
}
export interface CommitPostRow {
  kind: "post";
  sourceKey: string;
  containerKey: string; // sourceKey of a CommitContainerRow
  titulo: string;
  conteudo: Record<string, unknown> | null;
  conteudoPlain: string;
  tipo: "feed" | "reels" | "stories" | "carrossel";
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  provenance: Record<string, unknown>;
}
export interface CommitEntregaRow {
  kind: "entrega";
  sourceKey: string;
  templateKey: string; // sourceKey of a CommitTemplateRow
  clienteRef: ClienteRef;
  titulo: string;
  etapaIndex: number; // 0-based index of current etapa
  dueDate: string | null;
  provenance: Record<string, unknown>;
}
export interface CommitIdeiaRow {
  kind: "ideia";
  sourceKey: string;
  clienteRef: ClienteRef;
  titulo: string;
  descricao: string;
  provenance: Record<string, unknown>;
}
export type CommitRow =
  | CommitClienteRow
  | CommitContainerRow
  | CommitTemplateRow
  | CommitPostRow
  | CommitEntregaRow
  | CommitIdeiaRow;

// Wire contract for the "analyze" action: the browser-side parser summarizes
// each parsed collection (column headers, list/board-column names, row count,
// and a FEW sample cell values — never the full roster) and sends it alongside
// the deterministic heuristic mapping proposal for optional Gemini refinement.
// See _shared/import-ai.ts for the validation this shape is defended by.
export interface AnalyzeCollectionSummary {
  collectionId: string;
  name: string;
  source: string;
  columns: string[];
  listNames: string[];
  rowCount: number;
  sampleCells: Record<string, string[]>; // per column, at most 3 sample values
}
export interface AnalyzeSummary {
  collections: AnalyzeCollectionSummary[];
}
export interface WireCollectionMapping {
  collectionId: string;
  destination: "clientes" | "posts" | "entregas" | "ideias" | "ignorar";
  columnRoles: Record<string, string>;
  statusMap: Record<string, string>;
  clientAssignment: { mode: "column"; column: string } | { mode: "fixed"; clienteNome: string };
}
export interface WireMappingProposal {
  collections: WireCollectionMapping[];
}
