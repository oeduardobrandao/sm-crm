# Instagram Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate Instagram post publishing via Meta's two-step container API, triggered by the existing CRM scheduling and client approval flows.

**Architecture:** A single Supabase cron edge function (`instagram-publish-cron`) runs every 5 minutes, processing three phases: container creation (T-60 min), publishing (T=0), and retry. A REST edge function (`instagram-publish`) handles manual schedule/cancel/retry actions from the CRM. The CRM WorkflowDrawer gets an Instagram caption field, date+time picker, and schedule button. The Hub gets status banners and an auto-publish notice.

**Tech Stack:** Supabase Edge Functions (Deno), Meta Graph API, Cloudflare R2 (presigned URLs), React 19, TanStack Query, shadcn/ui, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-04-27-instagram-publishing-design.md`

---

## File Map

### Database
- **Create:** `supabase/migrations/20260427000001_instagram_publishing.sql` — New columns on `workflow_posts` + `clientes`, new status value, RPC function

### Edge Functions — Shared
- **Create:** `supabase/functions/_shared/instagram-publish-utils.ts` — Token decryption, media validation, schedule validation, Graph API helpers, batch processor

### Edge Functions — New
- **Create:** `supabase/functions/instagram-publish-cron/index.ts` — Cron entry point
- **Create:** `supabase/functions/instagram-publish-cron/handler.ts` — Three-phase publish logic
- **Create:** `supabase/functions/instagram-publish/index.ts` — REST entry point
- **Create:** `supabase/functions/instagram-publish/handler.ts` — Schedule/cancel/retry handlers

### Edge Functions — Modified
- **Modify:** `supabase/functions/instagram-integration/index.ts:186` — Add `instagram_business_content_publish` scope
- **Modify:** `supabase/functions/hub-approve/handler.ts` — Auto-publish on approval
- **Modify:** `supabase/functions/hub-posts/handler.ts` — Status guard on PATCH, new fields on GET

### CRM Frontend
- **Create:** `apps/crm/src/components/ui/date-time-picker.tsx` — Date+time picker (extends existing DatePicker pattern)
- **Create:** `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx` — Caption textarea with character counter
- **Create:** `apps/crm/src/pages/entregas/components/ScheduleButton.tsx` — Schedule/cancel/retry button states
- **Modify:** `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:579,617-754` — Add caption field, date-time picker, schedule button; extend `isReadonly` to include `agendado`
- **Modify:** `apps/crm/src/store.ts:1189-1211` — Add new fields to `WorkflowPost` interface
- **Modify:** `apps/crm/src/services/instagram.ts` — Add schedule/cancel/retry API functions
- **Modify:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:1329-1376` — Add auto-publish toggle

### Hub Frontend
- **Modify:** `apps/hub/src/types.ts:29-41` — Add new fields to `HubPost`
- **Modify:** `apps/hub/src/components/InstagramPostCard.tsx` — Status banners, caption display, auto-publish notice
- **Modify:** `apps/hub/src/pages/PostagensPage.tsx:11-13` — Add `postado`, `falha_publicacao` to visible statuses

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260427000001_instagram_publishing.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- Instagram Publishing: new columns, status, RPC
-- ============================================================

-- 1. New columns on workflow_posts
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS ig_caption text,
  ADD COLUMN IF NOT EXISTS instagram_permalink text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_error text,
  ADD COLUMN IF NOT EXISTS publish_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_processing_at timestamptz;

-- 2. Update status check constraint to include falha_publicacao
ALTER TABLE workflow_posts DROP CONSTRAINT IF EXISTS workflow_posts_status_check;
ALTER TABLE workflow_posts
  ADD CONSTRAINT workflow_posts_status_check
  CHECK (status IN (
    'rascunho',
    'revisao_interna',
    'aprovado_interno',
    'enviado_cliente',
    'aprovado_cliente',
    'correcao_cliente',
    'agendado',
    'postado',
    'falha_publicacao'
  ));

-- 3. Index for cron queries
CREATE INDEX IF NOT EXISTS idx_workflow_posts_publish_cron
  ON workflow_posts (status, scheduled_at)
  WHERE status IN ('agendado', 'falha_publicacao');

-- 4. New column on clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS auto_publish_on_approval boolean NOT NULL DEFAULT false;

-- 5. RPC for atomic claim (used by cron)
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  ig_caption text,
  scheduled_at timestamptz,
  instagram_container_id text,
  instagram_media_id text,
  publish_retry_count smallint,
  tipo text,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND wp.instagram_container_id IS NULL
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.instagram_container_id IS NOT NULL
          AND wp.scheduled_at <= now()
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.ig_caption,
    u.scheduled_at,
    u.instagram_container_id,
    u.instagram_media_id,
    u.publish_retry_count,
    u.tipo,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    c.id AS client_id
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
```

- [ ] **Step 2: Push migration to staging**

Run: `npx supabase db push --linked`
Expected: Migration applied successfully, no errors.

- [ ] **Step 3: Verify columns and RPC exist**

Run:
```bash
npx supabase db push --linked --dry-run 2>&1 | tail -5
```
Expected: "Nothing to push" (migration already applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260427000001_instagram_publishing.sql
git commit -m "feat: add Instagram publishing migration — new columns, status, claim RPC"
```

---

## Task 2: Shared Publishing Utilities

**Files:**
- Create: `supabase/functions/_shared/instagram-publish-utils.ts`

This module contains all reusable logic: token decryption, media validation, schedule validation, Graph API helpers, and batch processing. Used by the cron, REST endpoint, and hub-approve.

- [ ] **Step 1: Create the shared utilities file**

