// Acesso por cliente for the file library (file-manage, file-upload-url, file-upload-finalize).
// Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md.
//
// A folder belongs to the client of its nearest typed ancestor (itself included):
//   source_type 'client' | 'client_reports' -> source_id is the cliente_id;
//   'workflow' -> workflows.cliente_id;  'post' -> workflow_posts.cliente_id;
//   'root_clients' / untyped (user folder) -> keep walking up; the root -> null (workspace-level).
// A file belongs to its folder's client; a post-reference file (attached_to) to its post's client.
// Workspace-level items (null client) stay visible to a restricted member. Operations over a folder's
// whole subtree (zip, copy, delete, move) also need every typed folder below it to belong to a
// visible client: a workspace-level folder can hold hidden client subtrees (the "Clientes" root does).
//
// This mapping mirrors the folder tree the sync triggers build (folder_sync_cliente/workflow/post).
// The DB policies of Task 4c own the authoritative definition; keep the two in step.

import { type ClientScope, hasClientAccess } from "./client-scope.ts";
import { chunk, fetchAllRows } from "./paginate.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => any };

/** Sentinel for "not in this workspace / does not exist": the caller answers its not-found. */
export const NOT_IN_WORKSPACE = Symbol("not_in_workspace");
export type ClientOf = number | null | typeof NOT_IN_WORKSPACE;

async function clienteOfTyped(db: Db, type: string, sourceId: number, contaId: string): Promise<number | null> {
  if (type === "client" || type === "client_reports") return sourceId;
  const table = type === "workflow" ? "workflows" : "workflow_posts";
  const { data, error } = await db.from(table).select("cliente_id").eq("id", sourceId).eq("conta_id", contaId)
    .maybeSingle();
  if (error) throw new Error(`file scope: ${table} read failed: ${error.message ?? "unknown"}`);
  // A typed folder whose source row is gone is treated as hidden-by-default: no client = workspace
  // level would expose it, so fall back to a client id nobody is assigned (-1).
  return (data as { cliente_id?: number } | null)?.cliente_id ?? -1;
}

/** The client a folder belongs to (null = workspace-level), or NOT_IN_WORKSPACE. */
export async function folderClienteId(db: Db, folderId: number, contaId: string): Promise<ClientOf> {
  const { data: crumbs, error } = await db.rpc("folder_breadcrumbs", { p_folder_id: folderId });
  if (error) throw new Error(`file scope: breadcrumbs failed: ${error.message ?? "unknown"}`);
  const ids = ((crumbs ?? []) as { id: number }[]).map((c) => Number(c.id)).filter(Number.isInteger);
  if (ids.length === 0) return NOT_IN_WORKSPACE;
  const { data: rows, error: rowsError } = await db.from("folders").select("id, conta_id, source_type, source_id")
    .in("id", ids);
  if (rowsError) throw new Error(`file scope: folders read failed: ${rowsError.message ?? "unknown"}`);
  const byId = new Map(
    ((rows ?? []) as { id: number; conta_id: string; source_type: string | null; source_id: number | null }[])
      .map((r) => [Number(r.id), r]),
  );
  const self = byId.get(folderId);
  if (!self || self.conta_id !== contaId) return NOT_IN_WORKSPACE;
  // folder_breadcrumbs orders root first, the folder itself last: walk from the folder up.
  for (const id of [...ids].reverse()) {
    const f = byId.get(id);
    if (!f || f.conta_id !== contaId) return NOT_IN_WORKSPACE;
    if (f.source_type && f.source_type !== "root_clients" && f.source_id != null) {
      return await clienteOfTyped(db, f.source_type, Number(f.source_id), contaId);
    }
  }
  return null;
}

/** The client a file belongs to (null = workspace-level), or NOT_IN_WORKSPACE. */
export async function fileClienteId(db: Db, fileId: number, contaId: string): Promise<ClientOf> {
  const { data: file, error } = await db.from("files").select("conta_id, folder_id, attached_to").eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`file scope: files read failed: ${error.message ?? "unknown"}`);
  if (!file || file.conta_id !== contaId) return NOT_IN_WORKSPACE;
  if (file.attached_to != null) {
    const { data: ref } = await db.from("post_references").select("post_id").eq("file_id", fileId)
      .eq("conta_id", contaId).maybeSingle();
    if (!ref?.post_id) return -1;
    return await clienteOfTyped(db, "post", Number(ref.post_id), contaId);
  }
  if (file.folder_id == null) return null;
  return await folderClienteId(db, Number(file.folder_id), contaId);
}

/** Read / write-into check for one item: a workspace-level item passes. NOT_IN_WORKSPACE passes
 * too, so the route answers its own not-found for it. */
