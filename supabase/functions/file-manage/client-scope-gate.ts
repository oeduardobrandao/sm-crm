// Acesso por cliente gate for file-manage: decides, before any route runs, whether a RESTRICTED
// caller may touch the folders / files / posts / links the request names. Unrestricted callers never
// get here. Mapping rules: _shared/file-client-scope.ts.
//
// Rules:
// - A hidden item answers exactly like a missing one, byte for byte. Where the route's not-found is
//   its first answer, the gate gives the same status and copy. Where a missing id does NOT end in a
//   404 (tree and links listings answer an empty list; bulk-move/bulk-delete/zip-token fold missing
//   ids into their own answers), the gate either gives that same empty answer or hands the hidden
//   ids back (hiddenFiles / hiddenFolders) for the route to treat as missing at its own check.
// - Visibility follows migration C3 (see _shared/file-client-scope.ts): a folder with no client is
//   hidden except the Clientes root, which is readable but never writable; a file is readable when it
//   is his upload, in an assigned client's folder, or linked to a post he sees.
// - Writes the DB would refuse on an item he can read (rename / delete / move of the Clientes root,
//   delete or move-out of his upload in a hidden client, writing into the root or the top level)
//   answer 403 CLIENT_SCOPE_MESSAGE. Hidden items answer as missing.
// - Subtree operations (delete, move, copy, zip) need the folder writable (an assigned client's) AND
//   no typed folder below it in a hidden client; a readable folder failing that answers 403.
// - The caller's own post in a hidden client is readable (é dele); every write on it is 403.
// - Default deny: a route not listed below answers the route table's own fallthrough, 404 "Not found".
//   GATED_ROUTES mirrors handler.ts; a structural test keeps the two in step.

import { CLIENT_SCOPE_MESSAGE, type ClientScope, rowVisibility } from "../_shared/client-scope.ts";
import {
  type ClientOf,
  fileAccess,
  folderInfo,
  folderReadable,
  folderWritable,
  NOT_IN_WORKSPACE,
  subtreeHasHiddenClient,
} from "../_shared/file-client-scope.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => any };

/** Every route condition handler.ts branches on, per resource, verbatim. Test-enforced mirror. */
export const GATED_ROUTES: Record<string, string[]> = {
  tree: ['req.method === "GET"'],
  folders: [
    'req.method === "GET" && idStr',
    'req.method === "GET"',
    'req.method === "POST" && !idStr',
    'req.method === "PATCH" && idStr',
    'req.method === "DELETE" && idStr',
    'req.method === "POST" && idStr && subResource === "copy"',
  ],
  files: [
    'req.method === "GET" && idStr',
    'subResource === "url"',
    'req.method === "POST" && idStr && subResource === "copy"',
    'req.method === "PATCH" && idStr',
    'req.method === "DELETE" && idStr',
  ],
  links: [
    'req.method === "POST"',
    'req.method === "DELETE" && idStr',
    'req.method === "GET"',
    'req.method === "PATCH" && idStr',
  ],
  "bulk-move": ['resource === "bulk-move" && req.method === "POST"'],
  "bulk-delete": ['resource === "bulk-delete" && req.method === "POST"'],
  "zip-token": ['resource === "zip-token" && req.method === "POST"'],
};

/** Generic answer for a malformed id list (file_ids / folder_ids / destination_id / folder_id). */
export const INVALID_REQUEST = { error: "Requisição inválida." };

/** The id fields bulk-move, bulk-delete and zip-token read, normalized once: the gate checks and
 * the route uses exactly these values. */
export interface BulkBody {
  file_ids?: number[];
  folder_ids?: number[];
  destination_id: number | null;
  folder_id: number | null;
}

const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const INVALID = Symbol("invalid");

function idList(v: unknown): number[] | undefined | typeof INVALID {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every(isPosInt)) return INVALID;
  return [...v];
}

function optionalId(v: unknown): number | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  return isPosInt(v) ? v : INVALID;
}

/** Fail closed on shape: an id field that is present but not a positive integer (or an array of
 * them) makes the whole request invalid (null). Only the fields `resource` reads are looked at. */
