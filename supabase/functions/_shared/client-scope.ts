// Acesso por cliente (spec docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md):
// the TS mirror of `can_access_cliente` for code that runs with the service role (MCP, edge
// functions), where RLS does not apply. Generic on purpose: any service-role caller loads the
// scope of the acting user once and checks rows with it.
//
// Rules (same as the SQL predicate):
// - owner -> every client; client_scope 'todos' -> every client;
// - 'atribuidos' -> only the clients in workspace_member_clientes for (workspace, user);
// - no workspace_members row -> no client at all;
// - a read error or an unknown client_scope value throws: never "all" by accident.
// The feature flag is never read here: an existing restriction keeps applying (fail closed).

import { fetchAllRowsKeyset } from "./paginate.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

export interface ClientScope {
  /** True for owners and `todos` members: no client filter applies. */
  all: boolean;
  /** Assigned client ids (only meaningful when `all` is false). */
  ids: Set<number>;
  /** The user's `membros.id`s in this workspace, for the "é dele" rule (responsavel_id columns). */
  membroIds: Set<number>;
}

export const CLIENT_SCOPE_RESTRICTED = "client_scope_restricted";

/** A restricted member touched a client outside their assignments. Generic message, no ids. */
export class ClientScopeError extends Error {
  readonly code = CLIENT_SCOPE_RESTRICTED;
  constructor() {
    super(CLIENT_SCOPE_RESTRICTED);
    this.name = "ClientScopeError";
  }
}

const SCOPE_PAGE = 1000;

const allClients = (): ClientScope => ({ all: true, ids: new Set(), membroIds: new Set() });

function toIds(rows: unknown, col: string): Set<number> {
  const out = new Set<number>();
  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const n = Number(r?.[col]);
    if (Number.isInteger(n)) out.add(n);
  }
  return out;
}

/** Client scope of `userId` in `workspaceId`. Throws on any read error or unknown scope value. */
export async function loadClientScope(svc: Db, userId: string, workspaceId: string): Promise<ClientScope> {
  const { data: member, error } = await svc
    .from("workspace_members")
    .select("role, client_scope")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`client scope: membership read failed: ${error.message ?? "unknown"}`);
  if (!member) return { all: false, ids: new Set(), membroIds: new Set() };

  if (member.role === "owner") return allClients();
  if (member.client_scope === "todos") return allClients();
  if (member.client_scope !== "atribuidos") throw new Error("client scope: unknown client_scope value");

  // Both reads are drained by keyset pages (PostgREST truncates an un-ranged read at its row cap,
  // and an owner can assign up to 2000 clients). Any page error throws: never a partial scope.
  const page = (table: string, col: string, filters: [string, string][]) =>
    fetchAllRowsKeyset<Record<string, unknown>>((after) => {
      let q = svc.from(table).select(col);
      for (const [k, v] of filters) q = q.eq(k, v);
      if (after != null) q = q.gt(col, Number(after));
      return q.order(col, { ascending: true }).limit(SCOPE_PAGE);
    }, (r) => String(r[col]), SCOPE_PAGE);
  let assigned: Record<string, unknown>[];
  let membros: Record<string, unknown>[];
  try {
    [assigned, membros] = await Promise.all([
      page("workspace_member_clientes", "cliente_id", [["workspace_id", workspaceId], ["user_id", userId]]),
      page("membros", "id", [["conta_id", workspaceId], ["crm_user_id", userId]]),
    ]);
  } catch (err) {
    throw new Error(`client scope: assignments read failed: ${err instanceof Error ? err.message : "unknown"}`);
  }
  return { all: false, ids: toIds(assigned, "cliente_id"), membroIds: toIds(membros, "id") };
}

/** Boolean form of {@link assertClientAccess}, for reads that answer "not found" instead. */
export function hasClientAccess(scope: ClientScope, clienteId: number | null | undefined, isOwnItem: boolean): boolean {
  if (scope.all) return true;
  if (isOwnItem) return true;
  return clienteId != null && scope.ids.has(Number(clienteId));
}

/** Throws {@link ClientScopeError} unless the scope covers `clienteId` (or the item is the user's).
 * Writes always pass `isOwnItem = false`. */
export function assertClientAccess(scope: ClientScope, clienteId: number | null | undefined, isOwnItem: boolean): void {
  if (!hasClientAccess(scope, clienteId, isOwnItem)) throw new ClientScopeError();
}

/** "É dele" for a row with a `responsavel_id` (membros.id) and/or an author uuid column. */
export function isOwnItem(
  scope: ClientScope,
  row: { responsavelId?: number | null; createdBy?: string | null },
  userId: string,
): boolean {
  if (row.responsavelId != null && scope.membroIds.has(Number(row.responsavelId))) return true;
  return row.createdBy != null && row.createdBy === userId;
}

