// Acesso por cliente for the file library (file-manage, file-upload-url, file-upload-finalize, file-zip).
// Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md. Mirrors migration C3
// (20261115000005_acesso_por_cliente_c3_arquivos.sql, folder_row_cliente_id / folder_cliente_id and
// the files / folders / post_file_links policies); keep the two in step.
//
// A folder belongs to the client of its nearest typed ancestor (itself included):
//   source_type 'client' | 'client_reports' -> source_id is the cliente_id;
//   'workflow' -> workflows.cliente_id;  'post' -> workflow_posts.cliente_id;
//   'root_clients' / untyped (user folder) -> keep walking up; the root -> null (no client).
// A file belongs to its folder's client (no folder = no client).
//
// For a restricted member (C3):
//   folder read  = its client is assigned, or it is the "Clientes" root (navigation only).
//                  Any other folder with no client is hidden.
//   folder write = its client is assigned (the Clientes root and client-less folders: never).
//   file read    = uploaded by him, or its folder's client is assigned, or linked to a post he sees
//                  (his own post in a hidden client included).
//   file delete / move out = its folder's client is assigned, or (his upload AND no client).
//   file insert / move in  = the destination folder is writable.
// Operations over a folder's whole subtree (zip, copy, delete, move) also need every typed folder
// below it to belong to an assigned client.

import { type ClientScope, hasClientAccess, rowVisibility } from "./client-scope.ts";
import { chunk, fetchAllRowsKeyset } from "./paginate.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => any };

/** Sentinel for "not in this workspace / does not exist": the caller answers its not-found. */
export const NOT_IN_WORKSPACE = Symbol("not_in_workspace");
export type ClientOf = number | null | typeof NOT_IN_WORKSPACE;

const MAX_TREE_DEPTH = 64;
const SUBTREE_PAGE = 1000;

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

/** Where a folder sits: its client (null = none) and whether it is the "Clientes" root itself. */
export interface FolderInfo {
  client: number | null;
  rootClients: boolean;
}

/** The client of a folder and whether it is the Clientes root, or NOT_IN_WORKSPACE. */
export async function folderInfo(db: Db, folderId: number, contaId: string): Promise<FolderInfo | typeof NOT_IN_WORKSPACE> {
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
  const rootClients = self.source_type === "root_clients";
  // folder_breadcrumbs orders root first, the folder itself last: walk from the folder up.
  for (const id of [...ids].reverse()) {
    const f = byId.get(id);
    if (!f || f.conta_id !== contaId) return NOT_IN_WORKSPACE;
    if (f.source_type && f.source_type !== "root_clients" && f.source_id != null) {
      return { client: await clienteOfTyped(db, f.source_type, Number(f.source_id), contaId), rootClients };
    }
  }
  return { client: null, rootClients };
}

/** The client a folder belongs to (null = no client), or NOT_IN_WORKSPACE. */
export async function folderClienteId(db: Db, folderId: number, contaId: string): Promise<ClientOf> {
  const info = await folderInfo(db, folderId, contaId);
  return info === NOT_IN_WORKSPACE ? info : info.client;
}

/** The client is set and assigned (or the scope covers every client). */
export function clientAccessible(scope: ClientScope, clienteId: ClientOf): boolean {
  if (scope.all) return true;
  return typeof clienteId === "number" && hasClientAccess(scope, clienteId, false);
}

/** Folder read (C3 folders USING). NOT_IN_WORKSPACE passes: the route answers its own not-found. */
export function folderReadable(scope: ClientScope, info: FolderInfo | typeof NOT_IN_WORKSPACE): boolean {
  if (info === NOT_IN_WORKSPACE || scope.all) return true;
  return info.rootClients || clientAccessible(scope, info.client);
}

/** Folder write, or writing into it (C3 folders WITH CHECK / files INSERT). NOT_IN_WORKSPACE passes. */
export function folderWritable(scope: ClientScope, info: FolderInfo | typeof NOT_IN_WORKSPACE): boolean {
  if (info === NOT_IN_WORKSPACE || scope.all) return true;
  return clientAccessible(scope, info.client);
}

/** What a member may do with one file (C3 files policies). */
export interface FileAccess {
  read: boolean;
  /** Delete, or move it out of its folder. */
  del: boolean;
  folderId: number | null;
}

/** Files (of `fileIds`) linked to a post the member sees: assigned client, or his own post
 * (responsavel_id in his membros) in a hidden client. Throws on a read error. */