export function normalizeBulkBody(resource: string, raw: unknown): BulkBody | null {
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const file_ids = idList(b.file_ids);
  if (file_ids === INVALID) return null;
  const out: BulkBody = { file_ids, destination_id: null, folder_id: null };
  if (resource === "bulk-move" || resource === "bulk-delete") {
    const folder_ids = idList(b.folder_ids);
    if (folder_ids === INVALID) return null;
    out.folder_ids = folder_ids;
  }
  if (resource === "bulk-move") {
    const d = optionalId(b.destination_id);
    if (d === INVALID) return null;
    out.destination_id = d;
  }
  if (resource === "zip-token") {
    const f = optionalId(b.folder_id);
    if (f === INVALID) return null;
    out.folder_id = f;
  }
  return out;
}

/** Body id fields any single-item route reads. Present (not null) = a JSON positive safe integer. */
const BODY_ID_FIELDS = ["parent_id", "destination_folder_id", "folder_id", "post_id", "file_id"] as const;

/** Fail closed on shape for the single-item routes: the parsed body back (a non-object body reads as
 * {}), or null when an id field is present but not a positive safe integer. null keeps its meaning
 * (root / no destination). The gate and the route both read this one object. */
export function normalizeIdFields(raw: unknown): Record<string, unknown> | null {
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  for (const k of BODY_ID_FIELDS) {
    if (b[k] !== undefined && b[k] !== null && !isPosInt(b[k])) return null;
  }
  return b;
}

/** A path segment or query value that must be an id: absent / "" = null, digits = the number,
 * anything else = INVALID_ID. */
export const INVALID_ID = Symbol("invalid_id");
export function textId(v: string | null | undefined): number | null | typeof INVALID_ID {
  if (v === undefined || v === null || v === "") return null;
  if (!/^[1-9][0-9]*$/.test(v)) return INVALID_ID;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : INVALID_ID;
}

export interface GateRequest {
  method: string;
  resource: string | undefined;
  idStr: string | undefined;
  subResource: string | undefined;
  /** Normalized ids (textId / normalizeIdFields): the route uses these same values. */
  pathId: number | null;
  queryParent: number | null;
  queryPost: number | null;
  // deno-lint-ignore no-explicit-any
  body: any;
  /** Normalized ids for bulk-move / bulk-delete / zip-token (null on the other routes). */
  bulk: BulkBody | null;
}

export interface GateDecision {
  /** Answer now with this (status + body), or null to let the route run. */
  deny: { status: number; body: unknown } | null;
  /** Ids the route must treat as missing (bulk-move, bulk-delete, zip-token). */
  hiddenFiles: Set<number>;
  hiddenFolders: Set<number>;
  /** Client of the folder a listing (tree, folders) reads, for the route's row filter: null at the
   * top level or where the folder has no client. */
  listingParentClient: ClientOf;
}

export function allowAll(): GateDecision {
  return { deny: null, hiddenFiles: new Set(), hiddenFolders: new Set(), listingParentClient: null };
}

/** A normalized body id: a number, or null when absent / null. */
const id = (v: unknown): number | null => (typeof v === "number" ? v : null);