/** Ids for a `.in("cliente_id", …)` filter: `null` = no filter (all clients). An empty array means
 * zero clients; callers short-circuit to an empty result (never send `.in([])`). */
export function visibleClientIds(scope: ClientScope): number[] | null {
  return scope.all ? null : [...scope.ids];
}

// ---- edge-function helpers (Task 13) ---------------------------------------------------------

/** The user-facing refusal for a write on the user's own item in a client outside the scope.
 * Same copy as the MCP (mcp/register.ts). */
export const CLIENT_SCOPE_MESSAGE = "Seu acesso é limitado aos clientes atribuídos.";

/** Loader signature, so handlers can take it as an injectable dependency. */
export type ClientScopeLoader = (svc: Db, userId: string, workspaceId: string) => Promise<ClientScope>;

/** A scope with no restriction, for tests and owner-only paths. */
export function allClientsScope(): ClientScope {
  return allClients();
}

/** Visibility of a post-like row (`cliente_id` + `responsavel_id` membros.id) for the user:
 * - `visible`: the client is in scope;
 * - `own_only`: the client is hidden but the row is the user's ("é dele"), so READS are allowed and
 *   WRITES answer {@link CLIENT_SCOPE_MESSAGE};
 * - `hidden`: answer exactly like a missing row. */
export type RowVisibility = "visible" | "own_only" | "hidden";

export function rowVisibility(
  scope: ClientScope,
  row: { cliente_id?: number | null; responsavel_id?: number | null; created_by?: string | null },
  userId: string,
): RowVisibility {
  if (hasClientAccess(scope, row.cliente_id ?? null, false)) return "visible";
  const own = isOwnItem(scope, { responsavelId: row.responsavel_id ?? null, createdBy: row.created_by ?? null }, userId);
  return own ? "own_only" : "hidden";
}

/** Write gate for a row already fetched and known to be in the workspace, for handlers that build
 * their own responses: null = allowed; otherwise the status and body to answer with. A hidden row
 * answers `notFound` (same as a missing one), the user's own row in a hidden client answers
 * {@link CLIENT_SCOPE_MESSAGE}, and a scope read error answers a generic 500 (logged), never
 * "all clients". Unrestricted callers pay the one membership read and nothing else.
 * `opts.allowOwn`: the user's own row in a hidden client passes too (publish, schedule, cancel and
 * retry of his own post, ruling 4a: same as the `workflow_posts` read rule). */
export async function rowWriteGate(
  svc: Db,
  userId: string,
  workspaceId: string,
  row: { cliente_id?: number | null; responsavel_id?: number | null; created_by?: string | null },
  notFound: { status: number; body: unknown },
  loader: ClientScopeLoader = loadClientScope,
  opts: { allowOwn?: boolean } = {},
): Promise<{ status: number; body: unknown } | null> {
  let scope: ClientScope;
  try {
    scope = await loader(svc, userId, workspaceId);
  } catch (err) {
    console.error("[client-scope] scope read failed:", err instanceof Error ? err.message : String(err));
    return { status: 500, body: { error: "Internal server error" } };
  }
  const vis = rowVisibility(scope, row, userId);
  if (vis === "hidden") return notFound;
  if (vis === "own_only" && !opts.allowOwn) return { status: 403, body: { error: CLIENT_SCOPE_MESSAGE } };
  return null;
}

/** Resolves the workspace a client-linked resource belongs to, for handlers that did NOT already
 * pin the resource to a verified workspace (e.g. a post read through RLS). */
export type ResourceWorkspaceResolver = (
  svc: Db,
  userId: string,
  clienteId: number | null | undefined,
) => Promise<string | null>;

/** The client's own workspace (`clientes.conta_id`), but only when `userId` is a member of it
 * (`workspace_members`); null otherwise (callers answer their not-found). Throws on read errors.
 * Never derive the scope's workspace from `profiles.conta_id`: it goes stale on a workspace switch
 * (and can be NULL), so a member restricted in the post's workspace but `todos` in the stale one
 * would load `all: true`. */
export async function memberWorkspaceOfClient(
  svc: Db,
  userId: string,
  clienteId: number | null | undefined,
): Promise<string | null> {
  if (clienteId == null) return null;
  const { data: cliente, error } = await svc.from("clientes").select("conta_id").eq("id", clienteId).maybeSingle();
  if (error) throw new Error(`client scope: client workspace read failed: ${error.message ?? "unknown"}`);
  const workspaceId = (cliente as { conta_id?: string } | null)?.conta_id;
  if (!workspaceId) return null;
  const { data: member, error: memberError } = await svc
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (memberError) throw new Error(`client scope: membership read failed: ${memberError.message ?? "unknown"}`);
  return member ? workspaceId : null;
}
