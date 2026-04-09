import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

const GRAPH_API = "https://graph.instagram.com/v21.0";

// --- Token Decryption ---
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// --- Helpers: Meta Container Creation ---

async function createImageContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
  caption?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, string> = { image_url: imageUrl, access_token: token };
  if (caption) params.caption = caption;
  if (scheduledTime) params.published = 'false';
  if (scheduledTime) params.scheduled_publish_time = String(scheduledTime);

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create image container');
  return data.id;
}

async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption?: string,
  coverUrl?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, string> = {
    media_type: 'REELS',
    video_url: videoUrl,
    access_token: token,
  };
  if (caption) params.caption = caption;
  if (coverUrl) params.cover_url = coverUrl;
  if (scheduledTime) {
    params.published = 'false';
    params.scheduled_publish_time = String(scheduledTime);
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create video container');
  return data.id;
}

async function createCarouselChildContainer(
  igUserId: string,
  token: string,
  mediaUrl: string,
  mediaType: 'image' | 'video'
): Promise<string> {
  const params: Record<string, string> = {
    is_carousel_item: 'true',
    access_token: token,
  };
  if (mediaType === 'image') {
    params.image_url = mediaUrl;
  } else {
    params.media_type = 'VIDEO';
    params.video_url = mediaUrl;
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create carousel child');
  return data.id;
}

async function createCarouselContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, unknown> = {
    media_type: 'CAROUSEL',
    children: childIds,
    access_token: token,
  };
  if (caption) params.caption = caption;
  if (scheduledTime) {
    params.published = 'false';
    params.scheduled_publish_time = String(scheduledTime);
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create carousel container');
  return data.id;
}

async function publishContainer(igUserId: string, token: string, containerId: string): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish');
  return data.id;
}

async function checkContainerStatus(token: string, containerId: string): Promise<{ status: string; error?: string }> {
  const res = await fetch(`${GRAPH_API}/${containerId}?fields=status_code,status&access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to check status');
  return { status: data.status_code, error: data.status };
}

async function deleteContainer(token: string, containerId: string): Promise<void> {
  const res = await fetch(`${GRAPH_API}/${containerId}?access_token=${token}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) console.error('Failed to delete container:', data.error);
}

