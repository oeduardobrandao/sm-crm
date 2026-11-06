// Ownership + acesso por cliente check shared by post-media-upload-url and post-media-finalize.
// Attaching media to a post is a write: a post in another workspace, a missing one and one in a
// hidden client all answer the same 404 "Post not found"; the caller's own post in a hidden client
// answers 403 CLIENT_SCOPE_MESSAGE (writes have no "é dele"); a scope read error is a generic 500.

import { type ClientScopeLoader, loadClientScope, rowWriteGate } from "./client-scope.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => any };

export const POST_NOT_FOUND = { status: 404, body: { error: "Post not found" } };

/** null = the caller may write media to the post; otherwise the answer to send. */
export async function postMediaWriteGate(
  svc: Db,
  userId: string,
  contaId: string,
  postId: unknown,
  loader: ClientScopeLoader = loadClientScope,
): Promise<{ status: number; body: unknown } | null> {
  const { data: post } = await svc.from("workflow_posts").select("id, conta_id, cliente_id, responsavel_id")
    .eq("id", postId).single();
  if (!post || post.conta_id !== contaId) return POST_NOT_FOUND;
  return await rowWriteGate(svc, userId, contaId, post, POST_NOT_FOUND, loader);
}
