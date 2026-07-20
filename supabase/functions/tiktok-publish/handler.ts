// supabase/functions/tiktok-publish/handler.ts
//
// TikTok's counterpart to instagram-publish/handler.ts (deps-injection shape, gateway-JWT +
// manual actor resolution, /{action}/{id} route parsing). Routes: creator-info, schedule,
// publish-now, cancel, retry. Feature-gate scope mirrors instagram-publish's deliberate
// asymmetry (instagram-publish/handler.ts:89-94, spec: docs/superpowers/specs/
// 2026-07-17-tiktok-integration-design.md, task B4): only schedule, publish-now, and
// creator-info (creator-info exists solely to drive the scheduling UI, so it stays gated)
// require feature_post_scheduling + feature_tiktok. cancel and retry run UNGATED — a
// workspace that downgrades off TikTok must still be able to cancel or retry its own
// already-committed posts, or they'd be trapped in "agendado"/"falha_publicacao" with no way
// out (ownership checks still apply regardless of gating).
//
// DI seams: validateForTikTokScheduling / validateForScheduling (IG) / getFreshTikTokToken /
// tiktokFetch / buildTikTokMediaUrl / sleep are all injectable via deps, defaulting to the real
// shared implementations. This lets tests spy on "was the IG validator called for a `both`
// post" without any network/DB-crypto wiring, and lets the publish-now poll loop run its full
// 12-iteration bound instantly in tests (mirrors _shared/tiktok.ts's own `opts.sleep` seam).
//
// buildTikTokMediaUrl (_shared/tiktok-media-url.ts) mints a TikTok-verifiable proxy URL for the
// TikTok init payload's video_url/photo_images — NOT a raw R2 presign (signGetUrl): TikTok's
// PULL_FROM_URL source requires media URLs under a TikTok-verifiable URL prefix, which raw
// *.r2.cloudflarestorage.com presigned URLs can't satisfy.

import { createJsonResponder, internalServerError, type JsonResponder } from "../_shared/http.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import {
  validateForTikTokScheduling as realValidateForTikTokScheduling,
  buildVideoInitPayload,
  buildPhotoInitPayload,
  mapStatusFetch,
  type TikTokValidationResult,
  type ClaimedTikTokPost,
  type StatusFetchResult,
} from "../_shared/tiktok-publish-utils.ts";
import {
  validateForScheduling as realValidateForScheduling,
  type ScheduleValidationResult,
} from "../_shared/instagram-publish-utils.ts";
import {
  getFreshTikTokToken as realGetFreshTikTokToken,
  tiktokFetch as realTiktokFetch,
} from "../_shared/tiktok.ts";
import { buildTikTokMediaUrl as realBuildTikTokMediaUrl } from "../_shared/tiktok-media-url.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};

const VALID_ACTIONS = ["creator-info", "schedule", "publish-now", "cancel", "retry"];

export interface TikTokPublishDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: (token: string) => DbClient;
  createServiceDb: () => DbClient;
  validateForTikTokScheduling?: typeof realValidateForTikTokScheduling;
  validateForScheduling?: typeof realValidateForScheduling;
  getFreshTikTokToken?: typeof realGetFreshTikTokToken;
  tiktokFetch?: typeof realTiktokFetch;
  buildTikTokMediaUrl?: typeof realBuildTikTokMediaUrl;
  sleep?: (ms: number) => Promise<void>;
}

const PUBLISH_NOW_MAX_POLLS = 12;
const PUBLISH_NOW_POLL_INTERVAL_MS = 3000;