```typescript
import { signGetUrl } from "./r2.ts";

// --- Token Decryption (duplicated across functions; centralized here) ---

const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => { throw new Error("TOKEN_ENCRYPTION_KEY required"); })();

async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(TOKEN_ENCRYPTION_KEY), { name: "HKDF" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey, { name: "AES-GCM", length: 256 }, false, usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" }, false, usage
  );
}

export async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey("instagram-access-token", ["decrypt"]);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data)
    );
  } catch {
    const legacyKey = await getLegacyKey(["decrypt"]);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacyKey, data)
    );
  }
}

// --- Media Validation ---

interface MediaFile {
  id: number;
  kind: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  r2_key: string;
  sort_order: number;
}

interface ValidationError {
  file_id: number;
  message: string;
}

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg"]);
const ALLOWED_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
const IMAGE_MIN_DIM = 320;
const IMAGE_AR_MIN = 4 / 5;
const IMAGE_AR_MAX = 1.91;
const VIDEO_AR_MIN = 9 / 16; // 0.5625 — portrait (9:16)
const VIDEO_AR_MAX = 1.25;   // landscape limit
const VIDEO_MIN_DURATION = 3;
const VIDEO_MAX_DURATION = 90;

export function validateMedia(files: MediaFile[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const f of files) {
    if (f.kind === "image") {
      if (!ALLOWED_IMAGE_MIMES.has(f.mime_type)) {
        errors.push({ file_id: f.id, message: "Imagens devem estar em formato JPEG" });
        continue;
      }
      if (f.size_bytes > IMAGE_MAX_BYTES) {
        errors.push({ file_id: f.id, message: "Imagem excede 8 MB (limite do Instagram)" });
      }
      if (f.width && f.height) {
        if (f.width < IMAGE_MIN_DIM || f.height < IMAGE_MIN_DIM) {
          errors.push({ file_id: f.id, message: "Imagem muito pequena (mínimo 320×320)" });
        }
        const ar = f.width / f.height;
        if (ar < IMAGE_AR_MIN || ar > IMAGE_AR_MAX) {
          errors.push({ file_id: f.id, message: "Proporção da imagem fora do permitido (4:5 a 1.91:1)" });
        }
      }
    } else if (f.kind === "video") {
      if (!ALLOWED_VIDEO_MIMES.has(f.mime_type)) {
        errors.push({ file_id: f.id, message: "Vídeos devem estar em formato MP4 ou MOV" });
        continue;
      }
      if (f.size_bytes > VIDEO_MAX_BYTES) {
        errors.push({ file_id: f.id, message: "Vídeo excede 250 MB (limite do Instagram)" });
      }
      if (f.duration_seconds != null) {
        if (f.duration_seconds < VIDEO_MIN_DURATION || f.duration_seconds > VIDEO_MAX_DURATION) {
          errors.push({ file_id: f.id, message: "Duração do vídeo fora do permitido (3–90 segundos)" });
        }
      }
      if (f.width && f.height) {
        const ar = f.width / f.height;
        if (ar < VIDEO_AR_MIN || ar > VIDEO_AR_MAX) {
          errors.push({ file_id: f.id, message: "Proporção do vídeo fora do permitido" });
        }
      }
    }
  }
  return errors;
}

// --- Schedule Validation ---

type DbClient = { from: (table: string) => any };

export interface ScheduleValidationResult {
  ok: boolean;
  errors: string[];
  media?: MediaFile[];
  account?: { encrypted_access_token: string; instagram_user_id: string };
}

export async function validateForScheduling(
  db: DbClient,
  postId: number,
): Promise<ScheduleValidationResult> {
  const errors: string[] = [];

  // Fetch post
  const { data: post } = await db
    .from("workflow_posts")
    .select("id, scheduled_at, ig_caption, workflow_id")
    .eq("id", postId)
    .single();
  if (!post) return { ok: false, errors: ["Post não encontrado."] };

  if (!post.scheduled_at) errors.push("Data de publicação não definida.");
  if (!post.ig_caption?.trim()) errors.push("Legenda do Instagram não definida.");

  // Fetch media via post_file_links → files
  const { data: links } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, mime_type, size_bytes, width, height, duration_seconds, r2_key)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });

  const mediaFiles: MediaFile[] = (links ?? []).map((l: any) => ({
    ...l.files,
    sort_order: l.sort_order,
  }));

  if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    const mediaErrors = validateMedia(mediaFiles);
    for (const e of mediaErrors) errors.push(e.message);
  }

  // Fetch client's Instagram account
  const { data: workflow } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .single();

  if (!workflow) return { ok: false, errors: ["Workflow não encontrado."] };

  const { data: account } = await db
    .from("instagram_accounts")
    .select("encrypted_access_token, instagram_user_id, token_expires_at, authorization_status")
    .eq("client_id", workflow.cliente_id)
    .maybeSingle();

  if (!account) {
    errors.push("Cliente não tem conta Instagram conectada.");
  } else {
    if (account.authorization_status === "revoked") {
      errors.push("Token do Instagram foi revogado. Reconecte a conta.");
    }
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      errors.push("Token do Instagram expirou. Reconecte a conta.");
    }
    // Check publish permission via Graph API
    if (errors.length === 0 && account.encrypted_access_token) {
      try {
        const token = await decryptToken(account.encrypted_access_token);
        const permRes = await fetch(
          `https://graph.instagram.com/me/permissions?access_token=${token}`,
        );
        const permData = await permRes.json();
        const granted = new Set(
          (permData.data ?? [])
            .filter((p: any) => p.status === "granted")
            .map((p: any) => p.permission),
        );
        if (!granted.has("instagram_business_content_publish")) {
          errors.push("Conta Instagram precisa ser reconectada com permissão de publicação.");
        }
      } catch {
        errors.push("Erro ao verificar permissões do Instagram.");
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    media: mediaFiles,
    account: account ? {
      encrypted_access_token: account.encrypted_access_token,
      instagram_user_id: account.instagram_user_id,
    } : undefined,
  };
}