export async function linkedToVisiblePost(
  db: Db,
  scope: ClientScope,
  fileIds: number[],
  contaId: string,
  userId: string,
): Promise<Set<number>> {
  const out = new Set<number>();
  if (fileIds.length === 0) return out;
  const links: { id: number; file_id: number; post_id: number }[] = [];
  for (const part of chunk([...new Set(fileIds)])) {
    links.push(...await fetchAllRowsKeyset<{ id: number; file_id: number; post_id: number }>((after) => {
      let q = db.from("post_file_links").select("id, file_id, post_id").eq("conta_id", contaId).in("file_id", part);
      if (after != null) q = q.gt("id", Number(after));
      return q.order("id", { ascending: true }).limit(SUBTREE_PAGE);
    }, (r) => String(r.id), SUBTREE_PAGE));
  }
  if (links.length === 0) return out;
  const visiblePosts = new Set<number>();
  for (const part of chunk([...new Set(links.map((l) => Number(l.post_id)))])) {
    const { data, error } = await db.from("workflow_posts").select("id, cliente_id, responsavel_id")
      .eq("conta_id", contaId).in("id", part);
    if (error) throw new Error(`file scope: workflow_posts read failed: ${error.message ?? "unknown"}`);
    for (const p of (data ?? []) as { id: number; cliente_id: number | null; responsavel_id: number | null }[]) {
      if (rowVisibility(scope, p, userId) !== "hidden") visiblePosts.add(Number(p.id));
    }
  }
  for (const l of links) if (visiblePosts.has(Number(l.post_id))) out.add(Number(l.file_id));
  return out;
}

/** Read / delete rights on one file, or NOT_IN_WORKSPACE (the route answers its own not-found). */
export async function fileAccess(
  db: Db,
  scope: ClientScope,
  fileId: number,
  contaId: string,
  userId: string,
): Promise<FileAccess | typeof NOT_IN_WORKSPACE> {
  const { data: file, error } = await db.from("files").select("conta_id, folder_id, uploaded_by").eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`file scope: files read failed: ${error.message ?? "unknown"}`);
  if (!file || file.conta_id !== contaId) return NOT_IN_WORKSPACE;
  const folderId = file.folder_id == null ? null : Number(file.folder_id);
  if (scope.all) return { read: true, del: true, folderId };
  const own = file.uploaded_by != null && file.uploaded_by === userId;
  let client: ClientOf = null;
  if (folderId != null) {
    client = await folderClienteId(db, folderId, contaId);
    if (client === NOT_IN_WORKSPACE) client = -1; // a folder outside the workspace: no client of his
  }
  const assigned = clientAccessible(scope, client);
  const del = assigned || (own && client === null);
  if (assigned || own) return { read: true, del, folderId };
  const linked = await linkedToVisiblePost(db, scope, [fileId], contaId, userId);
  return { read: linked.has(fileId), del, folderId };
}

/** Files of one folder listing a member may see. `parentClient` is the listed folder's client (null
 * at the top, under the Clientes root, or in a folder with no client). */
export async function visibleFileRows<T extends { id: number | string; uploaded_by?: string | null }>(
  db: Db,
  rows: T[] | null | undefined,
  scope: ClientScope,
  contaId: string,
  userId: string,
  parentClient: ClientOf,
): Promise<T[]> {
  const list = rows ?? [];
  if (clientAccessible(scope, parentClient)) return list;
  const others = list.filter((f) => f.uploaded_by !== userId).map((f) => Number(f.id));
  const linked = await linkedToVisiblePost(db, scope, others, contaId, userId);
  return list.filter((f) => (f.uploaded_by != null && f.uploaded_by === userId) || linked.has(Number(f.id)));
}

export type TypedRow = { id: number | string; source_type?: string | null; source_id?: number | string | null };

export function isTypedRow(r: TypedRow): boolean {
  return !!r.source_type && r.source_type !== "root_clients" && r.source_id != null;
}

/** folder id -> cliente_id for typed folder rows, in batch (one read per source table). A typed row
 * whose source row is gone maps to -1, a client nobody is assigned (hidden by default). */
export async function typedRowClients(db: Db, rows: TypedRow[], contaId: string): Promise<Map<number, number>> {
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
    // Each level is read in full: the frontier is chunked (URL length) and every chunk is drained
    // by keyset pages on id (PostgREST truncates at its row cap without an error, and offset pages
    // can skip a row when another is deleted between pages). A page error throws, and the caller
    // answers a generic 500: never "nothing hidden below".
    const level: TypedRow[] = [];
    for (const part of chunk(frontier)) {
      level.push(...await fetchAllRowsKeyset<TypedRow>((after) => {
        let q = db.from("folders").select("id, source_type, source_id").eq("conta_id", contaId)
          .in("parent_id", part);
        if (after != null) q = q.gt("id", Number(after));
        return q.order("id", { ascending: true }).limit(SUBTREE_PAGE);
      }, (r) => String(r.id), SUBTREE_PAGE));
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

/** Folder rows of a listing a restricted member may see. Typed folders (client, client_reports,
 * workflow, post) follow their own client (workflow/post rows resolved in batch); the Clientes root
 * is navigation and stays; an untyped folder belongs to the listed parent's client
 * (`parentClient`, null at the top), so it stays only when that client is assigned. */
export async function visibleFolderRows<T extends TypedRow>(
  db: Db,
  rows: T[] | null | undefined,
  scope: ClientScope,
  contaId: string,
  parentClient: ClientOf,
): Promise<T[]> {
  const list = rows ?? [];
  if (scope.all) return list;
  const clients = await typedRowClients(db, list, contaId);
  const parentOk = clientAccessible(scope, parentClient);
  return list.filter((r) => {
    if (r.source_type === "root_clients") return true;
    const c = clients.get(Number(r.id));
    return c === undefined ? parentOk : hasClientAccess(scope, c, false);
  });
}
