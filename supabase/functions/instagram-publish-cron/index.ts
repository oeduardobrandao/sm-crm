import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

const GRAPH_API = "https://graph.instagram.com/v21.0";

async function decryptToken(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decryptedBuf);
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find posts that are scheduled and whose scheduled_at has passed
    const { data: posts, error } = await supabase
      .from('workflow_posts')
      .select('id, instagram_container_id, scheduled_at, workflows!inner(cliente_id)')
      .eq('status', 'agendado')
      .lte('scheduled_at', new Date().toISOString());

    if (error) throw error;
    if (!posts || posts.length === 0) {
      return new Response("No posts to check", { status: 200 });
    }

    console.log(`[IG-PUBLISH-CRON] Checking ${posts.length} scheduled post(s)`);

    let confirmedCount = 0;
    let failedCount = 0;

    for (const post of posts) {
      try {
        const clienteId = (post as any).workflows.cliente_id;

        const { data: igAccount } = await supabase
          .from('instagram_accounts')
          .select('encrypted_access_token')
          .eq('client_id', clienteId)
          .single();

        if (!igAccount || !post.instagram_container_id) {
          failedCount++;
          continue;
        }

        const token = await decryptToken(igAccount.encrypted_access_token);

        // Check if the container has been published by Meta
        const res = await fetch(
          `${GRAPH_API}/${post.instagram_container_id}?fields=status_code,id&access_token=${token}`
        );
        const data = await res.json();

        const isPublished = data.status_code === 'PUBLISHED' || data.status_code === 'FINISHED';

        if (isPublished || data.error) {
          await supabase
            .from('workflow_posts')
            .update({
              status: 'postado',
              instagram_media_id: data.id || post.instagram_container_id,
            })
            .eq('id', post.id);

          // Clean up media from storage
          const { data: mediaItems } = await supabase
            .from('post_media')
            .select('storage_path')
            .eq('post_id', post.id);

          if (mediaItems && mediaItems.length > 0) {
            const paths = mediaItems.map((m: any) => m.storage_path);
            await supabase.storage.from('post-media').remove(paths);
            await supabase.from('post_media').delete().eq('post_id', post.id);
          }

          confirmedCount++;
          console.log(`[IG-PUBLISH-CRON] Confirmed post ${post.id}`);
        }
      } catch (err: any) {
        console.error(`[IG-PUBLISH-CRON] Error checking post ${post.id}:`, err);
        failedCount++;
      }
    }

    console.log(`[IG-PUBLISH-CRON] Done. Confirmed: ${confirmedCount}, Failed: ${failedCount}`);

    return new Response(JSON.stringify({
      success: true,
      confirmed: confirmedCount,
      failed: failedCount,
      total: posts.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error("[IG-PUBLISH-CRON] Cron Job Failed", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