// --- Graph API Helpers ---

const GRAPH_BASE = "https://graph.instagram.com";

export async function createSingleImageContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_url: videoUrl, caption, media_type: "REELS", access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function createCarouselChildContainer(
  igUserId: string,
  token: string,
  mediaUrl: string,
  isVideo: boolean,
): Promise<{ id: string }> {
  const body: Record<string, string | boolean> = {
    is_carousel_item: true,
    access_token: token,
  };
  if (isVideo) {
    body.video_url = mediaUrl;
    body.media_type = "VIDEO";
  } else {
    body.image_url = mediaUrl;
  }
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function createCarouselParentContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function checkContainerStatus(
  containerId: string,
  token: string,
): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  const res = await fetch(
    `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${token}`,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.status_code ?? "FINISHED";
}

export async function pollContainerReady(
  containerId: string,
  token: string,
  maxPolls = 25,
  intervalMs = 5000,
): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR"> {
  for (let i = 0; i < maxPolls; i++) {
    const status = await checkContainerStatus(containerId, token);
    if (status !== "IN_PROGRESS") return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "IN_PROGRESS";
}

export async function publishContainer(
  igUserId: string,
  token: string,
  containerId: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { id: data.id };
}

export async function fetchPermalink(
  mediaId: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${token}`,
    );
    const data = await res.json();
    return data.permalink ?? null;
  } catch {
    return null;
  }
}

// --- Presigned URL Generation ---

export async function generatePresignedUrls(
  media: MediaFile[],
): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  for (const f of media) {
    const url = await signGetUrl(f.r2_key, 7200);
    urls.set(f.id, url);
  }
  return urls;
}

// --- Batch Processor ---

export async function processBatch<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<void>,
): Promise<{ succeeded: number; failed: number; errors: Array<{ item: T; error: string }> }> {
  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ item: T; error: string }> = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fn));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        succeeded++;
      } else {
        failed++;
        errors.push({
          item: batch[j],
          error: (results[j] as PromiseRejectedResult).reason?.message ?? "Unknown error",
        });
      }
    }
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { succeeded, failed, errors };
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `deno check supabase/functions/_shared/instagram-publish-utils.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts
git commit -m "feat: add shared Instagram publishing utilities — validation, Graph API, batch processing"
```

---

## Task 3: Publish Cron Edge Function

**Files:**
- Create: `supabase/functions/instagram-publish-cron/handler.ts`
- Create: `supabase/functions/instagram-publish-cron/index.ts`

- [ ] **Step 1: Create the cron handler**

```typescript
// supabase/functions/instagram-publish-cron/handler.ts

interface PublishCronDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createPublishCronHandler(deps: PublishCronDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
```

- [ ] **Step 2: Create the cron entry point with all three phases**

```typescript
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

async function claimPosts(
  db: ReturnType<typeof createClient>,
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

async function fetchMediaForPost(
  db: ReturnType<typeof createClient>,
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

async function markFailed(
  db: ReturnType<typeof createClient>,
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

async function clearLock(db: ReturnType<typeof createClient>, postId: number) {
  await db.from("workflow_posts").update({ publish_processing_at: null }).eq("id", postId);
}

// --- Phase 1: Container Creation ---
async function processContainerCreation(
  db: ReturnType<typeof createClient>,
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
async function processPublish(
  db: ReturnType<typeof createClient>,
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
async function processRetry(
  db: ReturnType<typeof createClient>,
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
```

- [ ] **Step 3: Verify it compiles**

Run: `deno check supabase/functions/instagram-publish-cron/index.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-publish-cron/
git commit -m "feat: add instagram-publish-cron edge function — three-phase container/publish/retry"
```

---

## Task 4: Publish REST Edge Function

**Files:**
- Create: `supabase/functions/instagram-publish/handler.ts`
- Create: `supabase/functions/instagram-publish/index.ts`

- [ ] **Step 1: Create the REST handler**

```typescript
// supabase/functions/instagram-publish/handler.ts

import { createJsonResponder } from "../_shared/http.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";

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
    if (!["schedule", "cancel", "retry"].includes(action)) {
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
      const validation = await validateForScheduling(svcDb, postId);
      if (!validation.ok) {
        return json({ error: "Validação falhou", details: validation.errors }, 422);
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

    return json({ error: "Unknown action" }, 400);
  };
}
```

- [ ] **Step 2: Create the REST entry point**

```typescript
// supabase/functions/instagram-publish/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createPublishHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createPublishHandler({
  buildCorsHeaders,
  createDb: (jwt: string) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  }),
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
}));
```

- [ ] **Step 3: Verify it compiles**

Run: `deno check supabase/functions/instagram-publish/index.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-publish/
git commit -m "feat: add instagram-publish REST edge function — schedule/cancel/retry endpoints"
```

---

## Task 5: Update OAuth Scope

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:186`

- [ ] **Step 1: Add the content_publish scope**

In `supabase/functions/instagram-integration/index.ts`, find the OAuth scope on line 186 and add `instagram_business_content_publish`:

The current scope string is:
```
scope=instagram_business_basic,instagram_business_manage_insights
```

Change to:
```
scope=instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish
```

- [ ] **Step 2: Verify typecheck passes**

Run: `deno check supabase/functions/instagram-integration/index.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "feat: add instagram_business_content_publish to OAuth scope"
```

---

## Task 6: Modify hub-approve for Auto-publish

**Files:**
- Modify: `supabase/functions/hub-approve/handler.ts`
- Modify: `supabase/functions/hub-approve/index.ts`

- [ ] **Step 1: Update hub-approve handler to import validation and check auto-publish**

Add the auto-publish logic after the status update on line 59 of `handler.ts`. The handler currently updates status to `aprovado_cliente` and returns. Add:

```typescript
// After line 59: await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);

if (action === "aprovado") {
  const { data: workflow } = await db
    .from("workflows")
    .select("cliente_id")
    .eq("id", post.workflow_id)
    .single();

  if (workflow) {
    const { data: client } = await db
      .from("clientes")
      .select("auto_publish_on_approval")
      .eq("id", workflow.cliente_id)
      .single();

    if (client?.auto_publish_on_approval) {
      const { validateForScheduling } = await import("../_shared/instagram-publish-utils.ts");
      const validation = await validateForScheduling(db, post_id);
      if (validation.ok) {
        await db.from("workflow_posts")
          .update({ status: "agendado" })
          .eq("id", post_id);
      }
    }
  }
}
```

Note: The `post` variable on line 35-39 already fetches `id, workflow_id, status`, so `post.workflow_id` is available.

- [ ] **Step 2: Verify typecheck passes**

Run: `deno check supabase/functions/hub-approve/index.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-approve/handler.ts
git commit -m "feat: auto-publish on client approval when auto_publish_on_approval is enabled"
```

---

## Task 7: Modify hub-posts for Status Guard and New Fields

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`

- [ ] **Step 1: Add status guard to PATCH handler**

In the PATCH handler (lines 43-79), after fetching the allowed posts (line 64), add a status check before the update loop (before line 71):

```typescript
// After line 64: const allowedIds = new Set(...)
// Fetch post statuses for guard check
const { data: postStatuses } = await db
  .from("workflow_posts")
  .select("id, status")
  .in("id", Array.from(allowedIds));

const lockedStatuses = new Set(["agendado", "postado", "falha_publicacao"]);
const lockedPosts = (postStatuses ?? []).filter(
  (p: { id: number; status: string }) => lockedStatuses.has(p.status)
);
if (lockedPosts.length > 0) {
  const lockedIds = lockedPosts.map((p: { id: number }) => p.id);
  return json({
    error: "Não é possível alterar a data de posts agendados ou publicados. Cancele o agendamento primeiro.",
    locked_post_ids: lockedIds,
  }, 409);
}
```

- [ ] **Step 2: Add new fields to GET response**

In the GET handler, update the post select query on line 109 to include the new fields:

Change:
```typescript
.select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id, workflows(titulo)")
```

To:
```typescript
.select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, published_at, publish_error, workflow_id, workflows(titulo)")
```

Also, after fetching the Instagram account (line 182-186), add the client's auto_publish flag. After line 186:

```typescript
const { data: clienteRow } = await db
  .from("clientes")
  .select("auto_publish_on_approval")
  .eq("id", hubToken.cliente_id)
  .single();
```

Then in the response object (line 188-196), add:

```typescript
autoPublishOnApproval: clienteRow?.auto_publish_on_approval ?? false,
```

- [ ] **Step 3: Verify typecheck passes**

Run: `deno check supabase/functions/hub-posts/index.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts
git commit -m "feat: hub-posts status guard on PATCH, add publishing fields to GET response"
```

---

## Task 8: Update CRM Types and Store

**Files:**
- Modify: `apps/crm/src/store.ts:1189-1211`

- [ ] **Step 1: Add `falha_publicacao` to WorkflowPost status union**

In `apps/crm/src/store.ts`, update the `WorkflowPost` interface (lines 1189-1211):

Add `'falha_publicacao'` to the status union (after `'postado'` on line 1206):

```typescript
status:
  | 'rascunho'
  | 'revisao_interna'
  | 'aprovado_interno'
  | 'enviado_cliente'
  | 'aprovado_cliente'
  | 'correcao_cliente'
  | 'agendado'
  | 'postado'
  | 'falha_publicacao';
```

Add the new fields after `scheduled_at` (line 1208):

```typescript
scheduled_at?: string | null;
ig_caption?: string | null;
instagram_permalink?: string | null;
published_at?: string | null;
publish_error?: string | null;
publish_retry_count?: number;
instagram_container_id?: string | null;
instagram_media_id?: string | null;
```

- [ ] **Step 2: Update STATUS_LABELS in WorkflowDrawer**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, add `falha_publicacao` to `STATUS_LABELS` (line 38-47) and `STATUS_CLASS` (line 49):

```typescript
const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};
```

Add to `STATUS_CLASS`:
```typescript
falha_publicacao: 'status-danger',
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store.ts apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: add falha_publicacao status and publishing fields to WorkflowPost type"
```

---

## Task 9: Instagram CRM Service — Schedule/Cancel/Retry

**Files:**
- Modify: `apps/crm/src/services/instagram.ts`

- [ ] **Step 1: Add the three publishing API functions**

Add to the end of `apps/crm/src/services/instagram.ts`:

```typescript
export async function scheduleInstagramPost(postId: number): Promise<{ ok: boolean; status: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-publish/schedule/${postId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.details?.join('; ') ?? data.error ?? 'Erro ao agendar');
  return data;
}

export async function cancelInstagramSchedule(postId: number): Promise<{ ok: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-publish/cancel/${postId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erro ao cancelar');
  return data;
}

export async function retryInstagramPublish(postId: number): Promise<{ ok: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-publish/retry/${postId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erro ao reenviar');
  return data;
}
```

Note: The `supabase` import already exists at the top of this file.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/services/instagram.ts
git commit -m "feat: add schedule/cancel/retry Instagram publishing API functions"
```

---

## Task 10: DateTimePicker Component

**Files:**
- Create: `apps/crm/src/components/ui/date-time-picker.tsx`

- [ ] **Step 1: Create the DateTimePicker**

This extends the existing `DatePicker` pattern (see `apps/crm/src/components/ui/date-picker.tsx`) by adding time selection.

```typescript
import * as React from 'react';
import { format, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Selecionar data e hora',
  className,
  disabled,
  clearable = true,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const hours = value ? value.getHours() : 10;
  const minutes = value ? value.getMinutes() : 0;

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onChange?.(undefined);
      return;
    }
    const withTime = setMinutes(setHours(date, hours), minutes);
    onChange?.(withTime);
  };

  const handleTimeChange = (h: number, m: number) => {
    if (!value) return;
    const updated = setMinutes(setHours(new Date(value), h), m);
    onChange?.(updated);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-9 justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value
            ? format(value, "dd MMM yyyy '·' HH:mm", { locale: ptBR })
            : <span>{placeholder}</span>}
          {clearable && value && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange?.(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange?.(undefined);
                }
              }}
              className="ml-auto -mr-1 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={value}
          onSelect={handleDateSelect}
          initialFocus
        />
        <div className="border-t px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Horário:</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={hours}
            onChange={(e) => handleTimeChange(parseInt(e.target.value, 10), minutes)}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">:</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={minutes}
            onChange={(e) => handleTimeChange(hours, parseInt(e.target.value, 10))}
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/components/ui/date-time-picker.tsx
git commit -m "feat: add DateTimePicker component — calendar + time select"
```

---

## Task 11: InstagramCaptionField Component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx`

- [ ] **Step 1: Create the caption field component**

```typescript
import { useState, useRef, useEffect } from 'react';
import { Instagram, Lock } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface InstagramCaptionFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  lockedMessage?: string;
}

const MAX_CHARS = 2200;

export function InstagramCaptionField({ value, onChange, disabled, lockedMessage }: InstagramCaptionFieldProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (newVal: string) => {
    if (newVal.length > MAX_CHARS) return;
    setLocal(newVal);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(newVal), 1500);
  };

  return (
    <div className="mt-3 rounded-lg border-2 p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Instagram className="h-4 w-4" style={{ color: '#E1306C' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
          Legenda do Instagram
        </span>
        {disabled && lockedMessage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3.5 w-3.5 ml-auto" style={{ color: 'var(--text-light)' }} />
            </TooltipTrigger>
            <TooltipContent>{lockedMessage}</TooltipContent>
          </Tooltip>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}>
          {local.length} / {MAX_CHARS}
        </span>
      </div>
      <Textarea
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder="Texto exato que será publicado no Instagram. Suporta emojis e hashtags."
        className="min-h-[80px] resize-y"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
      />
      <p className="text-xs mt-1" style={{ color: 'var(--text-light)' }}>
        Texto exato que será publicado no Instagram. Suporta emojis e hashtags.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx
git commit -m "feat: add InstagramCaptionField component — monospace textarea with char counter"
```

---

## Task 12: ScheduleButton Component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx`

- [ ] **Step 1: Create the schedule button component**

```typescript
import { useState } from 'react';
import { toast } from 'sonner';
import { Calendar, AlertCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkflowPost } from '../../../store';
import { scheduleInstagramPost, cancelInstagramSchedule, retryInstagramPublish } from '../../../services/instagram';

interface ScheduleButtonProps {
  post: WorkflowPost;
  hasInstagramAccount: boolean;
  onStatusChange: () => void;
}

export function ScheduleButton({ post, hasInstagramAccount, onStatusChange }: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);

  if (!hasInstagramAccount) return null;

  const handleSchedule = async () => {
    setLoading(true);
    try {
      await scheduleInstagramPost(post.id!);
      toast.success('Post agendado para publicação no Instagram');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await cancelInstagramSchedule(post.id!);
      toast.success('Agendamento cancelado');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setLoading(true);
    try {
      await retryInstagramPublish(post.id!);
      toast.success('Post reenviado para publicação');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (post.status === 'agendado') {
    return (
      <div className="flex items-center gap-2 mt-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e' }}>
          <Calendar className="h-3.5 w-3.5" /> Agendado
        </div>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={loading}
          className="text-xs" style={{ color: '#f55a42', borderColor: 'rgba(245, 90, 66, 0.25)' }}>
          <X className="h-3 w-3 mr-1" /> Cancelar
        </Button>
      </div>
    );
  }

  if (post.status === 'falha_publicacao') {
    return (
      <div className="mt-3">
        <Button onClick={handleRetry} disabled={loading} size="sm"
          className="text-xs font-semibold"
          style={{ background: '#f55a42', color: 'white' }}>
          <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
        </Button>
        {post.publish_error && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f55a42' }}>
            <AlertCircle className="h-3 w-3" /> {post.publish_error}
          </p>
        )}
      </div>
    );
  }

  if (post.status === 'aprovado_cliente') {
    const canSchedule = !!post.scheduled_at && !!post.ig_caption?.trim();
    const missingItems: string[] = [];
    if (!post.scheduled_at) missingItems.push('data de publicação');
    if (!post.ig_caption?.trim()) missingItems.push('legenda do Instagram');

    return (
      <div className="mt-3">
        <Button onClick={handleSchedule} disabled={!canSchedule || loading} size="sm"
          className="text-xs font-semibold"
          style={canSchedule ? { background: '#eab308', color: '#12151a' } : undefined}>
          <Calendar className="h-3 w-3 mr-1" /> Agendar publicação
        </Button>
        {!canSchedule && missingItems.length > 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f5a342' }}>
            <AlertCircle className="h-3 w-3" /> Falta: {missingItems.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ScheduleButton.tsx
git commit -m "feat: add ScheduleButton component — schedule/cancel/retry states"
```

---

## Task 13: Integrate Publishing UI into WorkflowDrawer

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

This task wires the new components (InstagramCaptionField, DateTimePicker, ScheduleButton) into the existing WorkflowDrawer, and extends the `isReadonly` logic to cover `agendado` status.

- [ ] **Step 1: Add imports at the top of WorkflowDrawer.tsx**

Add after line 27 (`import { listPostMedia } from '../../../services/postMedia';`):

```typescript
import { InstagramCaptionField } from './InstagramCaptionField';
import { ScheduleButton } from './ScheduleButton';
import { DateTimePicker } from '@/components/ui/date-time-picker';
```

- [ ] **Step 2: Extend isReadonly to include agendado**

On line 579, change:
```typescript
const isReadonly = post.status === 'enviado_cliente' || post.status === 'aprovado_cliente';
```

To:
```typescript
const isReadonly = post.status === 'enviado_cliente' || post.status === 'aprovado_cliente' || post.status === 'agendado';
const isScheduleLocked = post.status === 'agendado';
```

- [ ] **Step 3: Replace the date input with DateTimePicker**

Replace lines 669-677 (the `scheduled_at` date input):

```html
<div className="drawer-post-field">
  <label>Data de postagem</label>
  <input
    className="drawer-input"
    type="date"
    value={post.scheduled_at ? post.scheduled_at.slice(0, 10) : ''}
    onChange={e => onFieldChange('scheduled_at', e.target.value || null)}
  />
</div>
```

With:
```tsx
<div className="drawer-post-field">
  <label>Data de postagem</label>
  <DateTimePicker
    value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
    onChange={(date) => onFieldChange('scheduled_at', date?.toISOString() ?? null)}
    disabled={isScheduleLocked}
    className="w-full"
  />
</div>
```

- [ ] **Step 4: Add InstagramCaptionField and ScheduleButton after PostEditor**

After line 714 (the closing of `<PostEditor ... />`), before `<PostCommentSummary>`, add:

```tsx
{hasInstagramAccount && (
  <InstagramCaptionField
    value={post.ig_caption ?? ''}
    onChange={(val) => onFieldChange('ig_caption', val)}
    disabled={isScheduleLocked}
    lockedMessage="Cancelar agendamento para editar"
  />
)}

<ScheduleButton
  post={post}
  hasInstagramAccount={hasInstagramAccount}
  onStatusChange={onRefresh}
/>
```

The `SortablePostItem` component needs these new props passed through. Add to `SortablePostItemProps` interface (around line 510):

```typescript
hasInstagramAccount: boolean;
onRefresh: () => void;
```

And update the destructuring of `SortablePostItem` (line 542) to include these props, then use them in the JSX.

In the parent `WorkflowDrawer` component, add a query to check whether the client has a connected Instagram account. The `WorkflowDrawer` receives `workflowId` from the workflow it's displaying. Fetch the client's Instagram account status using a `useQuery`:

```typescript
// Inside WorkflowDrawer, after existing queries
const { data: igAccount } = useQuery({
  queryKey: ['igAccountForWorkflow', workflowId],
  queryFn: async () => {
    const { data: workflow } = await supabase
      .from('workflows')
      .select('cliente_id')
      .eq('id', workflowId)
      .single();
    if (!workflow) return null;
    const { data: account } = await supabase
      .from('instagram_accounts')
      .select('id')
      .eq('client_id', workflow.cliente_id)
      .maybeSingle();
    return account;
  },
  enabled: !!workflowId,
});
const hasInstagramAccount = !!igAccount;
```

Import `supabase` at the top of the file:
```typescript
import { supabase } from '@/lib/supabase';
```

Then pass `hasInstagramAccount` and `onRefresh={refresh}` to each `SortablePostItem`:
```tsx
hasInstagramAccount={hasInstagramAccount}
onRefresh={refresh}
```

- [ ] **Step 5: Update the readonly notice message for agendado**

On lines 680-685, update the notice to handle `agendado` differently:

```tsx
{isReadonly && (
  <div className="drawer-readonly-notice">
    {isScheduleLocked
      ? 'Este post está agendado. Cancele o agendamento para editar mídia e legenda.'
      : 'Este post foi enviado ao cliente e não pode ser editado. Altere o status para editar novamente.'
    }
  </div>
)}
```

- [ ] **Step 6: Typecheck and test visually**

Run: `npm run build`
Expected: Build succeeds.

Run: `npm run dev`
Open the WorkflowDrawer for a post, verify:
- DateTimePicker appears instead of plain date input
- InstagramCaptionField shows below the editor
- ScheduleButton shows for `aprovado_cliente` posts

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: integrate Instagram publishing UI into WorkflowDrawer — caption, datetime, schedule"
```

---

## Task 14: Auto-publish Toggle on Client Detail Page

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

- [ ] **Step 1: Add the auto-publish toggle to the InstagramSection component**

In `ClienteDetalhePage.tsx`, the `InstagramSection` component (line 1329-1376) renders Instagram widgets when the account is synced (line 1368-1374). Add a toggle after the account overview.

First, add the import for Switch at the top of the file:
```typescript
import { Switch } from '@/components/ui/switch';
```

Import `supabase` if not already imported:
```typescript
import { supabase } from '@/lib/supabase';
```

In the `InstagramSection` component, add state for the toggle. After line 1339 (`const igConnectRef = useRef<HTMLDivElement>(null);`):

```typescript
const [autoPublish, setAutoPublish] = React.useState(false);
const [autoPublishLoading, setAutoPublishLoading] = React.useState(false);

React.useEffect(() => {
  supabase.from('clientes').select('auto_publish_on_approval').eq('id', clienteId).single()
    .then(({ data }) => { if (data) setAutoPublish(data.auto_publish_on_approval); });
}, [clienteId]);

const handleAutoPublishToggle = async (checked: boolean) => {
  setAutoPublishLoading(true);
  try {
    await supabase.from('clientes').update({ auto_publish_on_approval: checked }).eq('id', clienteId);
    setAutoPublish(checked);
  } catch { /* ignore */ }
  finally { setAutoPublishLoading(false); }
};
```

Then, in the JSX, after line 1372 (the "Ver Analytics Completo" button), add the toggle block before `<div ref={igConnectRef} />`:

```tsx
{igSummary?.account?.last_synced_at && (
  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
          Publicar automaticamente após aprovação
        </div>
        <div style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          Quando o cliente aprovar, o post será agendado automaticamente se tiver data e legenda definidas.
        </div>
      </div>
      <Switch
        checked={autoPublish}
        onCheckedChange={handleAutoPublishToggle}
        disabled={autoPublishLoading}
      />
    </div>
  </div>
)}
```

- [ ] **Step 2: Typecheck and test visually**

Run: `npm run build`
Expected: Build succeeds.

Run: `npm run dev`, navigate to a client detail page with Instagram connected, verify the toggle appears.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat: add auto-publish toggle to client detail page Instagram section"
```

---

## Task 15: Hub Types Update

**Files:**
- Modify: `apps/hub/src/types.ts`

- [ ] **Step 1: Update HubPost interface**

In `apps/hub/src/types.ts`, update the `HubPost` interface (lines 29-41).

Update the status union to include `postado` and `falha_publicacao` (and replace `publicado` with `postado` for consistency with DB):

```typescript
status: 'rascunho' | 'em_producao' | 'enviado_cliente'
  | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'postado' | 'falha_publicacao';
```

Add new fields after `scheduled_at`:
```typescript
scheduled_at: string | null;
ig_caption: string | null;
instagram_permalink: string | null;
published_at: string | null;
publish_error: string | null;
```

- [ ] **Step 2: Typecheck Hub**

Run: `npm run build:hub`
Expected: Build succeeds (may surface type errors in components that need updating — those are addressed in the next tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/types.ts
git commit -m "feat: add publishing fields and statuses to HubPost type"
```

---

## Task 16: Hub InstagramPostCard — Status Banners and Caption

**Files:**
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`

- [ ] **Step 1: Add status banners and ig_caption display**

Read the current `InstagramPostCard.tsx` to understand the full component structure. The existing component shows a card with image, caption from `conteudo_plain` (with a "LEGENDA" extraction hack at lines 41-45), and approval buttons.

Changes needed:

1. **Caption display**: When `post.ig_caption` is set, show that instead of the extracted caption from `conteudo_plain`. Replace the caption extraction logic (lines 41-45):

```typescript
const caption = post.ig_caption
  ? post.ig_caption
  : (() => {
      const rawText = post.conteudo_plain || '';
      const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
      return legendaIdx !== -1
        ? rawText.slice(legendaIdx + 'LEGENDA'.length).replace(/^[:\s\n]+/, '').trim()
        : rawText;
    })();
```

2. **Agendado banner**: After the caption area and before the approval buttons, add a green scheduled banner when `post.status === 'agendado'`:

```tsx
{post.status === 'agendado' && post.scheduled_at && (
  <div style={{
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: 'rgba(62, 207, 142, 0.03)',
  }}>
    <div style={{ width: 8, height: 8, background: '#3ecf8e', borderRadius: '50%', flexShrink: 0 }} />
    <div>
      <div style={{ color: '#3ecf8e', fontSize: '0.8rem', fontWeight: 600 }}>Agendado para publicação</div>
      <div style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>
        {new Date(post.scheduled_at).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </div>
    </div>
  </div>
)}
```

3. **Postado banner**: Gold banner with "Ver no Instagram" link:

```tsx
{post.status === 'postado' && (
  <div style={{
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(234, 179, 8, 0.03)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ color: '#eab308', fontSize: '0.9rem' }}>✓</span>
      <div>
        <div style={{ color: '#eab308', fontSize: '0.8rem', fontWeight: 600 }}>Publicado</div>
        {post.published_at && (
          <div style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>
            {new Date(post.published_at).toLocaleDateString('pt-BR', {
              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        )}
      </div>
    </div>
    {post.instagram_permalink && (
      <a href={post.instagram_permalink} target="_blank" rel="noopener noreferrer"
        style={{ color: '#E1306C', fontSize: '0.75rem', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        Ver no Instagram <span style={{ fontSize: '0.7rem' }}>↗</span>
      </a>
    )}
  </div>
)}
```

4. **Auto-publish notice**: On the approval buttons area, when the client has auto-publish enabled:

The `InstagramPostCard` needs to receive `autoPublishOnApproval: boolean` as a prop (passed from `AprovacoesPage`). When true and the post has `scheduled_at` and `ig_caption`:

```tsx
{autoPublishOnApproval && post.scheduled_at && post.ig_caption && isPending && (
  <div style={{
    marginTop: '0.75rem',
    padding: '0.6rem',
    background: 'rgba(234, 179, 8, 0.06)',
    border: '1px solid rgba(234, 179, 8, 0.19)',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.4rem',
  }}>
    <span style={{ color: '#eab308', fontSize: '0.8rem', flexShrink: 0 }}>⚡</span>
    <div style={{ color: '#eab308', fontSize: '0.7rem', lineHeight: 1.4 }}>
      Ao aprovar, este post será publicado automaticamente no Instagram em{' '}
      <strong>
        {new Date(post.scheduled_at).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })}
      </strong>.
    </div>
  </div>
)}
```

- [ ] **Step 2: Update AprovacoesPage to pass autoPublishOnApproval**

In `apps/hub/src/pages/AprovacoesPage.tsx`, the `fetchPosts` response now includes `autoPublishOnApproval`. Extract it from the response data and pass to each `InstagramPostCard`:

```tsx
<InstagramPostCard
  // ... existing props
  autoPublishOnApproval={data.autoPublishOnApproval ?? false}
/>
```

- [ ] **Step 3: Typecheck Hub**

Run: `npm run build:hub`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/pages/AprovacoesPage.tsx
git commit -m "feat: add status banners, ig_caption display, and auto-publish notice to Hub InstagramPostCard"
```

---

## Task 17: Hub PostagensPage — New Status Groups

**Files:**
- Modify: `apps/hub/src/pages/PostagensPage.tsx`

- [ ] **Step 1: Add postado and falha_publicacao to visible statuses**

On lines 11-13, update `VISIBLE_STATUSES`:

```typescript
const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'agendado', 'postado', 'falha_publicacao',
]);
```

- [ ] **Step 2: Add status color mapping and visual indicators**

Add a status color map near the top of the file, after `VISIBLE_STATUSES`:

```typescript
const STATUS_COLORS: Record<string, string> = {
  enviado_cliente: '#f5a342',
  aprovado_cliente: '#3ecf8e',
  correcao_cliente: '#f55a42',
  agendado: '#42c8f5',
  postado: '#eab308',
  falha_publicacao: '#f55a42',
};

const STATUS_LABELS: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Publicado',
  falha_publicacao: 'Falha na publicação',
};
```

Where status labels/dots are rendered in the post list, use these maps:

```tsx
<span style={{
  display: 'inline-block',
  width: 8, height: 8,
  borderRadius: 2,
  background: STATUS_COLORS[post.status] ?? '#94a3b8',
  marginRight: 6,
}} />
<span style={{ color: STATUS_COLORS[post.status], fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
  {STATUS_LABELS[post.status] ?? post.status}
</span>
{post.status === 'falha_publicacao' && post.publish_error && (
  <span style={{ color: '#f55a42', fontSize: '0.7rem', marginLeft: 8 }}>
    — {post.publish_error}
  </span>
)}
{post.status === 'agendado' && post.scheduled_at && (
  <span style={{ color: '#94a3b8', fontSize: '0.7rem', marginLeft: 8 }}>
    — {new Date(post.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
  </span>
)}
```

- [ ] **Step 3: Disable drag/reschedule for locked statuses**

Where the drag/reorder handler is invoked, add a guard to prevent dragging posts in `agendado`, `postado`, or `falha_publicacao` statuses. Find the drag handler or sortable config and add:

```typescript
const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);
```

When building the sortable list, disable drag for locked posts. If using `@dnd-kit`, set `disabled` on the sortable item:

```tsx
const isDragDisabled = LOCKED_STATUSES.has(post.status);
```

In the `reorderPostSchedules` call, filter out any locked posts from the update array.

- [ ] **Step 4: Typecheck Hub**

Run: `npm run build:hub`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/PostagensPage.tsx
git commit -m "feat: add status colors, error display, and drag guard to Hub PostagensPage"
```

---

## Task 18: Deploy Edge Functions

**Files:** None (deployment commands only)

- [ ] **Step 1: Deploy the new publish cron**

Run: `npx supabase functions deploy instagram-publish-cron --no-verify-jwt`
Expected: Deployment succeeds.

- [ ] **Step 2: Deploy the new publish REST endpoint**

Run: `npx supabase functions deploy instagram-publish --no-verify-jwt`
Expected: Deployment succeeds.

- [ ] **Step 3: Deploy updated hub-approve**

Run: `npx supabase functions deploy hub-approve --no-verify-jwt`
Expected: Deployment succeeds.

- [ ] **Step 4: Deploy updated hub-posts**

Run: `npx supabase functions deploy hub-posts --no-verify-jwt`
Expected: Deployment succeeds.

- [ ] **Step 5: Deploy updated instagram-integration (new scope)**

Run: `npx supabase functions deploy instagram-integration --no-verify-jwt`
Expected: Deployment succeeds.

- [ ] **Step 6: Set up cron schedule in Supabase dashboard**

In the Supabase dashboard, go to Database → Extensions → pg_cron (or SQL editor) and create:

```sql
SELECT cron.schedule(
  'instagram-publish-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := '<SUPABASE_URL>/functions/v1/instagram-publish-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Replace `<SUPABASE_URL>` and `<CRON_SECRET>` with actual values.

- [ ] **Step 7: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: deploy all Instagram publishing edge functions"
```

---

## Task 19: Full Typecheck and Test

- [ ] **Step 1: Build CRM**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 2: Build Hub**

Run: `npm run build:hub`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: All tests pass, no regressions.

- [ ] **Step 4: Visual test — CRM**

Run: `npm run dev`

Test:
1. Open a workflow with posts
2. Expand a post — verify DateTimePicker, InstagramCaptionField, and ScheduleButton appear
3. Set a date+time, write a caption
4. For an `aprovado_cliente` post, click "Agendar publicação" → status should change to `agendado`
5. Verify media gallery, caption field, and date picker are disabled when `agendado`
6. Click "Cancelar" → status returns to `aprovado_cliente`
7. Navigate to client detail page — verify auto-publish toggle appears

- [ ] **Step 5: Visual test — Hub**

Run: `npm run dev:hub`

Test:
1. Open a Hub approval page
2. Verify `agendado` posts show green scheduled banner
3. Verify `postado` posts show gold published banner with "Ver no Instagram" link
4. If auto-publish is enabled, verify the yellow notice appears on pending posts

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration issues from full testing"
```
