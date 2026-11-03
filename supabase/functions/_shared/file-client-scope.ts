// Acesso por cliente for the file library (file-manage, file-upload-url, file-upload-finalize).
// Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md.
//
// A folder belongs to the client of its nearest typed ancestor (itself included):
//   source_type 'client' | 'client_reports' -> source_id is the cliente_id;
//   'workflow' -> workflows.cliente_id;  'post' -> workflow_posts.cliente_id;
//   'root_clients' / untyped (user folder) -> keep walking up; the root -> null (workspace-level).
// A file belongs to its folder's client; a post-reference file (attached_to) to its post's client.
// Workspace-level items (null client) stay visible to a restricted member, EXCEPT for operations
// over a folder's whole subtree (zip, copy, delete, move): a workspace-level folder can hold hidden
// client subtrees (the "Clientes" root does), so those need a folder of a visible client.
//
// This mapping mirrors the folder tree the sync triggers build (folder_sync_cliente/workflow/post).
// The DB policies of Task 4c own the authoritative definition; keep the two in step.

import { type ClientScope, hasClientAccess } from "./client-scope.ts";

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

/** Read / write-into check for one item: a workspace-level item passes. */
export function itemVisible(scope: ClientScope, clienteId: ClientOf): boolean {
  if (clienteId === NOT_IN_WORKSPACE) return true; // the route answers its own not-found
  return clienteId === null || hasClientAccess(scope, clienteId, false);
}

/** Subtree check (zip, copy, delete, move of a folder): needs a folder of a visible client. */
export function subtreeVisible(scope: ClientScope, clienteId: ClientOf): boolean {
  if (scope.all) return true;
  if (clienteId === NOT_IN_WORKSPACE) return true;
  return clienteId !== null && hasClientAccess(scope, clienteId, false);
}

/** Folder rows of a listing a restricted member may see: client folders of hidden clients go. */
export function visibleFolderRows<T extends { source_type?: string | null; source_id?: number | null }>(
  rows: T[] | null | undefined,
  scope: ClientScope,
): T[] {
  if (scope.all) return rows ?? [];
  return (rows ?? []).filter((r) =>
    !(r.source_type === "client" || r.source_type === "client_reports") ||
    hasClientAccess(scope, r.source_id ?? null, false)
  );
}
