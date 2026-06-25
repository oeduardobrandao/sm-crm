// supabase/functions/instagram-publish-cron/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createPublishCronHandler } from "./handler.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  decryptToken,
  createContainerForPost,
  pollContainerReady,
  publishContainer,
  fetchPermalink,
  processBatch,
  createMissingStorySegmentContainers,
  publishReadyStorySegments,
} from "../_shared/instagram-publish-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => { throw new Error("CRON_SECRET is required"); })();

// Per-phase claim limits keep a single cron run bounded. The publish/retry phases
// poll the Instagram container in-run (≤ ~6s each), so they're capped lower than
// container creation to stay under the edge-function wall-clock at 1-min cadence.
const CONTAINER_LIMIT = 25;
const PUBLISH_LIMIT = 10;
const RETRY_LIMIT = 10;

interface ClaimedPost {
  post_id: number;
  workflow_id: number;
  ig_caption: string;
  scheduled_at: string;
  instagram_container_id: string | null;
  instagram_media_id: string | null;
  publish_retry_count: number;
  tipo: string;
  encrypted_access_token: string;
  instagram_user_id: string;
  client_id: number;
  story_segments: Array<{ file_id: number; container_id: string | null; media_id: string | null }> | null;
}

// deno-lint-ignore no-explicit-any
async function claimPosts(
  db: any,
  phase: string,
  limit: number,
): Promise<ClaimedPost[]> {
  const { data, error } = await db.rpc("claim_posts_for_publishing", {
    p_phase: phase,
    p_limit: limit,
  });
  if (error) {
    console.error(`[IG-PUBLISH] claim_posts_for_publishing(${phase}) error:`, error.message);
    return [];
  }
  return data ?? [];
}

// deno-lint-ignore no-explicit-any
async function markFailed(
  db: any,
  postId: number,
  retryCount: number,
  errorMessage: string,
  clientId?: number,
  errorCode?: string,
) {
  await db.from("workflow_posts").update({
    status: "falha_publicacao",
    publish_retry_count: retryCount + 1,
    publish_error: errorMessage.slice(0, 500),
    publish_processing_at: null,
  }).eq("id", postId);

  if (errorCode === 'TOKEN_EXPIRED' && clientId) {
    await db.from("instagram_accounts").update({ authorization_status: "expired" }).eq("client_id", clientId);
  }
}

// deno-lint-ignore no-explicit-any
async function clearLock(db: any, postId: number) {
  await db.from("workflow_posts").update({ publish_processing_at: null }).eq("id", postId);
}

