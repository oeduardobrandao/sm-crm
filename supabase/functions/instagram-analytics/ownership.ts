// Ownership + client-scope guards for instagram-analytics (acesso por cliente, spec
// docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md). Moved out of index.ts so they
// can be tested without the Deno.serve module. A client outside the caller's scope answers exactly
// like a client of another workspace (the same `Unauthorized` throw -> 401), so ids can't be probed.

import { type ClientScope, hasClientAccess } from "../_shared/client-scope.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** Throws `Unauthorized` unless `clientId` belongs to `contaId` and is in the caller's scope. */
export async function verifyClientOwnership(
  serviceClient: Db,
  clientId: string,
  contaId: string,
  scope: ClientScope,
): Promise<void> {
  const { data: clientRow } = await serviceClient
    .from("clientes")
    .select("conta_id")
    .eq("id", clientId)
    .single();
  if (!clientRow || clientRow.conta_id !== contaId) {
    throw new Error("Unauthorized");
  }
  if (!hasClientAccess(scope, parseInt(clientId, 10), false)) {
    throw new Error("Unauthorized");
  }
}

/** Throws `Unauthorized` unless the post's account belongs to `contaId` and its client is in the
 * caller's scope. Only tag writes use it: no "é dele" (Instagram posts have no responsável). */
export async function verifyPostOwnership(
  serviceClient: Db,
  postId: string,
  contaId: string,
  scope: ClientScope,
): Promise<void> {
  const { data: post } = await serviceClient
    .from("instagram_posts")
    .select("instagram_account_id, instagram_accounts!inner(client_id, clientes!inner(conta_id))")
    .eq("id", postId)
    .single();
  // deno-lint-ignore no-explicit-any
  const account = (post as any)?.instagram_accounts;
  if (!post || account?.clientes?.conta_id !== contaId) {
    throw new Error("Unauthorized");
  }
  if (!hasClientAccess(scope, account?.client_id ?? null, false)) {
    throw new Error("Unauthorized");
  }
}

/** Rows of a client list the caller may see (listing routes: portfolio, portfolio AI). */
export function visibleClients<T extends { id: number }>(clients: T[] | null | undefined, scope: ClientScope): T[] {
  return (clients ?? []).filter((c) => hasClientAccess(scope, c.id, false));
}