export async function fileManageScopeGate(
  db: Db,
  scope: ClientScope,
  contaId: string,
  userId: string,
  r: GateRequest,
): Promise<GateDecision> {
  const decision = allowAll();
  if (scope.all) return decision;
  const answer = (status: number, body: unknown): GateDecision => ({ ...decision, deny: { status, body } });
  const nf = (error: string) => answer(404, { error });
  const limited = () => answer(403, { error: CLIENT_SCOPE_MESSAGE });

  const fileRead = async (fid: number | null) => {
    if (fid == null) return true;
    const a = await fileAccess(db, scope, fid, contaId, userId);
    return a === NOT_IN_WORKSPACE || a.read;
  };
  const folderRead = async (fid: number | null) =>
    fid == null || folderReadable(scope, await folderInfo(db, fid, contaId));
  /** A destination folder something is written into (create, copy, move, upload). null = the top
   * level, which takes no client: never writable by a restricted member. */
  const dest = async (fid: number | null): Promise<"ok" | "hidden" | "limited"> => {
    if (fid == null) return "limited";
    const info = await folderInfo(db, fid, contaId);
    if (!folderReadable(scope, info)) return "hidden";
    return folderWritable(scope, info) ? "ok" : "limited";
  };
  // Subtree operations: "missing" lets the route answer its own not-found first (it validates the
  // primary item before any secondary id), "hidden" answers as missing, "limited" is 403.
  const subtree = async (fid: number | null): Promise<"ok" | "missing" | "hidden" | "limited"> => {
    if (fid == null) return "ok";
    const info = await folderInfo(db, fid, contaId);
    if (info === NOT_IN_WORKSPACE) return "missing";
    if (!folderReadable(scope, info)) return "hidden";
    if (!folderWritable(scope, info)) return "limited";
    return (await subtreeHasHiddenClient(db, scope, fid, contaId)) ? "limited" : "ok";
  };
  const post = async (pid: number | null, write: boolean): Promise<"ok" | "hidden" | "limited"> => {
    if (pid == null) return "ok";
    const { data: p, error } = await db.from("workflow_posts").select("cliente_id, responsavel_id")
      .eq("id", pid).eq("conta_id", contaId).maybeSingle();
    if (error) throw new Error(`file-manage gate: post read failed: ${error.message ?? "unknown"}`);
    if (!p) return "ok"; // the route answers its own not-found
    const vis = rowVisibility(scope, p, userId);
    if (vis === "hidden") return "hidden";
    if (vis === "own_only" && write) return "limited";
    return "ok";
  };
  const linkPost = async (lid: number | null): Promise<number | null> => {
    if (lid == null) return null;
    const { data: l, error } = await db.from("post_file_links").select("post_id").eq("id", lid)
      .eq("conta_id", contaId).maybeSingle();
    if (error) throw new Error(`file-manage gate: link read failed: ${error.message ?? "unknown"}`);
    return l?.post_id ?? null;
  };
  const { method, resource, idStr, subResource, body, bulk, pathId, queryParent: parentParam } = r;

  /** Readable parent of a listing (tree / folders): records its client for the row filter. */
  const listing = async (fid: number | null): Promise<boolean> => {
    if (fid == null) return true; // the top level: listingParentClient stays null
    const info = await folderInfo(db, fid, contaId);
    if (!folderReadable(scope, info)) return false;
    decision.listingParentClient = info === NOT_IN_WORKSPACE ? null : info.client;
    return true;
  };

  if (resource === "tree") {
    if (method !== "GET") return nf("Not found");
    // A missing parent lists nothing: 200 [].
    return (await listing(parentParam)) ? decision : answer(200, []);
  }

  if (resource === "folders") {
    const fid = pathId;
    if (method === "GET") {
      const ok = idStr ? await folderRead(fid) : await listing(parentParam);
      return ok ? decision : nf("Folder not found");
    }
    if (method === "POST" && !idStr) {
      if (!body?.name) return decision; // the route answers 400 "name required" first
      const d = await dest(id(body?.parent_id));
      return d === "hidden" ? nf("Parent folder not found") : d === "limited" ? limited() : decision;
    }
    if (method === "PATCH" && idStr) {
      // Same order as the route: the folder (404), then the new parent (404). A missing folder is
      // answered by the route before it ever looks at parent_id.
      const moving = body?.parent_id !== undefined;
      if (moving) {
        const s = await subtree(fid);
        if (s === "missing") return decision;
        if (s === "hidden") return nf("Folder not found");
        if (s === "limited") return limited();
        const d = await dest(id(body?.parent_id));
        return d === "hidden" ? nf("Parent folder not found") : d === "limited" ? limited() : decision;
      }
      // Rename: the folder must be writable (the Clientes root never is).
      const info = fid == null ? NOT_IN_WORKSPACE : await folderInfo(db, fid, contaId);
      if (!folderReadable(scope, info)) return nf("Folder not found");
      return folderWritable(scope, info) ? decision : limited();
    }
    if (method === "DELETE" && idStr) {
      const s = await subtree(fid);
      return s === "hidden" ? nf("Folder not found") : s === "limited" ? limited() : decision; // missing: route 404
    }
    if (method === "POST" && idStr && subResource === "copy") {
      const s = await subtree(fid);
      if (s === "missing") return decision; // the route's "Folder not found" comes before the destination
      if (s === "hidden") return nf("Folder not found");
      if (s === "limited") return limited();
      const d = await dest(id(body?.destination_folder_id));
      return d === "hidden" ? nf("Destination not found") : d === "limited" ? limited() : decision;
    }
    return nf("Not found");
  }

  if (resource === "files") {
    const fid = pathId;
    const known = (method === "GET" && idStr && subResource === "url") ||
      (method === "POST" && idStr && subResource === "copy") ||
      (method === "PATCH" && idStr) || (method === "DELETE" && idStr);
    if (!known) return nf("Not found");
    if (method === "PATCH" && fid != null) {
      // The route answers "File not found" for a missing, foreign or reference file before it reads
      // folder_id; leave those to it so a hidden folder_id never changes the answer.
      const { data: f, error } = await db.from("files").select("conta_id, attached_to").eq("id", fid).maybeSingle();
      if (error) throw new Error(`file-manage gate: file read failed: ${error.message ?? "unknown"}`);
      if (!f || f.conta_id !== contaId || f.attached_to != null) return decision;
    }
    const a = fid == null ? NOT_IN_WORKSPACE : await fileAccess(db, scope, fid, contaId, userId);
    if (a === NOT_IN_WORKSPACE) return decision; // the route's "File not found" comes first
    if (!a.read) return nf("File not found");
    if (method === "POST") {
      const d = await dest(id(body?.destination_folder_id));
      return d === "hidden" ? nf("Destination not found") : d === "limited" ? limited() : decision;
    }
    if (method === "PATCH") {
      // Rename needs read only (C3 files UPDATE uses the read rule). A move out of the folder needs
      // the delete rule on the origin and a writable destination.
      const target = body?.folder_id === undefined ? a.folderId : id(body?.folder_id);
      if (target === a.folderId) return decision;
      if (!a.del) return limited();
      const d = await dest(target);
      return d === "hidden" ? nf("Folder not found") : d === "limited" ? limited() : decision;
    }
    if (method === "DELETE" && !a.del) return limited();
    return decision;
  }

  if (resource === "links") {
    if (method === "GET") {
      // A missing post has no links: 200 {links: []}. The caller's own post stays readable.
      return (await post(r.queryPost, false)) === "hidden" ? answer(200, { links: [] }) : decision;
    }
    if (method === "POST") {
      // Same order as the route: required fields (400), file (404), document (400), post (404).
      if (!body?.post_id || !body?.file_id) return decision;
      const fid = id(body.file_id);
      if (!(await fileRead(fid))) return nf("File not found");
      if (fid != null) {
        const { data: f, error } = await db.from("files").select("conta_id, kind, attached_to").eq("id", fid)
          .maybeSingle();
        if (error) throw new Error(`file-manage gate: file read failed: ${error.message ?? "unknown"}`);
        if (!f || f.conta_id !== contaId || f.attached_to != null || f.kind === "document") return decision;
      }
      const p = await post(id(body.post_id), true);
      return p === "hidden" ? nf("Post not found") : p === "limited" ? limited() : decision;
    }
    if ((method === "DELETE" || method === "PATCH") && idStr) {
      const p = await post(await linkPost(pathId), true);
      return p === "hidden" ? nf("Link not found") : p === "limited" ? limited() : decision;
    }
    return nf("Not found");
  }

  if ((resource === "bulk-move" || resource === "bulk-delete" || resource === "zip-token") && method === "POST") {
    if (!bulk) return nf("Not found"); // the handler normalizes before the gate; never reached
    const folderIds = resource === "zip-token" ? (bulk.folder_id != null ? [bulk.folder_id] : []) : bulk.folder_ids ?? [];
    // zip-token with a folder_id ignores file_ids, so only look at them when there is no folder.
    const fileIds = resource === "zip-token" && bulk.folder_id != null ? [] : bulk.file_ids ?? [];
    for (const f of fileIds) {
      const a = await fileAccess(db, scope, f, contaId, userId);
      if (a === NOT_IN_WORKSPACE) continue; // the route folds missing ids into its own answer
      if (!a.read) decision.hiddenFiles.add(f);
      else if (resource !== "zip-token" && !a.del) return limited();
    }
    for (const f of folderIds) {
      const s = await subtree(f);
      if (s === "limited") return limited();
      if (s === "hidden") decision.hiddenFolders.add(f);
    }
    if (resource === "bulk-move") {
      const d = await dest(bulk.destination_id);
      if (d === "limited") return limited();
      if (d === "hidden") decision.hiddenFolders.add(bulk.destination_id!);
    }
    return decision;
  }

  return nf("Not found");
}