export function itemVisible(scope: ClientScope, clienteId: ClientOf): boolean {
  if (clienteId === NOT_IN_WORKSPACE) return true;
  return clienteId === null || hasClientAccess(scope, clienteId, false);
}

type TypedRow = { id: number | string; source_type?: string | null; source_id?: number | string | null };

function isTypedRow(r: TypedRow): boolean {
  return !!r.source_type && r.source_type !== "root_clients" && r.source_id != null;
}

/** folder id -> cliente_id for typed folder rows, in batch (one read per source table). A typed row
 * whose source row is gone maps to -1, a client nobody is assigned (hidden by default). */
async function typedRowClients(db: Db, rows: TypedRow[], contaId: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const bySource: Record<"workflows" | "workflow_posts", TypedRow[]> = { workflows: [], workflow_posts: [] };
  for (const r of rows) {
    if (!isTypedRow(r)) continue;
    if (r.source_type === "client" || r.source_type === "client_reports") out.set(Number(r.id), Number(r.source_id));
    else if (r.source_type === "workflow") bySource.workflows.push(r);
    else if (r.source_type === "post") bySource.workflow_posts.push(r);
    else out.set(Number(r.id), -1); // unknown typed folder: fail closed
  }
  for (const table of ["workflows", "workflow_posts"] as const) {
    const list = bySource[table];
    if (list.length === 0) continue;
    const sourceIds = [...new Set(list.map((r) => Number(r.source_id)))];
    const clientOf = new Map<number, number | null>();
    // Chunked so the URL stays short; each chunk is at most 500 unique ids, under the row cap. A
    // row that does not come back maps to -1 (hidden), so a short read fails closed.
    for (const part of chunk(sourceIds)) {
      const { data, error } = await db.from(table).select("id, cliente_id").eq("conta_id", contaId).in("id", part);
      if (error) throw new Error(`file scope: ${table} batch read failed: ${error.message ?? "unknown"}`);
      for (const x of (data ?? []) as { id: number; cliente_id: number | null }[]) {
        clientOf.set(Number(x.id), x.cliente_id);
      }
    }
    for (const r of list) out.set(Number(r.id), clientOf.get(Number(r.source_id)) ?? -1);
  }
  return out;
}

const MAX_TREE_DEPTH = 64;

/** True when any typed folder BELOW `folderId` belongs to a client the scope hides. Used for
 * operations over a whole subtree (zip, copy, delete, move): the folder itself must be visible
 * (checked by the caller), and a visible folder that holds a hidden client's folder answers
 * CLIENT_SCOPE_MESSAGE. Walks the tree one level per read; throws on read errors. */
export async function subtreeHasHiddenClient(
  db: Db,
  scope: ClientScope,
  folderId: number,
  contaId: string,
): Promise<boolean> {
  if (scope.all) return false;
  const seen = new Set<number>([folderId]);
  const typed: TypedRow[] = [];
  let frontier = [folderId];
  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth >= MAX_TREE_DEPTH) throw new Error("file scope: folder tree too deep");
    // Each level is read in full: the frontier is chunked (URL length) and every chunk is paged
    // with .range() until an empty page (PostgREST truncates at its row cap without an error). A
    // page error throws, and the caller answers a generic 500: never "nothing hidden below".
    const level: TypedRow[] = [];
    for (const part of chunk(frontier)) {
      level.push(...await fetchAllRows<TypedRow>((from, to) =>
        db.from("folders").select("id, source_type, source_id").eq("conta_id", contaId).in("parent_id", part)
          .order("id", { ascending: true }).range(from, to)
      ));
    }
    const next: number[] = [];
    for (const r of level) {
      const id = Number(r.id);
      if (!Number.isInteger(id) || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      if (isTypedRow(r)) typed.push(r);
    }
    frontier = next;
  }
  const clients = await typedRowClients(db, typed, contaId);
  return [...clients.values()].some((c) => !hasClientAccess(scope, c, false));
}

/** Folder rows of a listing a restricted member may see: typed folders (client, client_reports,
 * workflow, post) of hidden clients go; workflow/post rows are resolved in batch. */
export async function visibleFolderRows<T extends TypedRow>(
  db: Db,
  rows: T[] | null | undefined,
  scope: ClientScope,
  contaId: string,
): Promise<T[]> {
  const list = rows ?? [];
  if (scope.all) return list;
  const clients = await typedRowClients(db, list, contaId);
  return list.filter((r) => {
    const c = clients.get(Number(r.id));
    return c === undefined || hasClientAccess(scope, c, false);
  });
}