export function createPublishHandler(deps: TikTokPublishDeps) {
  const validateTikTok = deps.validateForTikTokScheduling ?? realValidateForTikTokScheduling;
  const validateIG = deps.validateForScheduling ?? realValidateForScheduling;
  const getFreshToken = deps.getFreshTikTokToken ?? realGetFreshTikTokToken;
  const tiktokFetchFn = deps.tiktokFetch ?? realTiktokFetch;
  const buildMediaUrl = deps.buildTikTokMediaUrl ?? realBuildTikTokMediaUrl;
  const sleepFn = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Gated routes (schedule, publish-now, creator-info) require BOTH flags — TikTok is a
  // separate paid add-on from generic scheduling. cancel/retry never call this.
  async function requireFeatureGates(
    svcDb: DbClient,
    contaId: string,
    json: JsonResponder,
  ): Promise<Response | null> {
    if (!(await effectivePlanFeature(svcDb as never, contaId, "feature_post_scheduling"))) {
      return json({ error: "feature_disabled", feature: "feature_post_scheduling" }, 403);
    }
    if (!(await effectivePlanFeature(svcDb as never, contaId, "feature_tiktok"))) {
      return json({ error: "feature_disabled", feature: "feature_tiktok" }, 403);
    }
    return null;
  }

  async function handleCreatorInfo(
    svcDb: DbClient,
    clientId: number,
    actorId: string | null,
    json: JsonResponder,
  ): Promise<Response> {
    const { data: actorProfile } = await svcDb.from("profiles").select("conta_id").eq("id", actorId).single();
    const contaId = actorProfile?.conta_id as string | undefined;
    if (!contaId) return json({ error: "Unauthorized" }, 403);

    const { data: client } = await svcDb.from("clientes").select("conta_id").eq("id", clientId).single();
    if (!client || (client as { conta_id?: string }).conta_id !== contaId) {
      return json({ error: "Unauthorized" }, 403);
    }

    const gateFailure = await requireFeatureGates(svcDb, contaId, json);
    if (gateFailure) return gateFailure;

    const { data: account } = await svcDb
      .from("tiktok_accounts")
      .select("id, authorization_status")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!account) return json({ error: "Cliente não tem conta TikTok conectada." }, 404);
    if ((account as { authorization_status?: string }).authorization_status !== "active") {
      return json({ error: "Conta do TikTok não está ativa. Reconecte a conta." }, 422);
    }

    try {
      const { accessToken } = await getFreshToken(svcDb as never, (account as { id: string }).id);
      const data = (await tiktokFetchFn("/post/publish/creator_info/query/", {
        method: "POST",
        accessToken,
        body: JSON.stringify({}),
      })) as Record<string, unknown>;

      return json({
        creator_nickname: data.creator_nickname,
        creator_avatar_url: data.creator_avatar_url,
        privacy_level_options: data.privacy_level_options,
        comment_disabled: data.comment_disabled,
        duet_disabled: data.duet_disabled,
        stitch_disabled: data.stitch_disabled,
        max_video_post_duration_sec: data.max_video_post_duration_sec,
      });
    } catch (e) {
      console.error("[TIKTOK-PUBLISH] creator-info error:", (e as Error)?.message);
      return json({ error: "Erro ao consultar informações do criador no TikTok." }, 500);
    }
  }

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    // creator-info is an audit requirement: never cached, on every response (success or error).
    const noStoreJson = createJsonResponder({ ...cors, "Cache-Control": "no-store" });

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const jwt = authHeader.slice(7);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Expected: /tiktok-publish/{action}/{id}
    const action = pathParts[1];
    if (!VALID_ACTIONS.includes(action)) return json({ error: "Invalid action" }, 400);

    const userDb = deps.createDb(jwt);
    const svcDb = deps.createServiceDb();
    const { data: { user: actorUser } } = await svcDb.auth.getUser(jwt);
    const actorId = actorUser?.id ?? null;

    if (action === "creator-info") {
      if (req.method !== "GET") return noStoreJson({ error: "Method not allowed" }, 405);
      const clientId = parseInt(pathParts[2], 10);
      if (isNaN(clientId)) return noStoreJson({ error: "Invalid client ID" }, 400);
      return handleCreatorInfo(svcDb, clientId, actorId, noStoreJson);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const postId = parseInt(pathParts[2], 10);
    if (isNaN(postId)) return json({ error: "Invalid post ID" }, 400);

    const { data: post } = await userDb
      .from("workflow_posts")
      .select(
        "id, status, platform, tipo, tiktok_publish_status, tiktok_publish_error, " +
          "tiktok_publish_retry_count, tiktok_caption, tiktok_title, tiktok_settings, ig_caption, scheduled_at",
      )
      .eq("id", postId)
      .single();
    if (!post) return json({ error: "Post não encontrado." }, 404);

    const { data: actorProfile } = await svcDb.from("profiles").select("conta_id").eq("id", actorId).single();
    const contaId = actorProfile?.conta_id as string | undefined;
    if (!contaId) return json({ error: "Unauthorized" }, 403);

    // Gate scope mirrors instagram-publish's asymmetry: only schedule/publish-now require the
    // paid feature flags (creator-info is gated separately above, inside handleCreatorInfo).
    // cancel/retry stay ungated so a downgraded workspace can still cancel or retry its own
    // already-committed posts instead of leaving them trapped.
    if (action === "schedule" || action === "publish-now") {
      const gateFailure = await requireFeatureGates(svcDb, contaId, json);
      if (gateFailure) return gateFailure;
    }

    if (!["tiktok", "both"].includes(post.platform)) {
      return json(
        { error: "Este post é apenas Instagram. Use o endpoint instagram-publish para essa ação." },
        400,
      );
    }

    if (action === "schedule") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para agendar." }, 422);
      }

      let body: { scheduled_at?: string } = {};
      try {
        body = await req.json();
      } catch {
        // treated as missing below
      }
      if (!body?.scheduled_at) {
        return json({ error: "Data de publicação (scheduled_at) é obrigatória." }, 400);
      }

      // Both validators read scheduled_at from the DB row, so the candidate value has to be
      // persisted before validating. If validation then fails (422) or a validator infra-throws,
      // that write must be rolled back to the post's prior value — otherwise a failed schedule
      // attempt silently overwrites (or clears) whatever scheduled_at the post had before.
      const priorScheduledAt = post.scheduled_at ?? null;

      const { error: schedErr } = await svcDb
        .from("workflow_posts")
        .update({ scheduled_at: body.scheduled_at })
        .eq("id", postId);
      if (schedErr) return internalServerError(json, "tiktok-publish:schedule", schedErr);

      // Restores scheduled_at to its prior value. Returns a Response to send instead of the
      // original failure (generic 500) if the restore write itself errors; null on success.
      const restoreScheduledAt = async (): Promise<Response | null> => {
        const { error: restoreErr } = await svcDb
          .from("workflow_posts")
          .update({ scheduled_at: priorScheduledAt })
          .eq("id", postId);
        if (restoreErr) return internalServerError(json, "tiktok-publish:schedule:restore", restoreErr);
        return null;
      };

      let tiktokValidation: TikTokValidationResult;
      try {
        tiktokValidation = await validateTikTok(svcDb as never, postId);
      } catch (e) {
        console.error("[TIKTOK-PUBLISH] schedule TikTok validation error:", (e as Error)?.message);
        const restoreFailure = await restoreScheduledAt();
        if (restoreFailure) return restoreFailure;
        return json({ error: "Erro ao validar post para agendamento no TikTok." }, 500);
      }

      let igValidation: ScheduleValidationResult | null = null;
      if (post.platform === "both") {
        try {
          igValidation = await validateIG(svcDb as never, postId);
        } catch (e) {
          console.error("[TIKTOK-PUBLISH] schedule IG validation error:", (e as Error)?.message);
          const restoreFailure = await restoreScheduledAt();
          if (restoreFailure) return restoreFailure;
          return json({ error: "Erro ao validar post para agendamento no Instagram." }, 500);
        }
      }

      const mergedErrors = [...tiktokValidation.errors, ...(igValidation?.errors ?? [])];
      const ok = tiktokValidation.ok && (igValidation ? igValidation.ok : true);
      if (!ok) {
        const restoreFailure = await restoreScheduledAt();
        if (restoreFailure) return restoreFailure;
        return json({ error: "Validação falhou", details: mergedErrors }, 422);
      }

      const { error: rpcErr } = await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: { scheduled_at: body.scheduled_at },
      });
      if (rpcErr) return internalServerError(json, "tiktok-publish:schedule", rpcErr);

      return json({ ok: true, status: "agendado" });
    }

    if (action === "cancel") {
      if (post.status !== "agendado") {
        return json({ error: "Apenas posts agendados podem ser cancelados." }, 422);
      }

      const { error: clearErr } = await svcDb
        .from("workflow_posts")
        .update({
          tiktok_publish_id: null,
          tiktok_publish_status: null,
          tiktok_publish_error: null,
          tiktok_publish_processing_at: null,
        })
        .eq("id", postId);
      if (clearErr) return internalServerError(json, "tiktok-publish:cancel", clearErr);

      const { error: rpcErr } = await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "aprovado_cliente",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: post.platform === "both"
          ? { instagram_container_id: null, publish_processing_at: null, publish_error: null }
          : {},
      });
      if (rpcErr) return internalServerError(json, "tiktok-publish:cancel", rpcErr);

      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      if (post.status !== "falha_publicacao" || post.tiktok_publish_status !== "failed") {
        return json({ error: "Apenas posts com falha no TikTok podem ser reenviados." }, 422);
      }

      const { error: clearErr } = await svcDb
        .from("workflow_posts")
        .update({ tiktok_publish_status: null, tiktok_publish_error: null })
        .eq("id", postId);
      if (clearErr) return internalServerError(json, "tiktok-publish:retry", clearErr);

      const { error: rpcErr } = await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {},
      });
      if (rpcErr) return internalServerError(json, "tiktok-publish:retry", rpcErr);

      return json({ ok: true, status: "agendado" });
    }

    if (action === "publish-now") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para publicar." }, 422);
      }

      let validation: TikTokValidationResult;
      try {
        validation = await validateTikTok(svcDb as never, postId, { skipDateCheck: true });
      } catch (e) {
        console.error("[TIKTOK-PUBLISH-NOW] validation error:", (e as Error)?.message);
        return json({ error: "Erro ao validar post para publicação no TikTok." }, 500);
      }
      if (!validation.ok) {
        return json({ error: "Validação falhou", details: validation.errors }, 422);
      }

      const { error: statusErr } = await svcDb.rpc("record_post_status_change", {
        p_post_id: postId,
        p_new_status: "agendado",
        p_source: "workspace_user",
        p_actor: actorId,
        p_fields: {},
      });
      if (statusErr) return internalServerError(json, "tiktok-publish:publish-now", statusErr);

      const { error: lockErr } = await svcDb
        .from("workflow_posts")
        .update({ tiktok_publish_processing_at: new Date().toISOString() })
        .eq("id", postId);
      if (lockErr) return internalServerError(json, "tiktok-publish:publish-now", lockErr);

      try {
        const account = validation.account!;
        const { accessToken } = await getFreshToken(svcDb as never, account.id);

        const claimedPost: ClaimedTikTokPost = {
          tipo: post.tipo,
          caption: post.tiktok_caption ?? post.ig_caption ?? "",
          tiktok_title: post.tiktok_title ?? null,
          tiktok_settings: post.tiktok_settings ?? {},
        };

        const media = validation.media ?? [];
        let initPath: string;
        let initPayload: object;
        if (post.tipo === "reels") {
          const videoUrl = await buildMediaUrl(media[0].r2_key, 7200);
          initPath = "/post/publish/video/init/";
          initPayload = buildVideoInitPayload(claimedPost, videoUrl);
        } else {
          const imageUrls = await Promise.all(media.map((m) => buildMediaUrl(m.r2_key, 7200)));
          initPath = "/post/publish/content/init/";
          initPayload = buildPhotoInitPayload(claimedPost, imageUrls);
        }

        const initResult = (await tiktokFetchFn(initPath, {
          method: "POST",
          accessToken,
          body: JSON.stringify(initPayload),
        })) as { publish_id?: string };
        const publishId = initResult?.publish_id;
        if (!publishId) throw new Error("TikTok init did not return a publish_id");

        const { error: initErr } = await svcDb
          .from("workflow_posts")
          .update({ tiktok_publish_id: publishId, tiktok_publish_status: "initiated" })
          .eq("id", postId);
        if (initErr) {
          throw new Error(
            `workflow_posts update (init) failed: ${(initErr as { message?: string }).message}`,
          );
        }

        let statusResult: StatusFetchResult = { state: "processing" };
        for (let i = 0; i < PUBLISH_NOW_MAX_POLLS; i++) {
          const statusData = await tiktokFetchFn("/post/publish/status/fetch/", {
            method: "POST",
            accessToken,
            body: JSON.stringify({ publish_id: publishId }),
          });
          statusResult = mapStatusFetch(statusData);
          if (statusResult.state !== "processing") break;
          if (i < PUBLISH_NOW_MAX_POLLS - 1) await sleepFn(PUBLISH_NOW_POLL_INTERVAL_MS);
        }

        if (statusResult.state === "published") {
          const { data: accountRow } = await svcDb
            .from("tiktok_accounts")
            .select("username")
            .eq("id", account.id)
            .maybeSingle();
          const username = (accountRow as { username?: string } | null)?.username;
          const tiktokPostUrl = statusResult.publicPostId && username
            ? `https://www.tiktok.com/@${username}/video/${statusResult.publicPostId}`
            : undefined;

          const { error: markErr } = await svcDb.rpc("mark_platform_published", {
            p_post_id: postId,
            p_platform: "tiktok",
            p_source: "workspace_user",
            p_actor: actorId,
            p_fields: {
              ...(statusResult.publicPostId ? { tiktok_post_id: statusResult.publicPostId } : {}),
              ...(tiktokPostUrl ? { tiktok_post_url: tiktokPostUrl } : {}),
              published_at: new Date().toISOString(),
            },
          });
          if (markErr) {
            throw new Error(
              `mark_platform_published failed: ${(markErr as { message?: string }).message}`,
            );
          }

          return json({ ok: true, status: "postado" });
        }

        if (statusResult.state === "processing") {
          const { error: clearLockErr } = await svcDb
            .from("workflow_posts")
            .update({ tiktok_publish_processing_at: null })
            .eq("id", postId);
          if (clearLockErr) {
            console.error(
              "[TIKTOK-PUBLISH-NOW] failed to clear processing lock:",
              (clearLockErr as { message?: string }).message,
            );
          }
          return json({
            ok: true,
            status: "agendado",
            message: "TikTok ainda processando. A publicação será concluída automaticamente em instantes.",
          });
        }

        // statusResult.state === "failed"
        throw new Error(
          statusResult.failReason ? `TikTok publish failed: ${statusResult.failReason}` : "TikTok publish failed",
        );
      } catch (err) {
        const message = (err as Error)?.message ?? "Unknown error";
        console.error(`[TIKTOK-PUBLISH-NOW] failed for post ${postId}:`, message);

        const { error: failErr } = await svcDb
          .from("workflow_posts")
          .update({
            tiktok_publish_status: "failed",
            tiktok_publish_error: message.slice(0, 500),
            tiktok_publish_retry_count: (post.tiktok_publish_retry_count ?? 0) + 1,
            tiktok_publish_processing_at: null,
          })
          .eq("id", postId);
        if (failErr) {
          console.error(
            "[TIKTOK-PUBLISH-NOW] failed to persist failure state:",
            (failErr as { message?: string }).message,
          );
        }

        const { error: statusRpcErr } = await svcDb.rpc("record_post_status_change", {
          p_post_id: postId,
          p_new_status: "falha_publicacao",
          p_source: "workspace_user",
          p_actor: actorId,
          p_fields: {},
        });
        if (statusRpcErr) {
          console.error(
            "[TIKTOK-PUBLISH-NOW] failed to record status change:",
            (statusRpcErr as { message?: string }).message,
          );
        }

        return internalServerError(json, "tiktok-publish:publish-now", err);
      }
    }

    return json({ error: "Unknown action" }, 400);
  };
}
