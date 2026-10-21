// Referências do cliente no post, lado CRM (JWT). Spec:
// docs/superpowers/specs/2026-10-08-client-post-references-design.md
// Mesma forma de auth de ideia-media-manage: service role + getUser(token),
// conta pelo profiles.conta_id (403 se nulo). Toda query filtra conta_id.
import { insertAuditLog } from "../_shared/audit.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";
import {
  listPostReferences,
  parsePositiveId,
  referenceError,
  type ReferenceResult,
  type SignGetUrl,
} from "../_shared/post-references.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

export interface PostReferencesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signGetUrl: SignGetUrl;
}

export function createPostReferencesHandler(deps: PostReferencesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS" };
    const json = createJsonResponder(cors);
    const send = (r: ReferenceResult) => json(r.body, r.status);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const contaId = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("post-references");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];

    // GET ?post_id → lista com download_url. Sem checagem de módulo: mesma regra da
    // mídia do post (membro do workspace, via RLS), e a lista de referências já é
    // legível por SELECT direto (policy de post_references).
    if (req.method === "GET" && seg.length === 0) {
      const postId = parsePositiveId(url.searchParams.get("post_id"));
      if (postId === null) return send(referenceError("not_found"));
      const { data: post } = await db.from("workflow_posts")
        .select("id").eq("id", postId).eq("conta_id", contaId).maybeSingle();
      if (!post) return send(referenceError("not_found"));
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: true,
      });
      if (!listed.ok) return send(listed.result);
      return json({ items: listed.items });
    }

    // DELETE /:id → remoção pela equipe. Exige entregas/editar (espelho do
    // can('entregas','editar') do WorkflowDrawer): mais estrito que a mídia do post,
    // de propósito, porque é material do cliente. O trigger de órfão apaga o files
    // e devolve a cota.
    if (req.method === "DELETE" && seg.length === 1) {
      const refId = parsePositiveId(seg[0]);
      if (refId === null) return send(referenceError("not_found"));
      const canEdit = await hasPermissionFor(db, user.id, contaId, "entregas", "editar");
      if (!canEdit) return json({ error: "forbidden" }, 403);

      const { data: deleted, error } = await db.from("post_references")
        .delete()
        .eq("id", refId)
        .eq("conta_id", contaId)
        .select("id, post_id, kind");
      if (error) {
        console.error("[post-references] delete failed:", error);
        return send(referenceError("internal"));
      }
      const row = Array.isArray(deleted) ? deleted[0] as { post_id: number; kind: string } | undefined : undefined;
      if (!row) return send(referenceError("not_found"));

      await insertAuditLog(db, {
        conta_id: contaId,
        actor_user_id: user.id,
        action: "delete_post_reference",
        resource_type: "post_reference",
        resource_id: String(refId),
        metadata: { post_id: row.post_id, kind: row.kind },
      });
      return json({ ok: true });
    }

    return send(referenceError("not_found"));
  };
}
