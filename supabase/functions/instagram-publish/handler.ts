// supabase/functions/instagram-publish/handler.ts

import { createJsonResponder } from "../_shared/http.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import {
  validateForScheduling,
  decryptToken,
  createContainerForPost,
  createVideoContainer,
  pollContainerReady,
  publishContainer,
  fetchPermalink,
} from "../_shared/instagram-publish-utils.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};

interface PublishHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: (token: string) => DbClient;
  createServiceDb: () => DbClient;
}

export function createPublishHandler(deps: PublishHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const jwt = authHeader.slice(7);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Expected: /instagram-publish/{action}/{postId}
    const action = pathParts[1]; // schedule | cancel | retry
    const postId = parseInt(pathParts[2], 10);

    if (isNaN(postId)) return json({ error: "Invalid post ID" }, 400);
    if (!["schedule", "cancel", "retry", "publish-now"].includes(action)) {
      return json({ error: "Invalid action" }, 400);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const userDb = deps.createDb(jwt);
    const svcDb = deps.createServiceDb();
    const { data: { user: actorUser } } = await svcDb.auth.getUser(jwt);
    const actorId = actorUser?.id ?? null;

    // Verify post exists and user has access (via RLS)
    const { data: post } = await userDb
      .from("workflow_posts")
      .select("id, status, workflow_id, scheduled_at, ig_caption, instagram_container_id, publish_retry_count, tipo")
      .eq("id", postId)
      .single();

    if (!post) return json({ error: "Post não encontrado." }, 404);

    // Resolve caller's workspace and guard feature_post_scheduling
    const { data: actorProfile } = await svcDb.from("profiles").select("conta_id").eq("id", actorId).single();
    if (!actorProfile?.conta_id) return json({ error: "Unauthorized" }, 403);
    if (
      (action === "schedule" || action === "publish-now") &&
      !(await effectivePlanFeature(svcDb as any, actorProfile.conta_id, "feature_post_scheduling"))
    ) {
      return json({ error: "feature_disabled", feature: "feature_post_scheduling" }, 403);
    }

    if (action === "schedule") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para agendar." }, 422);
      }
      let validation;
      try {
        validation = await validateForScheduling(svcDb, postId);
        if (!validation.ok) {
          return json({ error: "Validação falhou", details: validation.errors }, 422);
        }
      } catch (e) {
        console.error("Schedule validation error:", e);
        return json({ error: "Erro ao validar post para agendamento." }, 500);
      }
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
      });

      // Front-load the Instagram container when the post is due within ~1h so
      // transcoding starts immediately instead of waiting for the cron's Phase 1
      // (the cron's container window is also "scheduled_at <= now() + 1 hour").
      // Best-effort: on any failure leave instagram_container_id null and let the
      // cron create it later. Mirrors cron Phase 1 cover semantics (deferred
      // coverless retry via retry_count), NOT publish-now's immediate retry.
      try {
        const dueInMs = post.scheduled_at
          ? new Date(post.scheduled_at).getTime() - Date.now()
          : Infinity;
        if (dueInMs <= 3_600_000 && validation.account) {
          const token = await decryptToken(validation.account.encrypted_access_token);
          const { containerId } = await createContainerForPost(svcDb, {
            igUserId: validation.account.instagram_user_id,
            token,
            postId,
            caption: post.ig_caption ?? "",
            useCover: post.publish_retry_count === 0,
            tipo: post.tipo,
          });
          await svcDb.from("workflow_posts").update({
            instagram_container_id: containerId,
          }).eq("id", postId);
        }
      } catch (e) {
        console.error(
          `[IG-PUBLISH] schedule front-load failed for post ${postId}:`,
          (e as Error)?.message,
        );
      }

      return json({ ok: true, status: "agendado" });
    }

    if (action === "cancel") {
      if (post.status !== "agendado") {
        return json({ error: "Apenas posts agendados podem ser cancelados." }, 422);
      }
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "aprovado_cliente",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {
          instagram_container_id: null,
          publish_processing_at: null,
          publish_error: null,
        },
      });
      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      if (post.status !== "falha_publicacao") {
        return json({ error: "Apenas posts com falha podem ser reenviados." }, 422);
      }
      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {
          publish_retry_count: 0,
          publish_error: null,
          instagram_container_id: null,
          publish_processing_at: null,
        },
      });
      return json({ ok: true, status: "agendado" });
    }

    if (action === "publish-now") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para publicar." }, 422);
      }

      let validation;
      try {
        validation = await validateForScheduling(svcDb, postId, { skipDateCheck: true });
        if (!validation.ok) {
          return json({ error: "Validação falhou", details: validation.errors }, 422);
        }
      } catch (e) {
        console.error("[IG-PUBLISH-NOW] Validation error:", e);
        return json({ error: "Erro ao validar post para publicação." }, 500);
      }

      await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: { publish_processing_at: new Date().toISOString() },
      });

      try {
        const token = await decryptToken(validation.account!.encrypted_access_token);
        const igUserId = validation.account!.instagram_user_id;

        // publish-now always attaches the cover when present (useCover:true) and does
        // an IMMEDIATE coverless retry below if Instagram rejects it during processing.
        const created = await createContainerForPost(svcDb, {
          igUserId,
          token,
          postId,
          caption: post.ig_caption ?? "",
          useCover: true,
          tipo: post.tipo,
        });
        let containerId = created.containerId;
        const coverVideoUrl = created.coverVideoUrl; // set only when a cover was used

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);

        let containerStatus = await pollContainerReady(containerId, token, 12, 3000);

        // A cover Instagram can't process surfaces as ERROR during async
        // processing (the Graph cover detail is not exposed). Retry once without
        // the cover so the Reel still publishes with Instagram's auto-cover.
        if (containerStatus === "ERROR" && coverVideoUrl) {
          const retry = await createVideoContainer(igUserId, token, coverVideoUrl, post.ig_caption);
          containerId = retry.id;
          await svcDb.from("workflow_posts").update({
            instagram_container_id: containerId,
          }).eq("id", postId);
          containerStatus = await pollContainerReady(containerId, token, 12, 3000);
        }

        if (containerStatus === "ERROR") {
          throw new Error("Container falhou no processamento do Instagram");
        }
        if (containerStatus === "IN_PROGRESS") {
          await svcDb.from("workflow_posts").update({
            scheduled_at: new Date().toISOString(),
            publish_processing_at: null,
          }).eq("id", postId);
          return json({
            ok: true,
            status: "agendado",
            message: "Mídia ainda processando no Instagram. O post será publicado automaticamente em alguns minutos.",
          });
        }

        const result = await publishContainer(igUserId, token, containerId);

        await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "postado",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {
            instagram_media_id: result.id,
            published_at: new Date().toISOString(),
            publish_processing_at: null,
            publish_error: null,
            publish_retry_count: 0,
          },
        });

        console.log(`[IG-PUBLISH-NOW] Published post ${postId}, media_id: ${result.id}`);

        const permalink = await fetchPermalink(result.id, token);
        if (permalink) {
          await svcDb.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", postId);
        }

        return json({ ok: true, status: "postado", instagram_permalink: permalink });
      } catch (err: any) {
        console.error(`[IG-PUBLISH-NOW] Failed for post ${postId}:`, err.message);
        await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "falha_publicacao",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {
            publish_error: (err.message ?? "Unknown error").slice(0, 500),
            publish_processing_at: null,
          },
        });

        if (err.code === 'TOKEN_EXPIRED') {
          try {
            const { data: wf } = await svcDb.from("workflows").select("cliente_id").eq("id", post.workflow_id).single();
            if (wf?.cliente_id) {
              await svcDb.from("instagram_accounts").update({ authorization_status: "expired" }).eq("client_id", wf.cliente_id);
            }
          } catch (_) { /* best-effort */ }
        }

        return json({ error: err.message ?? "Erro ao publicar" }, 500);
      }
    }

    return json({ error: "Unknown action" }, 400);
  };
}
