// supabase/functions/instagram-publish/handler.ts

import { createJsonResponder } from "../_shared/http.ts";
import {
  validateForScheduling,
  decryptToken,
  createSingleImageContainer,
  createVideoContainer,
  createCarouselChildContainer,
  createCarouselParentContainer,
  pollContainerReady,
  publishContainer,
  fetchPermalink,
} from "../_shared/instagram-publish-utils.ts";
import { signGetUrl } from "../_shared/r2.ts";

type DbClient = { from: (table: string) => any };

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

    // Verify post exists and user has access (via RLS)
    const { data: post } = await userDb
      .from("workflow_posts")
      .select("id, status, workflow_id, scheduled_at, ig_caption, instagram_container_id, publish_retry_count")
      .eq("id", postId)
      .single();

    if (!post) return json({ error: "Post não encontrado." }, 404);

    if (action === "schedule") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para agendar." }, 422);
      }
      try {
        const validation = await validateForScheduling(svcDb, postId);
        if (!validation.ok) {
          return json({ error: "Validação falhou", details: validation.errors }, 422);
        }
      } catch (e) {
        console.error("Schedule validation error:", e);
        return json({ error: "Erro ao validar post para agendamento." }, 500);
      }
      await svcDb.from("workflow_posts")
        .update({ status: "agendado" })
        .eq("id", postId);
      return json({ ok: true, status: "agendado" });
    }

    if (action === "cancel") {
      if (post.status !== "agendado") {
        return json({ error: "Apenas posts agendados podem ser cancelados." }, 422);
      }
      await svcDb.from("workflow_posts").update({
        status: "aprovado_cliente",
        instagram_container_id: null,
        publish_processing_at: null,
        publish_error: null,
      }).eq("id", postId);
      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      if (post.status !== "falha_publicacao") {
        return json({ error: "Apenas posts com falha podem ser reenviados." }, 422);
      }
      await svcDb.from("workflow_posts").update({
        status: "agendado",
        publish_retry_count: 0,
        publish_error: null,
        instagram_container_id: null,
        publish_processing_at: null,
      }).eq("id", postId);
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

      await svcDb.from("workflow_posts").update({
        status: "agendado",
        publish_processing_at: new Date().toISOString(),
      }).eq("id", postId);

      try {
        const token = await decryptToken(validation.account!.encrypted_access_token);
        const igUserId = validation.account!.instagram_user_id;

        const { data: links } = await svcDb
          .from("post_file_links")
          .select("sort_order, files!inner(id, kind, r2_key)")
          .eq("post_id", postId)
          .order("sort_order", { ascending: true });

        const media = (links ?? []).map((l: any) => ({
          id: l.files.id,
          kind: l.files.kind,
          r2_key: l.files.r2_key,
          sort_order: l.sort_order,
        }));

        if (media.length === 0) throw new Error("Post sem mídia");

        const isCarousel = media.length > 1;
        const isSingleVideo = media.length === 1 && media[0].kind === "video";
        let containerId: string;

        if (isCarousel) {
          const childIds: string[] = [];
          for (const m of media) {
            const url = await signGetUrl(m.r2_key, 7200);
            const child = await createCarouselChildContainer(igUserId, token, url, m.kind === "video");
            childIds.push(child.id);
          }
          const parent = await createCarouselParentContainer(igUserId, token, childIds, post.ig_caption);
          containerId = parent.id;
        } else if (isSingleVideo) {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const container = await createVideoContainer(igUserId, token, url, post.ig_caption);
          containerId = container.id;
        } else {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const container = await createSingleImageContainer(igUserId, token, url, post.ig_caption);
          containerId = container.id;
        }

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);

        const containerStatus = await pollContainerReady(containerId, token, 12, 3000);

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

        await svcDb.from("workflow_posts").update({
          instagram_media_id: result.id,
          status: "postado",
          published_at: new Date().toISOString(),
          publish_processing_at: null,
          publish_error: null,
          publish_retry_count: 0,
        }).eq("id", postId);

        console.log(`[IG-PUBLISH-NOW] Published post ${postId}, media_id: ${result.id}`);

        const permalink = await fetchPermalink(result.id, token);
        if (permalink) {
          await svcDb.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", postId);
        }

        return json({ ok: true, status: "postado", instagram_permalink: permalink });
      } catch (err: any) {
        console.error(`[IG-PUBLISH-NOW] Failed for post ${postId}:`, err.message);
        await svcDb.from("workflow_posts").update({
          status: "falha_publicacao",
          publish_error: (err.message ?? "Unknown error").slice(0, 500),
          publish_processing_at: null,
        }).eq("id", postId);
        return json({ error: err.message ?? "Erro ao publicar" }, 500);
      }
    }

    return json({ error: "Unknown action" }, 400);
  };
}
