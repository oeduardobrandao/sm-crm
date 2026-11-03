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

  // One un-ranged read each: past PostgREST's 1000-row cap this would truncate CLOSED (fewer
  // clients visible), never open.
  const [assigned, membros] = await Promise.all([
    svc
      .from("workspace_member_clientes")
      .select("cliente_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId),
    svc
      .from("membros")
      .select("id")
      .eq("conta_id", workspaceId)
      .eq("crm_user_id", userId),
  ]);
  if (assigned.error) throw new Error(`client scope: assignments read failed: ${assigned.error.message ?? "unknown"}`);
  if (membros.error) throw new Error(`client scope: membros read failed: ${membros.error.message ?? "unknown"}`);
  return { all: false, ids: toIds(assigned.data, "cliente_id"), membroIds: toIds(membros.data, "id") };
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
