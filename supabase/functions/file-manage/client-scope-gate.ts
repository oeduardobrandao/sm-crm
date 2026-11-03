// Acesso por cliente gate for file-manage: decides, before any route runs, whether a RESTRICTED
// caller may touch the folders / files / posts / links the request names. Unrestricted callers never
// get here. A hidden item answers exactly like a missing one, with the route's existing not-found
// copy; the caller's own post in a hidden client is readable (é dele) but every write on it answers
// CLIENT_SCOPE_MESSAGE. Mapping rules: _shared/file-client-scope.ts.

import { CLIENT_SCOPE_MESSAGE, type ClientScope, rowVisibility } from "../_shared/client-scope.ts";
import {
  type ClientOf,
  fileClienteId,
  folderClienteId,
  itemVisible,
  subtreeVisible,
} from "../_shared/file-client-scope.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => any };

export interface GateRequest {
  method: string;
  resource: string | undefined;
  idStr: string | undefined;
  subResource: string | undefined;
  url: URL;
  // deno-lint-ignore no-explicit-any
  body: any;
}

export type GateResult = { status: number; body: { error: string } } | null;

const nf = (error: string): GateResult => ({ status: 404, body: { error } });
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
const id = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

export async function fileManageScopeGate(
  db: Db,
  scope: ClientScope,
  contaId: string,
  userId: string,
  r: GateRequest,
): Promise<GateResult> {
  if (scope.all) return null;
  const folder = (fid: number) => folderClienteId(db, fid, contaId);
  const file = (fid: number) => fileClienteId(db, fid, contaId);
  const seen = async (target: number | null, resolve: (n: number) => Promise<ClientOf>, subtree = false) => {
    if (target == null) return true;
    const c = await resolve(target);
    return subtree ? subtreeVisible(scope, c) : itemVisible(scope, c);
  };
  const post = async (pid: number | null, write: boolean, notFound: string): Promise<GateResult> => {
    if (pid == null) return null;
    const { data: p } = await db.from("workflow_posts").select("cliente_id, responsavel_id")
      .eq("id", pid).eq("conta_id", contaId).maybeSingle();
    if (!p) return null; // the route answers its own not-found
    const vis = rowVisibility(scope, p, userId);
    if (vis === "hidden") return nf(notFound);
    if (vis === "own_only" && write) return { status: 403, body: { error: CLIENT_SCOPE_MESSAGE } };
    return null;
  };
  const linkPost = async (lid: number | null): Promise<number | null> => {
    if (lid == null) return null;
    const { data: l } = await db.from("post_file_links").select("post_id").eq("id", lid).eq("conta_id", contaId)
      .maybeSingle();
    return l?.post_id ?? null;
  };
  const { method, resource, idStr, subResource, url, body } = r;
  const parentParam = id(url.searchParams.get("parent_id"));

  if (resource === "tree" && method === "GET") {
    return (await seen(parentParam, folder)) ? null : nf("Folder not found");
  }

  if (resource === "folders") {
    const fid = id(idStr);
    if (method === "GET") return (await seen(fid ?? parentParam, folder)) ? null : nf("Folder not found");
    if (method === "POST" && !idStr) return (await seen(id(body?.parent_id), folder)) ? null : nf("Parent folder not found");
    if (method === "PATCH") {
      // A rename stays on the folder itself; a move carries its subtree.
      const moving = body?.parent_id !== undefined;
      if (!(await seen(fid, folder, moving))) return nf("Folder not found");
      return (await seen(id(body?.parent_id), folder)) ? null : nf("Folder not found");
    }
    if (method === "DELETE") return (await seen(fid, folder, true)) ? null : nf("Folder not found");
    if (method === "POST" && subResource === "copy") {
      if (!(await seen(fid, folder, true))) return nf("Folder not found");
      return (await seen(id(body?.destination_folder_id), folder)) ? null : nf("Destination not found");
    }
    return null;
  }

  if (resource === "files") {
    const fid = id(idStr);
    if (!(await seen(fid, file))) return nf("File not found");
    if (method === "POST" && subResource === "copy") {
      return (await seen(id(body?.destination_folder_id), folder)) ? null : nf("Destination not found");
    }
    if (method === "PATCH") return (await seen(id(body?.folder_id), folder)) ? null : nf("Folder not found");
    return null;
  }

  if (resource === "links") {
    if (method === "GET") return await post(id(url.searchParams.get("post_id")), false, "Post not found");
    if (method === "POST") {
      if (!(await seen(id(body?.file_id), file))) return nf("File not found");
      return await post(id(body?.post_id), true, "Post not found");
    }
    return await post(await linkPost(id(idStr)), true, "Link not found");
  }

  if (resource === "bulk-move" || resource === "bulk-delete") {
    for (const f of ids(body?.file_ids)) if (!(await seen(f, file))) return nf("File not found");
    for (const f of ids(body?.folder_ids)) if (!(await seen(f, folder, true))) return nf("Folder not found");
    if (resource === "bulk-move" && !(await seen(id(body?.destination_id), folder))) return nf("Folder not found");
    return null;
  }

  if (resource === "zip-token") {
    if (!(await seen(id(body?.folder_id), folder, true))) return nf("Not found");
    for (const f of ids(body?.file_ids)) if (!(await seen(f, file))) return nf("Not found");
    return null;
  }

  return null;
}