// --- Phase 1: Container Creation ---
// deno-lint-ignore no-explicit-any
async function processContainerCreation(
  db: any,
  post: ClaimedPost,
) {
  const token = await decryptToken(post.encrypted_access_token);

  if (post.tipo === "stories") {
    await createMissingStorySegmentContainers(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    await db.from("workflow_posts").update({ publish_processing_at: null }).eq("id", post.post_id);
    console.log(`[IG-PUBLISH] Story containers ensured for post ${post.post_id}`);
    return;
  }

  // First attempt carries the cover; any retry drops it (useCover:false) so a cover
  // Instagram can't process can't make a scheduled post fail permanently. The
  // coverless retry is deferred to the next cron cycle (publish_retry_count > 0).
  const { containerId } = await createContainerForPost(db, {
    igUserId: post.instagram_user_id,
    token,
    postId: post.post_id,
    caption: post.ig_caption,
    useCover: post.publish_retry_count === 0,
    tipo: post.tipo,
  });

  await db.from("workflow_posts").update({
    instagram_container_id: containerId,
    publish_processing_at: null,
  }).eq("id", post.post_id);

  console.log(`[IG-PUBLISH] Container created for post ${post.post_id}: ${containerId}`);
}

// --- Phase 2: Publishing ---
// deno-lint-ignore no-explicit-any
async function processPublish(
  db: any,
  post: ClaimedPost,
) {
  const token = await decryptToken(post.encrypted_access_token);

  if (post.tipo === "stories") {
    const { segments, allDone } = await publishReadyStorySegments(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    if (!allDone) {
      await clearLock(db, post.post_id);
      console.log(`[IG-PUBLISH] Story post ${post.post_id} partially published, will continue next cycle`);
      return;
    }
    const firstMediaId = segments[0]?.media_id ?? null;
    await db.from("workflow_posts").update({
      instagram_media_id: firstMediaId,
      status: "postado",
      published_at: new Date().toISOString(),
      publish_processing_at: null,
      publish_error: null,
      publish_retry_count: 0,
    }).eq("id", post.post_id);
    console.log(`[IG-PUBLISH] Published story post ${post.post_id} (${segments.length} segments)`);
    const permalink = firstMediaId ? await fetchPermalink(firstMediaId, token) : null;
    if (permalink) {
      await db.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", post.post_id);
    }
    return;
  }

  const containerId = post.instagram_container_id!;

  // Poll briefly in-run so a container that finishes mid-cycle publishes now
  // instead of waiting a whole cron cycle. Kept short to bound wall-clock; if it
  // is still processing we bail and the next (1-min) cron run retries.
  const status = await pollContainerReady(containerId, token, 2, 3000);
  if (status === "IN_PROGRESS") {
    console.log(`[IG-PUBLISH] Container ${containerId} still processing, skipping post ${post.post_id}`);
    await clearLock(db, post.post_id);
    return;
  }
  if (status === "ERROR") {
    throw new Error("Container failed processing on Instagram's side");
  }

  const result = await publishContainer(post.instagram_user_id, token, containerId);

  await db.from("workflow_posts").update({
    instagram_media_id: result.id,
    status: "postado",
    published_at: new Date().toISOString(),
    publish_processing_at: null,
    publish_error: null,
    publish_retry_count: 0,
  }).eq("id", post.post_id);

  const lateS = Math.round((Date.now() - new Date(post.scheduled_at).getTime()) / 1000);
  console.log(`[IG-PUBLISH] Published post ${post.post_id}, media_id: ${result.id}, late_s: ${lateS}`);

  const permalink = await fetchPermalink(result.id, token);
  if (permalink) {
    await db.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", post.post_id);
  }
}

// --- Phase 3: Retries ---
// deno-lint-ignore no-explicit-any
async function processRetry(
  db: any,
  post: ClaimedPost,
) {
  if (post.tipo === "stories") {
    const token = await decryptToken(post.encrypted_access_token);
    await createMissingStorySegmentContainers(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    const { segments, allDone } = await publishReadyStorySegments(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    if (allDone) {
      await db.from("workflow_posts").update({
        instagram_media_id: segments[0]?.media_id ?? null,
        status: "postado",
        published_at: new Date().toISOString(),
        publish_processing_at: null,
        publish_error: null,
        publish_retry_count: 0,
      }).eq("id", post.post_id);
    } else {
      await db.from("workflow_posts").update({ status: "agendado", publish_processing_at: null }).eq("id", post.post_id);
    }
    return;
  }

  if (!post.instagram_container_id) {
    await processContainerCreation(db, post);
    await db.from("workflow_posts").update({ status: "agendado" }).eq("id", post.post_id);
  } else if (!post.instagram_media_id) {
    await processPublish(db, post);
  }
}

Deno.serve(createPublishCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const summary = { phase1: { succeeded: 0, failed: 0 }, phase2: { succeeded: 0, failed: 0 }, phase3: { succeeded: 0, failed: 0 } };

    try {
      // Phase 1: Container Creation
      const containerPosts = await claimPosts(db, "container", CONTAINER_LIMIT);
      if (containerPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 1: ${containerPosts.length} posts to create containers`);
        const r1 = await processBatch(containerPosts, 5, 1000, async (post) => {
          try {
            await processContainerCreation(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message, post.client_id, err.code);
            throw err;
          }
        });
        summary.phase1 = { succeeded: r1.succeeded, failed: r1.failed };
      }

      // Phase 2: Publishing
      const publishPosts = await claimPosts(db, "publish", PUBLISH_LIMIT);
      if (publishPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 2: ${publishPosts.length} posts to publish`);
        const r2 = await processBatch(publishPosts, 5, 1000, async (post) => {
          try {
            await processPublish(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message, post.client_id, err.code);
            throw err;
          }
        });
        summary.phase2 = { succeeded: r2.succeeded, failed: r2.failed };
      }

      // Phase 3: Retries
      const retryPosts = await claimPosts(db, "retry", RETRY_LIMIT);
      if (retryPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 3: ${retryPosts.length} posts to retry`);
        const r3 = await processBatch(retryPosts, 5, 1000, async (post) => {
          try {
            await processRetry(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message, post.client_id, err.code);
            throw err;
          }
        });
        summary.phase3 = { succeeded: r3.succeeded, failed: r3.failed };
      }

      console.log("[IG-PUBLISH] Cron complete:", JSON.stringify(summary));

      const totalFailed = summary.phase1.failed + summary.phase2.failed + summary.phase3.failed;
      if (totalFailed > 0) {
        await reportCronFailure(db, 'instagram-publish-cron', {
          total: summary.phase1.succeeded + summary.phase1.failed + summary.phase2.succeeded + summary.phase2.failed + summary.phase3.succeeded + summary.phase3.failed,
          failed: totalFailed,
          errors: [{ error: `Phase1: ${summary.phase1.failed}, Phase2: ${summary.phase2.failed}, Phase3: ${summary.phase3.failed}` }],
        });
      }

      return new Response(JSON.stringify({ success: true, ...summary }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("[IG-PUBLISH] Cron failed:", err);
      await reportCronFailure(db, 'instagram-publish-cron', { total: 0, failed: 1, errors: [{ error: err.message }], stack: err?.stack });
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
