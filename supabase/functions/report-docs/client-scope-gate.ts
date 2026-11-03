// Acesso por cliente for report-docs (spec docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md).
// The workspace is profiles.active_workspace_id verified against workspace_members in index.ts, and
// every document read below is pinned to it. A client (or a document of a client) outside the
// caller's scope answers exactly like a missing / foreign one: the routes' existing 404 not_found.

import { type ClientScope, hasClientAccess } from "../_shared/client-scope.ts";
import { DocActionError, GenerateError } from "./errors.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** POST /generate: the requested client must be in scope (no "é dele" for a client). */
export function assertGenerateClientInScope(scope: ClientScope, clientId: number): void {
  if (!hasClientAccess(scope, clientId, false)) throw new GenerateError("not_found");
}

/** /:id routes: the document's client must be in scope. Unrestricted callers skip the read. For a
 * restricted caller a missing, foreign or hidden document all throw the same DocActionError
 * "not_found" here (the route's own not-found answer), so the three are indistinguishable. A read
 * error throws a plain Error, which the route turns into a generic 500. */
export async function assertDocInScope(db: Db, scope: ClientScope, contaId: string, docId: string): Promise<void> {
  if (scope.all) return;
  const { data: doc, error } = await db.from("report_documents")
    .select("client_id, conta_id")
    .eq("id", docId)
    .eq("conta_id", contaId)
    .maybeSingle();
  if (error) throw new Error(`report-docs: scope doc read failed: ${error.message ?? "unknown"}`);
  if (!doc || !hasClientAccess(scope, doc.client_id, false)) throw new DocActionError("not_found");
}
