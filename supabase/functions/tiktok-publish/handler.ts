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
  buildTikTokPostUrl,
  mapStatusFetch,
  markTikTokPublishFailed,
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
  TikTokApiError,
} from "../_shared/tiktok.ts";
import { isTikTokCannotPostCode, tiktokErrorMessage } from "../_shared/tiktok-messages.ts";
import {
  evaluateTikTokPrecheck,
  fetchCreatorCheck as realFetchCreatorCheck,
} from "../_shared/tiktok-precheck.ts";
import { buildTikTokMediaUrl as realBuildTikTokMediaUrl } from "../_shared/tiktok-media-url.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
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
  fetchCreatorCheck?: typeof realFetchCreatorCheck;
  buildTikTokMediaUrl?: typeof realBuildTikTokMediaUrl;
  sleep?: (ms: number) => Promise<void>;
}

/** A failure whose message is a curated pt-BR sentence: safe to persist and return (422). */
class TikTokUserFacingError extends Error {}

const PUBLISH_NOW_MAX_POLLS = 12;
const PUBLISH_NOW_POLL_INTERVAL_MS = 3000;

/** P4 RPC refusals (ERRCODE P0422, MESSAGE = identifier) mapped to curated pt-BR copy. */
const TARGET_REFUSALS: Record<string, string> = {
  target_publishing: "Já está publicando no TikTok.",
  target_published: "Já publicado no TikTok.",
  post_not_publishable: "Post precisa estar aprovado pelo cliente para publicar.",
  post_not_scheduled: "Apenas posts agendados podem ser cancelados.",
  target_not_ready: "O envio anterior para o TikTok falhou. Use Reenviar para tentar de novo.",
  target_not_found: "Este post não tem destino TikTok.",
};

function targetRefusal(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || e.code !== "P0422" || typeof e.message !== "string") return null;
  return TARGET_REFUSALS[e.message] ?? null;
}

interface TikTokTargetState {
  id: number;
  platform: string;
  status: string;
  processing_at: string | null;
}

