// supabase/functions/instagram-publish-cron/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createPublishCronHandler } from "./handler.ts";
import {
  decryptToken,
  createSingleImageContainer,
  createVideoContainer,
  createCarouselChildContainer,
  createCarouselParentContainer,
  checkContainerStatus,
  publishContainer,
  fetchPermalink,
  processBatch,
} from "../_shared/instagram-publish-utils.ts";
import { signGetUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => { throw new Error("CRON_SECRET is required"); })();

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
}

// deno-lint-ignore no-explicit-any
async function claimPosts(
  db: any,
  phase: string,
): Promise<ClaimedPost[]> {
  const { data, error } = await db.rpc("claim_posts_for_publishing", {
    p_phase: phase,
    p_limit: 25,
  });
  if (error) {
    console.error(`[IG-PUBLISH] claim_posts_for_publishing(${phase}) error:`, error.message);
    return [];
  }
  return data ?? [];
}

// deno-lint-ignore no-explicit-any
async function fetchMediaForPost(
  db: any,
  postId: number,
): Promise<Array<{ id: number; kind: string; r2_key: string; sort_order: number }>> {
  const { data } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, r2_key)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((l: any) => ({
    id: l.files.id,
    kind: l.files.kind,
    r2_key: l.files.r2_key,
    sort_order: l.sort_order,
  }));
}

// deno-lint-ignore no-explicit-any
async function markFailed(
  db: any,
  postId: number,
  retryCount: number,
  errorMessage: string,
) {
  await db.from("workflow_posts").update({
    status: "falha_publicacao",
    publish_retry_count: retryCount + 1,
    publish_error: errorMessage.slice(0, 500),
    publish_processing_at: null,
  }).eq("id", postId);
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
  const media = await fetchMediaForPost(db, post.post_id);
  if (media.length === 0) throw new Error("No media files found");

  const isCarousel = media.length > 1;
  const isSingleVideo = media.length === 1 && media[0].kind === "video";

  let containerId: string;

  if (isCarousel) {
    const childIds: string[] = [];
    for (const m of media) {
      const url = await signGetUrl(m.r2_key, 7200);
      const child = await createCarouselChildContainer(
        post.instagram_user_id, token, url, m.kind === "video",
      );
      childIds.push(child.id);
    }
    const parent = await createCarouselParentContainer(
      post.instagram_user_id, token, childIds, post.ig_caption,
    );
    containerId = parent.id;
  } else if (isSingleVideo) {
    const url = await signGetUrl(media[0].r2_key, 7200);
    const container = await createVideoContainer(
      post.instagram_user_id, token, url, post.ig_caption,
    );
    containerId = container.id;
  } else {
    const url = await signGetUrl(media[0].r2_key, 7200);
    const container = await createSingleImageContainer(
      post.instagram_user_id, token, url, post.ig_caption,
    );
    containerId = container.id;
  }

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
  const containerId = post.instagram_container_id!;

  const status = await checkContainerStatus(containerId, token);
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

  console.log(`[IG-PUBLISH] Published post ${post.post_id}, media_id: ${result.id}`);

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
      const containerPosts = await claimPosts(db, "container");
      if (containerPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 1: ${containerPosts.length} posts to create containers`);
        const r1 = await processBatch(containerPosts, 5, 1000, async (post) => {
          try {
            await processContainerCreation(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message);
            throw err;
          }
        });
        summary.phase1 = { succeeded: r1.succeeded, failed: r1.failed };
      }

      // Phase 2: Publishing
      const publishPosts = await claimPosts(db, "publish");
      if (publishPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 2: ${publishPosts.length} posts to publish`);
        const r2 = await processBatch(publishPosts, 5, 1000, async (post) => {
          try {
            await processPublish(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message);
            throw err;
          }
        });
        summary.phase2 = { succeeded: r2.succeeded, failed: r2.failed };
      }

      // Phase 3: Retries
      const retryPosts = await claimPosts(db, "retry");
      if (retryPosts.length > 0) {
        console.log(`[IG-PUBLISH] Phase 3: ${retryPosts.length} posts to retry`);
        const r3 = await processBatch(retryPosts, 5, 1000, async (post) => {
          try {
            await processRetry(db, post);
          } catch (err: any) {
            await markFailed(db, post.post_id, post.publish_retry_count, err.message);
            throw err;
          }
        });
        summary.phase3 = { succeeded: r3.succeeded, failed: r3.failed };
      }

      console.log("[IG-PUBLISH] Cron complete:", JSON.stringify(summary));
      return new Response(JSON.stringify({ success: true, ...summary }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("[IG-PUBLISH] Cron failed:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