// Wait for video container to finish processing (polls every 5s, max 5 min)
async function waitForContainerReady(token: string, containerId: string): Promise<void> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const { status } = await checkContainerStatus(token, containerId);
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Video processing failed on Instagram');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Video processing timed out (5 min)');
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-publish', '').replace(/\/$/, '');

  // Auth
  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const userRes = await supabaseClient.auth.getUser();
  const user = userRes.data?.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    // POST /schedule/:postId
    const scheduleMatch = path.match(/^\/schedule\/(\d+)$/);
    if (req.method === 'POST' && scheduleMatch) {
      const postId = parseInt(scheduleMatch[1], 10);
      const body = await req.json();
      const scheduledAt: string | undefined = body.scheduled_at;
      const caption: string = body.caption ?? '';
      const coverUrl: string | undefined = body.cover_url;
      const musicNote: string | undefined = body.music_note;

      // Fetch the post (via user's RLS)
      const { data: post, error: postErr } = await supabaseClient
        .from('workflow_posts')
        .select('*, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      if (postErr || !post) return jsonResponse({ error: 'Post not found' }, 404);

      const clienteId = (post as any).workflows.cliente_id;

      // Get the client's Instagram account
      const { data: igAccount, error: igErr } = await supabaseAdmin
        .from('instagram_accounts')
        .select('instagram_user_id, encrypted_access_token')
        .eq('client_id', clienteId)
        .single();
      if (igErr || !igAccount) return jsonResponse({ error: 'Instagram account not connected for this client' }, 400);

      const accessToken = await decryptToken(igAccount.encrypted_access_token);
      const igUserId = igAccount.instagram_user_id;

      // Get media
      const { data: mediaItems } = await supabaseAdmin
        .from('post_media')
        .select('*')
        .eq('post_id', postId)
        .order('position', { ascending: true });

      if (!mediaItems || mediaItems.length === 0) {
        return jsonResponse({ error: 'No media uploaded for this post' }, 400);
      }

      const scheduledTimestamp = scheduledAt
        ? Math.floor(new Date(scheduledAt).getTime() / 1000)
        : undefined;

      let containerId: string;

      if (post.tipo === 'reels') {
        const video = mediaItems.find((m: any) => m.media_type === 'video');
        if (!video) return jsonResponse({ error: 'Reels require a video file' }, 400);
        containerId = await createVideoContainer(igUserId, accessToken, video.public_url, caption, coverUrl, scheduledTimestamp);
        await waitForContainerReady(accessToken, containerId);
      } else if (post.tipo === 'carrossel') {
        if (mediaItems.length < 2) return jsonResponse({ error: 'Carousel requires at least 2 media items' }, 400);
        if (mediaItems.length > 10) return jsonResponse({ error: 'Carousel supports max 10 media items' }, 400);

        const childIds: string[] = [];
        for (const item of mediaItems) {
          const childId = await createCarouselChildContainer(igUserId, accessToken, item.public_url, item.media_type);
          if (item.media_type === 'video') {
            await waitForContainerReady(accessToken, childId);
          }
          childIds.push(childId);
        }
        containerId = await createCarouselContainer(igUserId, accessToken, childIds, caption, scheduledTimestamp);
      } else {
        const image = mediaItems[0];
        containerId = await createImageContainer(igUserId, accessToken, image.public_url, caption, scheduledTimestamp);
      }

      let instagramMediaId: string | undefined;
      let newStatus: string;

      if (scheduledTimestamp) {
        newStatus = 'agendado';
      } else {
        instagramMediaId = await publishContainer(igUserId, accessToken, containerId);
        newStatus = 'postado';
      }

      await supabaseAdmin
        .from('workflow_posts')
        .update({
          status: newStatus,
          scheduled_at: scheduledAt || null,
          instagram_container_id: containerId,
          instagram_media_id: instagramMediaId || null,
          music_note: musicNote || null,
          cover_url: coverUrl || null,
          conteudo_plain: caption,
        })
        .eq('id', postId);

      if (newStatus === 'postado') {
        for (const item of mediaItems) {
          await supabaseAdmin.storage.from('post-media').remove([item.storage_path]);
        }
        await supabaseAdmin.from('post_media').delete().eq('post_id', postId);
      }

      return jsonResponse({ success: true, status: newStatus, container_id: containerId, media_id: instagramMediaId });
    }

    // DELETE /cancel/:postId
    const cancelMatch = path.match(/^\/cancel\/(\d+)$/);
    if (req.method === 'DELETE' && cancelMatch) {
      const postId = parseInt(cancelMatch[1], 10);

      const { data: post, error: postErr } = await supabaseClient
        .from('workflow_posts')
        .select('instagram_container_id, status, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      if (postErr || !post) return jsonResponse({ error: 'Post not found' }, 404);
      if (post.status !== 'agendado') return jsonResponse({ error: 'Post is not scheduled' }, 400);

      const clienteId = (post as any).workflows.cliente_id;
      const { data: igAccount } = await supabaseAdmin
        .from('instagram_accounts')
        .select('encrypted_access_token')
        .eq('client_id', clienteId)
        .single();

      if (igAccount && post.instagram_container_id) {
        const token = await decryptToken(igAccount.encrypted_access_token);
        await deleteContainer(token, post.instagram_container_id);
      }

      await supabaseAdmin
        .from('workflow_posts')
        .update({
          status: 'aprovado_cliente',
          scheduled_at: null,
          instagram_container_id: null,
          instagram_media_id: null,
        })
        .eq('id', postId);

      return jsonResponse({ success: true });
    }

    // GET /status/:postId
    const statusMatch = path.match(/^\/status\/(\d+)$/);
    if (req.method === 'GET' && statusMatch) {
      const postId = parseInt(statusMatch[1], 10);

      const { data: post } = await supabaseClient
        .from('workflow_posts')
        .select('instagram_container_id, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      if (!post || !post.instagram_container_id) return jsonResponse({ error: 'No container found' }, 404);

      const clienteId = (post as any).workflows.cliente_id;
      const { data: igAccount } = await supabaseAdmin
        .from('instagram_accounts')
        .select('encrypted_access_token')
        .eq('client_id', clienteId)
        .single();
      if (!igAccount) return jsonResponse({ error: 'Instagram account not found' }, 404);

      const token = await decryptToken(igAccount.encrypted_access_token);
      const result = await checkContainerStatus(token, post.instagram_container_id);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Not found' }, 404);

  } catch (err: any) {
    console.error('[instagram-publish] Error:', err);
    return jsonResponse({ error: err.message || 'Internal error' }, 500);
  }
});
