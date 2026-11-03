// Client ownership + client scope for instagram-integration's JWT routes (acesso por cliente, spec
// docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md). Out of index.ts so it can be
// tested without the Deno.serve module. A client outside the caller's scope answers exactly like a
// client of another workspace (`false` -> the route's existing 403).

import { type ClientScopeLoader, hasClientAccess, loadClientScope } from "../_shared/client-scope.ts";

// deno-lint-ignore no-explicit-any
type Svc = { from: (table: string) => any };

/** The scope could not be read. index.ts answers it with a generic 500 before its catch-all
 * message sniffing ("expired" / "Unauthorized") can see it; never treated as "all clients". */
export class ClientScopeUnavailableError extends Error {
  constructor() {
    super("client scope unavailable");
    this.name = "ClientScopeUnavailableError";
  }
}

/** `(svc, clientId, contaId) -> boolean` for the caller `userId`: true only when the client is in
 * `contaId` AND in the caller's client scope. No user (OAuth callback) never passes. */
export function makeClientAccessCheck(
  userId: string | null,
  loader: ClientScopeLoader = loadClientScope,
): (svc: Svc, clientId: string, contaId: string) => Promise<boolean> {
  return async (svc, clientId, contaId) => {
    const { data: client } = await svc
      .from("clientes")
      .select("conta_id")
      .eq("id", parseInt(clientId, 10))
      .single();
    if (client?.conta_id !== contaId) return false;
    if (!userId) return false;
    let scope;
    try {
      scope = await loader(svc, userId, contaId);
    } catch (err) {
      console.error("[instagram-integration] client scope:", err instanceof Error ? err.message : String(err));
      throw new ClientScopeUnavailableError();
    }
    return hasClientAccess(scope, parseInt(clientId, 10), false);
  };
}
