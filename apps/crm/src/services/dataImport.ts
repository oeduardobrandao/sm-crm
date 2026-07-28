// Frontend client for the `data-import` edge function.
//
// The wire types below MIRROR supabase/functions/data-import/types.ts — the
// frontend cannot import from supabase/functions/ (Deno sources, `.ts`
// specifiers, never bundled by Vite). That file is the source of truth: any
// change there needs the same change here.
import { supabase } from '@/lib/supabase';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/data-import`;

export type ClienteRef =
  | { type: 'existing'; clienteId: number }
  | { type: 'created'; sourceKey: string };

export type Provenance = {
  source: string;
  collectionId: string;
  sourceKey: string;
  sourceUrl: string | null;
  cells: Record<string, string>;
};

export interface CommitClienteRow {
  kind: 'cliente';
  sourceKey: string;
  nome: string;
  email?: string;
  telefone?: string;
  especialidade?: string;
  valorMensal?: number;
  notionPageUrl?: string;
  /** fill-only-empty-fields merge target; undo never deletes a merged cliente. */
  merge?: { clienteId: number };
  provenance?: Provenance;
}
export interface CommitContainerRow {
  kind: 'container';
  sourceKey: string; // "container:<clienteKey>:<n>"
  clienteRef: ClienteRef;
  titulo: string;
}
export interface CommitTemplateRow {
  kind: 'template';
  sourceKey: string; // "template:<collectionId>"
  nome: string;
  etapas: string[];
}
export interface CommitPostRow {
  kind: 'post';
  sourceKey: string;
  containerKey: string;
  titulo: string;
  conteudo: Record<string, unknown> | null;
  conteudoPlain: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  provenance: Provenance;
}
export interface CommitEntregaRow {
  kind: 'entrega';
  sourceKey: string;
  templateKey: string;
  clienteRef: ClienteRef;
  titulo: string;
  etapaIndex: number;
  dueDate: string | null;
  provenance: Provenance;
}
export interface CommitIdeiaRow {
  kind: 'ideia';
  sourceKey: string;
  clienteRef: ClienteRef;
  titulo: string;
  descricao: string;
  provenance: Provenance;
}
export type CommitRow =
  | CommitClienteRow
  | CommitContainerRow
  | CommitTemplateRow
  | CommitPostRow
  | CommitEntregaRow
  | CommitIdeiaRow;

export interface AnalyzeCollectionSummary {
  collectionId: string;
  name: string;
  source: string;
  columns: string[];
  listNames: string[];
  rowCount: number;
  sampleCells: Record<string, string[]>;
}
export interface AnalyzeSummary {
  collections: AnalyzeCollectionSummary[];
}

export interface PreviewResult {
  counts: Record<string, number>;
  warnings: string[];
  limits: {
    maxClients: number | null;
    maxWorkflowTemplates: number | null;
    maxPostsPerWorkflow: number | null;
  };
}
export interface CommitRowResult {
  sourceKey: string;
  table: string | null;
  rowId: string | null;
  skipped: boolean;
  failed?: boolean;
  /** 'error' or `plan_limit:<limit_key>` when a plan-count trigger refused the row. */
  reason?: string;
}
export interface CommitResult {
  results: CommitRowResult[];
}
export interface UndoResult {
  deleted: number;
  /** Row ids undo deliberately KEPT, by reason. Each must be shown to the user. */
  skippedPublished: string[];
  skippedWorkflows: string[];
  skippedTemplates: string[];
  skippedClientes: string[];
}

/** Carries the server's `error` string so callers can map it to pt-BR copy. */
export class ImportApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ImportApiError';
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  upgrade_required: 'A importação de dados não está disponível no seu plano.',
  'Job not found': 'Não encontramos esta importação.',
  'Already undone': 'Esta importação já foi desfeita.',
  'Undo in progress': 'Já existe um "desfazer" em andamento para esta importação.',
  'Undo window expired': 'O prazo de 7 dias para desfazer esta importação já passou.',
  'Invalid source': 'Origem inválida.',
  'Invalid payload': 'Não conseguimos montar os dados desta importação.',
  'Preview batch too large': 'O arquivo tem linhas demais para a prévia.',
  'Commit batch too large': 'O lote enviado é grande demais.',
  Unauthorized: 'Sua sessão expirou. Entre novamente.',
};

/** User-facing pt-BR message for any error thrown by this module. */
export function friendlyImportError(err: unknown): string {
  if (err instanceof ImportApiError) {
    return ERROR_MESSAGES[err.code] ?? 'Falha na importação. Tente novamente.';
  }
  if (err instanceof Error && err.message === 'Sessão expirada') return err.message;
  return 'Falha na importação. Tente novamente.';
}

async function post<T>(action: string, body: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const res = await fetch(`${BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ImportApiError(err.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const startImport = (source: string, totalRows: number) =>
  post<{ jobId: number }>('start', { source, totalRows });

export const analyzeImport = (summary: AnalyzeSummary, heuristic: unknown) =>
  post<{ proposal: unknown | null }>('analyze', { summary, heuristic });

export const previewImport = (rows: CommitRow[]) => post<PreviewResult>('preview', { rows });

export const commitBatch = (jobId: number, rows: CommitRow[], final: boolean) =>
  post<CommitResult>('commit', { jobId, rows, final });

export const undoImport = (jobId: number) => post<UndoResult>('undo', { jobId });
