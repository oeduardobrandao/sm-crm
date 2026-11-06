// Referências do cliente no post, lado CRM (JWT). Spec:
// docs/superpowers/specs/2026-10-08-client-post-references-design.md
// Mesma forma de auth de ideia-media-manage: service role + getUser(token),
// conta pelo profiles.conta_id (403 se nulo). Toda query filtra conta_id.
import { insertAuditLog } from "../_shared/audit.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";
import {
  CLIENT_SCOPE_MESSAGE,
  type ClientScope,
  type ClientScopeLoader,
  loadClientScope as realLoadClientScope,
  rowVisibility,
} from "../_shared/client-scope.ts";
import {
  loadMaterialRequestForPost,
  loadMaterialSummary,
  type MaterialRequestDTO,
  normalizeMaterialItems,
  saveMaterialRequest,
} from "../_shared/material-requests.ts";
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
  /** Acesso por cliente: the caller's client scope (defaults to the real loader). */
  loadClientScope?: ClientScopeLoader;
}

const MAX_SUMMARY_IDS = 200;

export function createPostReferencesHandler(deps: PostReferencesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS" };
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

    // Acesso por cliente: a post outside the caller's scope answers exactly like a missing one
    // (reads honor "é dele"; the delete does not). A scope read error is a generic 500.
    let scope: ClientScope;
    try {
      scope = await (deps.loadClientScope ?? realLoadClientScope)(db, user.id, contaId);
    } catch (err) {
      console.error("[post-references] client scope:", err);
      return send(referenceError("internal"));
    }

    const withOpenerName = async (r: MaterialRequestDTO | null) => {
      if (!r) return null;
      let name: string | null = null;
      if (r.opened_by) {
        const { data: p } = await db.from("profiles").select("nome").eq("id", r.opened_by)
          .eq("conta_id", contaId).maybeSingle();
        name = (p?.nome as string | undefined) ?? null;
      }
      return { ...r, opened_by_name: name };
    };

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
        .select("id, cliente_id, responsavel_id").eq("id", postId).eq("conta_id", contaId).maybeSingle();
      if (!post || rowVisibility(scope, post, user.id) === "hidden") return send(referenceError("not_found"));
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: true,
      });
      if (!listed.ok) return send(listed.result);
      let request: (MaterialRequestDTO & { opened_by_name: string | null }) | null = null;
      try {
        request = await withOpenerName(await loadMaterialRequestForPost(db, contaId, postId));
      } catch (err) {
        console.error("[post-references] material request:", err);
        return send(referenceError("internal"));
      }
      return json({ items: listed.items, request });
    }

    // GET /requests/summary?post_ids=1,2 → progresso do pedido por post, só dos posts
    // visíveis no escopo do chamador (ids fora dele somem, sem sinal de existência).
    if (req.method === "GET" && seg.length === 2 && seg[0] === "requests" && seg[1] === "summary") {
      const rawIds = (url.searchParams.get("post_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (rawIds.length > MAX_SUMMARY_IDS) return json({ error: "too_many_ids" }, 400);
      const ids: number[] = [];
      for (const r of rawIds) {
        const id = parsePositiveId(r);
        if (id === null) return json({ error: "invalid_ids" }, 400);
        if (!ids.includes(id)) ids.push(id);
      }
      try {
        let visible = ids;
        if (!scope.all && ids.length > 0) {
          const { data: posts, error } = await db.from("workflow_posts")
            .select("id, cliente_id, responsavel_id").in("id", ids).eq("conta_id", contaId);
          if (error) throw error;
          visible = (Array.isArray(posts) ? posts : [])
            .filter((p: { cliente_id: number; responsavel_id: number | null }) =>
              rowVisibility(scope, p, user.id) !== "hidden")
            .map((p: { id: number }) => Number(p.id));
        }
        return json({ summary: await loadMaterialSummary(db, contaId, visible) });
      } catch (err) {
        console.error("[post-references] material summary:", err);
        return send(referenceError("internal"));
      }
    }

    // PUT /requests/:postId → abre, edita ou cancela o pedido de material. Exige
    // entregas/editar e visibilidade total do post (o "é dele" não basta, como no DELETE).
    if (req.method === "PUT" && seg.length === 2 && seg[0] === "requests") {
      const postId = parsePositiveId(seg[1]);
      if (postId === null) return send(referenceError("not_found"));
      const canEdit = await hasPermissionFor(db, user.id, contaId, "entregas", "editar");
      if (!canEdit) return json({ error: "forbidden" }, 403);
      const { data: post } = await db.from("workflow_posts")
        .select("id, cliente_id, responsavel_id").eq("id", postId).eq("conta_id", contaId).maybeSingle();
      const vis = post ? rowVisibility(scope, post, user.id) : "hidden";
      if (vis === "hidden") return send(referenceError("not_found"));
      if (vis !== "visible") return json({ error: "forbidden" }, 403);

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return json({ error: "invalid_body" }, 400);
      }
      const b = body as Record<string, unknown>;
      if (typeof b.open !== "boolean") return json({ error: "invalid_body" }, 400);
      const norm = normalizeMaterialItems(b.items ?? []);
      if (!norm.ok) return send(referenceError(norm.code));

      const saved = await saveMaterialRequest(db, {
        conta_id: contaId, post_id: postId, user_id: user.id, open: b.open, items: norm.items,
      });
      if (!saved.ok) return send(saved.result);
      try {
        return json({ request: await withOpenerName(saved.request) });
      } catch (err) {
        console.error("[post-references] opener name:", err);
        return send(referenceError("internal"));
      }
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

      const { data: ref } = await db.from("post_references")
        .select("post_id, kind").eq("id", refId).eq("conta_id", contaId).maybeSingle();
      if (!ref) return send(referenceError("not_found"));

      if (!scope.all) {
        // Restricted member: the reference's post must be in scope before anything is deleted.
        const { data: refPost } = await db.from("workflow_posts").select("cliente_id, responsavel_id")
          .eq("id", ref.post_id).eq("conta_id", contaId).maybeSingle();
        const vis = refPost ? rowVisibility(scope, refPost, user.id) : "hidden";
        if (vis === "hidden") return send(referenceError("not_found"));
        if (vis === "own_only") return json({ error: CLIENT_SCOPE_MESSAGE }, 403);
      }

      // O banco apaga sob o lock do post e reabre/fecha o pedido de material.
      const { data: outcome, error } = await db.rpc("post_reference_team_delete", {
        p_conta: contaId, p_ref_id: refId,
      });
      if (error) {
        console.error("[post-references] delete failed:", error);
        return send(referenceError("internal"));
      }
      if (outcome === "not_found") return send(referenceError("not_found"));
      if (outcome !== "ok") {
        console.error("[post-references] delete unexpected outcome:", outcome);
        return send(referenceError("internal"));
      }
      const row = ref as { post_id: number; kind: string };

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