/** The post's TikTok destination from the `targets_state` embed (P4: the only publish state). */
function tiktokTarget(post: { targets_state?: TikTokTargetState[] | null }): TikTokTargetState | null {
  return (post.targets_state ?? []).find((t) => t.platform === "tiktok") ?? null;
}

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

    const appAudited = Deno.env.get("TIKTOK_APP_AUDITED") === "true";
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
        can_post: true,
        app_audited: appAudited,
      });
    } catch (e) {
      // A6: TikTok answers "can't post right now" with HTTP 200 + a non-ok error.code, which
      // tiktokFetch surfaces as TikTokApiError.code. No `data` comes with it.
      if (e instanceof TikTokApiError && isTikTokCannotPostCode(e.code)) {
        return json({ can_post: false, cannot_post_reason: e.code, app_audited: appAudited });
      }
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
        "id, status, platform, tipo, tiktok_caption, tiktok_title, tiktok_settings, ig_caption, scheduled_at, " +
          "instagram_media_id, targets_state:post_targets(id, platform, status, processing_at)",
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

    const target = tiktokTarget(post);

    if (action === "schedule") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para agendar." }, 422);
      }

      // A still-publishing TikTok destination always refuses. A published one is never
      // re-claimed (init takes only pendente/agendado), so scheduling is refused only when nothing
      // else is left to publish: a TikTok-only post, or Instagram already published. A `both` post
      // whose Instagram side is pending (post moved to draft mid-publish after TikTok landed) may
      // be scheduled: Instagram goes out and the recompute reaches postado when it lands.
      if (target?.status === "processando") return json({ error: TARGET_REFUSALS.target_publishing }, 422);
      const tiktokDone = target?.status === "publicado";
      const instagramPending =
        (post.platform === "both" ||
          ((post.targets_state ?? []) as TikTokTargetState[]).some((t) => t.platform === "instagram")) &&
        !post.instagram_media_id;
      if (tiktokDone && !instagramPending) return json({ error: TARGET_REFUSALS.target_published }, 422);

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

      // TikTok already published: nothing left to validate on that side.
      let tiktokValidation: TikTokValidationResult | null = null;
      if (!tiktokDone) {
        try {
          tiktokValidation = await validateTikTok(svcDb as never, postId);
        } catch (e) {
          console.error("[TIKTOK-PUBLISH] schedule TikTok validation error:", (e as Error)?.message);
          const restoreFailure = await restoreScheduledAt();
          if (restoreFailure) return restoreFailure;
          return json({ error: "Erro ao validar post para agendamento no TikTok." }, 500);
        }
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

      const mergedErrors = [...(tiktokValidation?.errors ?? []), ...(igValidation?.errors ?? [])];
      const ok = (tiktokValidation ? tiktokValidation.ok : true) && (igValidation ? igValidation.ok : true);
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
        return json({ error: TARGET_REFUSALS.post_not_scheduled }, 422);
      }

      // One transaction: destination back to pendente, the Instagram handles cleared for a post
      // that also goes to Instagram, post back to aprovado_cliente (cancel_target_publish).
      const { error: rpcErr } = await svcDb.rpc("cancel_target_publish", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (rpcErr) {
        const refusal = targetRefusal(rpcErr);
        if (refusal) return json({ error: refusal }, 422);
        return internalServerError(json, "tiktok-publish:cancel", rpcErr);
      }

      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      // Accepts a post already back at agendado: Instagram's retry may have moved it first (bug 2).
      if (target?.status !== "falha" || !["agendado", "falha_publicacao"].includes(post.status)) {
        return json({ error: "Apenas posts com falha no TikTok podem ser reenviados." }, 422);
      }

      const { data: requeued, error: rpcErr } = await svcDb.rpc("requeue_target", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (rpcErr) return internalServerError(json, "tiktok-publish:retry", rpcErr);
      if (requeued !== true) {
        return json({ error: "Apenas posts com falha no TikTok podem ser reenviados." }, 422);
      }

      // The cron's init phase publishes the re-queued destination.
      return json({ ok: true, status: "agendado" });
    }

    if (action === "publish-now") {
      // agendado is accepted: Instagram's publish-now may have moved the post first (bug 1).
      if (post.status !== "aprovado_cliente" && post.status !== "agendado") {
        return json({ error: TARGET_REFUSALS.post_not_publishable }, 422);
      }
      if (target?.status === "processando") return json({ error: TARGET_REFUSALS.target_publishing }, 422);
      if (target?.status === "publicado") return json({ error: TARGET_REFUSALS.target_published }, 422);

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

      // One transaction: aprovado_cliente -> agendado (if needed) + the destination lock.
      const { data: began, error: beginErr } = await svcDb.rpc("begin_target_publish", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (beginErr) {
        const refusal = targetRefusal(beginErr);
        if (refusal) return json({ error: refusal }, 422);
        return internalServerError(json, "tiktok-publish:publish-now", beginErr);
      }
      if (began !== true) return json({ error: TARGET_REFUSALS.target_publishing }, 409);

      let validationFailure: Response | null = null;
      try {
        // A media replacement can commit after preflight while this request waits for
        // the workflow_posts row lock. Once processing is claimed, replacements are
        // blocked; read and validate that committed media before building provider URLs.
        try {
          validation = await validateTikTok(svcDb as never, postId, { skipDateCheck: true });
        } catch (e) {
          console.error("[TIKTOK-PUBLISH-NOW] claimed validation error:", (e as Error)?.message);
          // Validator infrastructure errors can contain private DB details. Only the
          // generic error may be persisted by the publishing failure cleanup below.
          throw new Error("Erro ao validar post para publicação no TikTok.");
        }
        if (!validation.ok) {
          validationFailure = json({ error: "Validação falhou", details: validation.errors }, 422);
          throw new Error("Validação do post para publicação no TikTok falhou.");
        }

        const account = validation.account!;
        const { accessToken } = await getFreshToken(svcDb as never, account.id);

        const creator = await (deps.fetchCreatorCheck ?? realFetchCreatorCheck)(tiktokFetchFn, accessToken);
        const precheckFailure = evaluateTikTokPrecheck({
          tipo: post.tipo,
          settings: post.tiktok_settings,
          media: (validation.media ?? []).map((m) => ({
            kind: m.kind,
            duration_seconds: m.duration_seconds,
            media_lost_at: m.media_lost_at ?? null,
          })),
          creator,
        });
        if (precheckFailure) throw new TikTokUserFacingError(precheckFailure);

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

        // Single-statement destination write; the lock stays held while this request polls.
        const { error: initErr } = await svcDb
          .from("post_targets")
          .update({ status: "processando", publish_ref: publishId, updated_at: new Date().toISOString() })
          .eq("post_id", postId)
          .eq("platform", "tiktok");
        if (initErr) {
          throw new Error(
            `post_targets update (init) failed: ${(initErr as { message?: string }).message}`,
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
          const permalink = statusResult.publicPostId && username
            ? buildTikTokPostUrl(username, statusResult.publicPostId, post.tipo)
            : undefined;

          const { error: markErr } = await svcDb.rpc("mark_target_published", {
            p_post_id: postId,
            p_platform: "tiktok",
            p_fields: {
              ...(statusResult.publicPostId ? { external_id: statusResult.publicPostId } : {}),
              ...(permalink ? { permalink } : {}),
              published_at: new Date().toISOString(),
            },
            p_source: "workspace_user",
            p_actor: actorId,
          });
          if (markErr) {
            throw new Error(
              `mark_target_published failed: ${(markErr as { message?: string }).message}`,
            );
          }

          return json({ ok: true, status: "postado" });
        }

        if (statusResult.state === "processing") {
          // Release the lock: the cron's status phase finishes the publish.
          const { error: clearLockErr } = await svcDb
            .from("post_targets")
            .update({ processing_at: null, updated_at: new Date().toISOString() })
            .eq("post_id", postId)
            .eq("platform", "tiktok");
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
        const mapped = err instanceof TikTokUserFacingError
          ? err.message
          : tiktokErrorMessage(err instanceof TikTokApiError ? err.code : undefined);
        const message = mapped ?? (err as Error)?.message ?? "Unknown error";
        console.error(`[TIKTOK-PUBLISH-NOW] failed for post ${postId}:`, (err as Error)?.message);

        // Destination -> falha and post -> falha_publicacao in one transaction (mark_target_failed).
        await markTikTokPublishFailed(svcDb, postId, message, {
          nonRetryable: !!mapped,
          source: "workspace_user",
          actorId,
        });

        if (validationFailure) return validationFailure;
        if (mapped) return json({ error: mapped }, 422);
        return internalServerError(json, "tiktok-publish:publish-now", err);
      }
    }

    return json({ error: "Unknown action" }, 400);
  };
}
