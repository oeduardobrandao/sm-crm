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
