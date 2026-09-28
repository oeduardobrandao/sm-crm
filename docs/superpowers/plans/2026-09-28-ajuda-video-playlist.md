# Central de Ajuda: playlist de vídeos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video-first Central de Ajuda: a player + playlist block at the top of `/ajuda` (and `/ajuda/video/:slug`), fed by tutorial videos that platform admins upload from a new Admin "Vídeos" page straight to Cloudflare Stream, with per-user watch progress.

**Architecture:** Three new tables (`kb_video_series`, `kb_videos`, `kb_video_progress`) plus an invoker RPC for progress. The Admin talks to new `platform-admin` actions (handlers in `platform-admin/kb-videos.ts`, validation in `_shared/admin-kb-videos.ts`) that create Stream direct uploads with public playback; `stream-webhook` settles `kb_videos` rows and `post-media-cleanup-cron`'s orphan reap learns to spare them. The CRM reads published+ready videos under RLS and renders the block with the shared `@mesaas/ui/VideoPlayer`.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql), Deno edge functions, React 19 + TanStack Query v5 + React Router v7 (CRM, Admin), Tailwind, Vitest + Testing Library, `deno test`, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-09-28-ajuda-video-playlist-design.md`. Two deliberate deviations: (1) the CRM resolves `/ajuda/video/:slug` from the same `getPublishedVideoSeries()` query the hero uses instead of a separate `getVideoBySlug()` (one query, same RLS, no extra round-trip); (2) `platform-admin` also gets a `get-kb-video` action, which the Admin editor needs.

## Global Constraints

- UI copy is Portuguese. **No em-dashes (—) in any user-facing string**; use a period or colon.
- Icons: `lucide-react` only. Toasts: `toast` from `sonner`.
- CRM imports use `@/…`. **Admin code uses relative imports only** (in Vitest `@` resolves to `apps/crm/src`).
- Admin pages use no hex colour literals (the new pages are added to `apps/admin/src/__tests__/no-hex-literals.test.ts`).
- Never `useBlocker`. Uploads are wrapped in `trackUnsavedWork` from `@mesaas/app-lifecycle`.
- Edge functions: never return raw error details; thrown errors fall to `platform-admin`'s generic 500.
- Migration version prefix must be unique and above `origin/main`'s tail. Planned name: `20260928120001_kb_videos.sql`; re-check `ls supabase/migrations | tail -3` on `origin/main` right before opening the PR and renumber if something newer landed.
- Stream direct upload body: `{ maxDurationSeconds: 900, requireSignedURLs: false, expiry: <now + 2h ISO>, meta: { kind: 'kb-video', video_id } }`. Upload TTL = 2h. Admin file cap = 200 MB.
- Progress: save every 10 s of playback, on pause, on `pagehide`, on video switch/unmount. Complete at `currentTime >= 0.9 * duration` or `ended`. `completed_at` never goes back to null.
- Only series with at least one visible (published + ready) video exist for the CRM.
- `kb_videos.id` is `bigint` (the reap's `fetchKnownStreamUids` pages by a numeric id cursor).
- After any `deno test` run in this worktree, run `npm ci` before Vitest (Deno pollutes `node_modules`; check `ls node_modules/.deno`).

## File Map

**Database**
- Create `supabase/migrations/20260928120001_kb_videos.sql`: tables, RLS, `save_kb_video_progress` RPC, grants.
- Create `supabase/tests/entitlements/99_kb_videos.sql`: RLS/RPC suite.

**Edge functions**
- Modify `supabase/functions/_shared/stream.ts`: `createStreamDirectUpload`, `getStreamVideo`, `StreamVideoInfo`.
- Modify `supabase/functions/post-media-cleanup-cron/stream-steps.ts`: `orphanReap` knows `kb_videos`.
- Modify `supabase/functions/stream-webhook/handler.ts` + `index.ts`: settle `kb_videos`.
- Modify `supabase/functions/_shared/admin-kb.ts`: `video` in `RESERVED_SLUGS`.
- Create `supabase/functions/_shared/admin-kb-videos.ts`: column allowlists + validation.
- Create `supabase/functions/platform-admin/kb-videos.ts`: action handlers.
- Modify `supabase/functions/platform-admin/index.ts`: dispatch.
- Tests: modify `__tests__/stream-shared_test.ts`, `__tests__/stream-steps_test.ts`, `__tests__/stream-webhook_test.ts`, `__tests__/admin-kb_test.ts`; create `__tests__/admin-kb-videos_test.ts`, `__tests__/platform-admin-kb-videos_test.ts`.

**Admin (`apps/admin/src`)**
- Modify `lib/api.ts` (types + 12 calls), `lib/routes.ts`, `router.tsx`, `layouts/AdminLayout.tsx`, `pages/KbArticleEditorPage.tsx` (`RESERVED_SLUGS` mirror), `__tests__/no-hex-literals.test.ts`.
- Create `lib/slugify.ts`, `lib/kb-video-status.ts`, `lib/stream-upload.ts`, `pages/KbVideosPage.tsx`, `pages/kb-videos/SeriesDialog.tsx`, `pages/KbVideoEditorPage.tsx`.
- Tests: `lib/__tests__/kb-video-status.test.ts`, `lib/__tests__/stream-upload.test.ts`, `pages/__tests__/KbVideosPage.test.tsx`, `pages/__tests__/KbVideoEditorPage.test.tsx`.

**CRM (`apps/crm/src`)**
- Create `store/kbVideos.ts` (+ `store/__tests__/kbVideos.test.ts`).
- Create `pages/ajuda/videos/playlist.ts` (pure logic), `useKbVideos.ts` (queries), `VideoRail.tsx`, `NextUpOverlay.tsx`, `VideoStage.tsx`, `VideoPlaylistBlock.tsx`, `VideoPlaylistHero.tsx`, `VideoResultCard.tsx`.
- Create `pages/ajuda/VideoPage.tsx`; modify `pages/ajuda/AjudaPage.tsx`, `App.tsx`.
- Tests: `pages/ajuda/videos/__tests__/playlist.test.ts`, `…/NextUpOverlay.test.tsx`, `…/VideoPlaylistBlock.test.tsx`, `pages/ajuda/__tests__/AjudaPage.test.tsx`, `pages/ajuda/__tests__/VideoPage.test.tsx`.

**Docs**
- Modify `CLAUDE.md` (`STREAM_REAP_INTERVAL_HOURS` paragraph).

---

### Task 1: Database: tables, RLS, progress RPC

**Files:**
- Create: `supabase/migrations/20260928120001_kb_videos.sql`
- Test: `supabase/tests/entitlements/99_kb_videos.sql`

**Interfaces:**
- Produces: tables `kb_video_series`, `kb_videos` (id `bigint`), `kb_video_progress`; function `save_kb_video_progress(p_video_id bigint, p_position numeric, p_completed boolean) returns void` (executable by `authenticated` only). Columns exactly as below; later tasks read/write them by these names.

- [ ] **Step 1: Write the entitlement suite (it fails until the migration exists)**

`supabase/tests/entitlements/99_kb_videos.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Tutoriais em vídeo da Central de Ajuda (migration 20260928120001).
-- (a) authenticated só vê vídeo publicado + pronto de série publicada;
-- (b) não escreve no catálogo; (c) RPC de progresso: preserva completed_at,
-- recorta posição, recusa vídeo invisível; (d) progresso é por usuário;
-- (e) anon não executa a RPC; (f) CHECK: ready exige hls_url.
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ua         uuid := gen_random_uuid();
  v_ub         uuid := gen_random_uuid();
  v_s_pub      uuid;
  v_s_draft    uuid;
  v_v_ok       bigint;
  v_v_draft    bigint;
  v_v_pending  bigint;
  v_v_hidden_s bigint;
  v_ids        bigint[];
  v_n          int;
  v_pos        numeric;
  v_completed  timestamptz;
  v_rejected   boolean;
begin
  -- et_grant_hosted_parity() grants ALL on every table (hosted default ACL), so every
  -- rejection below comes from RLS, not from missing table grants: an RLS WITH CHECK
  -- failure raises insufficient_privilege (42501), and an UPDATE with no matching policy
  -- silently affects 0 rows. Function EXECUTE grants are untouched by the helper.
  insert into auth.users (id) values (v_ua), (v_ub);

  insert into kb_video_series (title, slug, status) values ('Primeiros passos', 'primeiros-passos', 'published')
    returning id into v_s_pub;
  insert into kb_video_series (title, slug, status) values ('Rascunho', 'serie-rascunho', 'draft')
    returning id into v_s_draft;

  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Ok', 'ok', 'published', 'uid-ok', 'ready', 'https://x.test/ok.m3u8', 100)
    returning id into v_v_ok;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Rascunho', 'video-rascunho', 'draft', 'uid-draft', 'ready', 'https://x.test/d.m3u8', 50)
    returning id into v_v_draft;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status)
    values (v_s_pub, 'Processando', 'processando', 'published', 'uid-pending', 'pending')
    returning id into v_v_pending;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_draft, 'Serie oculta', 'serie-oculta', 'published', 'uid-hidden', 'ready', 'https://x.test/h.m3u8', 30)
    returning id into v_v_hidden_s;

  -- ---- (a) visibilidade como A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select coalesce(array_agg(id order by id), '{}') into v_ids from kb_videos;
  assert v_ids = array[v_v_ok], format('A deveria ver so o video pronto e publicado, viu %s', v_ids);
  select count(*) into v_n from kb_video_series;
  assert v_n = 1, format('A deveria ver so a serie publicada, viu %s', v_n);

  -- ---- (b) sem escrita no catálogo ----
  v_rejected := false;
  begin
    insert into kb_video_series (title, slug) values ('Invasor', 'invasor');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu inserir serie';

  update kb_videos set title = 'hack' where id = v_v_ok;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'authenticated conseguiu atualizar kb_videos';

  -- ---- (c) RPC de progresso ----
  perform save_kb_video_progress(v_v_ok, 50, false);
  perform save_kb_video_progress(v_v_ok, 95, true);
  perform save_kb_video_progress(v_v_ok, 10, false);
  select position_seconds, completed_at into v_pos, v_completed
    from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_completed is not null, 'completed_at foi apagado por um save com p_completed = false';
  assert v_pos = 10, format('posicao deveria ser a ultima gravada (10), foi %s', v_pos);

  perform save_kb_video_progress(v_v_ok, 500, false);
  select position_seconds into v_pos from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_pos = 100, format('posicao acima da duracao deveria virar 100, foi %s', v_pos);

  perform save_kb_video_progress(v_v_ok, -5, false);
  select position_seconds into v_pos from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_pos = 0, format('posicao negativa deveria virar 0, foi %s', v_pos);

  v_rejected := false;
  begin
    perform save_kb_video_progress(v_v_draft, 1, false);
  exception when no_data_found then
    v_rejected := true;
  end;
  assert v_rejected, 'RPC aceitou progresso de video em rascunho';

  v_rejected := false;
  begin
    insert into kb_video_progress (user_id, video_id) values (v_ub, v_v_ok);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A conseguiu gravar progresso com user_id de B';
  execute 'reset role';

  -- ---- (d) B não vê o progresso de A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from kb_video_progress;
  assert v_n = 0, 'B enxerga progresso de A';
  execute 'reset role';

  -- ---- (e) grants da RPC ----
  assert has_function_privilege('anon', 'public.save_kb_video_progress(bigint,numeric,boolean)', 'EXECUTE') = false,
    'anon nao pode executar save_kb_video_progress';
  assert has_function_privilege('authenticated', 'public.save_kb_video_progress(bigint,numeric,boolean)', 'EXECUTE') = true,
    'authenticated precisa executar save_kb_video_progress';

  -- ---- (f) CHECK ready exige hls_url ----
  v_rejected := false;
  begin
    insert into kb_videos (series_id, title, slug, stream_status) values (v_s_pub, 'Sem hls', 'sem-hls', 'ready');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'ready sem hls_url foi aceito';
end $$;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Requires local Supabase (colima, see memory `reference_local_supabase_colima`). If Docker is unavailable locally, skip to Step 3 and rely on CI's `entitlement-tests` job.

Run: `npx supabase start && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_kb_videos.sql`
Expected: FAIL, `relation "kb_video_series" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260928120001_kb_videos.sql`:

```sql
-- Tutoriais em vídeo da Central de Ajuda (spec 2026-09-28-ajuda-video-playlist-design).
-- Séries e vídeos são conteúdo da plataforma (como kb_articles): escritos só pelo service role
-- via platform-admin; authenticated lê o que está publicado. kb_videos.id é bigint porque o
-- orphan reap do post-media-cleanup-cron pagina os uids conhecidos por um cursor numérico.

CREATE TABLE IF NOT EXISTS kb_video_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_video_series_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_video_series_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS kb_videos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id uuid NOT NULL REFERENCES kb_video_series(id) ON DELETE RESTRICT,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  article_id uuid REFERENCES kb_articles(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  stream_uid text UNIQUE,
  stream_upload_expires_at timestamptz,
  stream_status text NOT NULL DEFAULT 'pending',
  duration_seconds numeric,
  hls_url text,
  thumbnail_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_videos_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_videos_stream_status_check CHECK (stream_status IN ('pending', 'ready', 'error')),
  CONSTRAINT kb_videos_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT kb_videos_ready_has_hls CHECK (stream_status <> 'ready' OR hls_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS kb_videos_series_order ON kb_videos (series_id, display_order);

CREATE TABLE IF NOT EXISTS kb_video_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id bigint NOT NULL REFERENCES kb_videos(id) ON DELETE CASCADE,
  position_seconds numeric NOT NULL DEFAULT 0,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

-- Reusa o trigger genérico de updated_at criado para kb_articles (20260519000001).
CREATE TRIGGER kb_video_series_updated_at
  BEFORE UPDATE ON kb_video_series
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();
CREATE TRIGGER kb_videos_updated_at
  BEFORE UPDATE ON kb_videos
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();

ALTER TABLE kb_video_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_video_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read published video series"
  ON kb_video_series FOR SELECT TO authenticated
  USING (status = 'published');

CREATE POLICY "Authenticated users can read published ready videos"
  ON kb_videos FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND stream_status = 'ready'
    AND EXISTS (
      SELECT 1 FROM kb_video_series s
      WHERE s.id = kb_videos.series_id AND s.status = 'published'
    )
  );

CREATE POLICY "Users read own video progress"
  ON kb_video_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own video progress"
  ON kb_video_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own video progress"
  ON kb_video_progress FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT ON kb_video_series, kb_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON kb_video_progress TO authenticated;

-- Grava a posição de um vídeo para o usuário atual. SECURITY INVOKER: a RLS de kb_videos
-- decide se o vídeo é visível (invisível = no_data_found) e a de kb_video_progress garante
-- que só a própria linha é escrita. completed_at é preservado atomicamente (coalesce),
-- então saves fora de ordem nunca "desconcluem" um vídeo. A posição é última-gravação-vence
-- de propósito: o usuário pode voltar no vídeo e retomar dali.
CREATE OR REPLACE FUNCTION public.save_kb_video_progress(
  p_video_id bigint,
  p_position numeric,
  p_completed boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_duration numeric;
  v_found boolean;
  v_position numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT duration_seconds, true INTO v_duration, v_found FROM kb_videos WHERE id = p_video_id;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'video not found' USING ERRCODE = 'P0002';
  END IF;

  v_position := greatest(0, coalesce(p_position, 0));
  IF v_duration IS NOT NULL THEN
    v_position := least(v_position, v_duration);
  END IF;

  INSERT INTO kb_video_progress (user_id, video_id, position_seconds, completed_at, updated_at)
  VALUES (v_uid, p_video_id, v_position, CASE WHEN p_completed THEN now() END, now())
  ON CONFLICT (user_id, video_id) DO UPDATE SET
    position_seconds = excluded.position_seconds,
    completed_at = coalesce(kb_video_progress.completed_at, excluded.completed_at),
    updated_at = now();
END;
$$;

-- Supabase concede funções novas direto a anon/authenticated/service_role: REVOKE FROM PUBLIC
-- sozinho não basta, então todos os papéis são enumerados.
REVOKE ALL ON FUNCTION public.save_kb_video_progress(bigint, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_kb_video_progress(bigint, numeric, boolean)
  TO authenticated;
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_kb_videos.sql`
Expected: completes with `ROLLBACK`, no assertion error. (No Docker: CI's `entitlement-tests` covers it; say so in the PR.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260928120001_kb_videos.sql supabase/tests/entitlements/99_kb_videos.sql
git commit -m "feat(ajuda): tabelas de vídeos tutoriais, RLS e RPC de progresso"
```

---

### Task 2: Stream helpers: direct upload and video lookup

**Files:**
- Modify: `supabase/functions/_shared/stream.ts` (append after `getStreamVideoStatus`, ~line 279)
- Test: `supabase/functions/__tests__/stream-shared_test.ts`

**Interfaces:**
- Produces:
  - `createStreamDirectUpload(opts: { maxDurationSeconds: number; expiry: string; meta: Record<string, string> }, fetchFn?, sleepFn?, budget?): Promise<{ uid: string; uploadURL: string }>`
  - `type StreamVideoState = "ready" | "error" | "pendingupload" | "inprogress" | "notfound"`
  - `interface StreamVideoInfo { state: StreamVideoState; duration: number | null; hls: string | null; thumbnail: string | null }`
  - `getStreamVideo(uid: string, fetchFn?, sleepFn?, budget?): Promise<StreamVideoInfo>`

- [ ] **Step 1: Write the failing tests**

Add `createStreamDirectUpload` and `getStreamVideo` to the import list at the top of `stream-shared_test.ts`, then append:

```ts
Deno.test("stream-shared: createStreamDirectUpload posts public-playback options and returns uid + uploadURL", async () => {
  clearStreamEnv();
  setStreamEnv();
  const cap: { req?: Request; body?: unknown } = {};
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.req = new Request(input as string, init);
    cap.body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ success: true, result: { uid: "up-1", uploadURL: "https://upload.videodelivery.net/abc" } }),
      { status: 200 },
    );
  }) as typeof fetch;

  const out = await createStreamDirectUpload(
    { maxDurationSeconds: 900, expiry: "2026-09-28T14:00:00.000Z", meta: { kind: "kb-video", video_id: "7" } },
    fetchFn,
  );

  assertEquals(out, { uid: "up-1", uploadURL: "https://upload.videodelivery.net/abc" });
  assertEquals(cap.req!.url, "https://api.cloudflare.com/client/v4/accounts/acct1/stream/direct_upload");
  assertEquals(cap.req!.method, "POST");
  assertEquals(cap.req!.headers.get("Authorization"), "Bearer tok1");
  assertEquals(cap.body, {
    maxDurationSeconds: 900,
    expiry: "2026-09-28T14:00:00.000Z",
    requireSignedURLs: false,
    meta: { kind: "kb-video", video_id: "7" },
  });
  assert(cap.req!.signal instanceof AbortSignal, "expected the direct-upload fetch to carry an AbortSignal");
  clearStreamEnv();
});

Deno.test("stream-shared: createStreamDirectUpload throws with the status when Stream refuses", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() => Promise.resolve(new Response("nope", { status: 500 }))) as typeof fetch;
  let message = "";
  try {
    await createStreamDirectUpload({ maxDurationSeconds: 900, expiry: "x", meta: {} }, fetchFn);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("500"), `expected status in message, got "${message}"`);
  clearStreamEnv();
});

Deno.test("stream-shared: getStreamVideo maps a ready video's playback fields", async () => {
  clearStreamEnv();
  setStreamEnv();
  let url = "";
  const fetchFn = ((input: RequestInfo | URL) => {
    url = String(input);
    return Promise.resolve(new Response(JSON.stringify({
      result: {
        status: { state: "ready" },
        duration: 65.4,
        playback: { hls: "https://customer-c.cloudflarestream.com/u1/manifest/video.m3u8" },
        thumbnail: "https://customer-c.cloudflarestream.com/u1/thumbnails/thumbnail.jpg",
      },
    }), { status: 200 }));
  }) as typeof fetch;

  const info = await getStreamVideo("u1", fetchFn);

  assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/acct1/stream/u1");
  assertEquals(info, {
    state: "ready",
    duration: 65.4,
    hls: "https://customer-c.cloudflarestream.com/u1/manifest/video.m3u8",
    thumbnail: "https://customer-c.cloudflarestream.com/u1/thumbnails/thumbnail.jpg",
  });
  clearStreamEnv();
});

Deno.test("stream-shared: getStreamVideo keeps pendingupload distinct, maps 404 to notfound and -1 duration to null", async () => {
  clearStreamEnv();
  setStreamEnv();
  const pending = (() => Promise.resolve(new Response(JSON.stringify({
    result: { status: { state: "pendingupload" }, duration: -1 },
  }), { status: 200 }))) as typeof fetch;
  assertEquals(await getStreamVideo("u1", pending), { state: "pendingupload", duration: null, hls: null, thumbnail: null });

  const queued = (() => Promise.resolve(new Response(JSON.stringify({
    result: { status: { state: "queued" } },
  }), { status: 200 }))) as typeof fetch;
  assertEquals((await getStreamVideo("u1", queued)).state, "inprogress");

  const gone = (() => Promise.resolve(new Response("{}", { status: 404 }))) as typeof fetch;
  assertEquals(await getStreamVideo("u1", gone), { state: "notfound", duration: null, hls: null, thumbnail: null });
  clearStreamEnv();
});

Deno.test("stream-shared: getStreamVideo throws on a non-404 failure", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() => Promise.resolve(new Response("boom", { status: 502 }))) as typeof fetch;
  let message = "";
  try {
    await getStreamVideo("u1", fetchFn);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("502"), `expected status in message, got "${message}"`);
  clearStreamEnv();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-shared_test.ts`
Expected: FAIL (`createStreamDirectUpload` is not exported).

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/stream.ts` after `getStreamVideoStatus`:

```ts
/** Creates a one-time direct creator upload with PUBLIC playback (tutorial videos only; post
 * media keeps copyToStream's signed playback). The browser then POSTs the file straight to
 * `uploadURL`. `expiry` bounds how long the reservation lives on Stream's side. */
export async function createStreamDirectUpload(
  opts: { maxDurationSeconds: number; expiry: string; meta: Record<string, string> },
  fetchFn: typeof fetch = fetch,
  sleepFn: SleepFn = defaultSleep,
  budget?: StreamRetryBudget,
): Promise<{ uid: string; uploadURL: string }> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const res = await fetchStreamWithRetry(fetchFn, `${streamBase(accountId)}/direct_upload`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      maxDurationSeconds: opts.maxDurationSeconds,
      expiry: opts.expiry,
      requireSignedURLs: false,
      meta: opts.meta,
    }),
  }, sleepFn, budget);
  const json = await res.json().catch(() => null) as
    | { success?: boolean; result?: { uid?: string; uploadURL?: string } }
    | null;
  const uid = json?.result?.uid;
  const uploadURL = json?.result?.uploadURL;
  if (!res.ok || json?.success === false || !uid || !uploadURL) {
    throw new Error("stream direct upload failed: " + res.status);
  }
  return { uid, uploadURL };
}

export type StreamVideoState = "ready" | "error" | "pendingupload" | "inprogress" | "notfound";

export interface StreamVideoInfo {
  state: StreamVideoState;
  duration: number | null;
  hls: string | null;
  thumbnail: string | null;
}

/** Full lookup of one video. Unlike getStreamVideoStatus it keeps `pendingupload` (a direct
 * upload whose bytes never arrived) apart from processing, and maps 404 to `notfound`. Stream
 * reports an unknown duration as -1, which becomes null. */
export async function getStreamVideo(
  uid: string,
  fetchFn: typeof fetch = fetch,
  sleepFn: SleepFn = defaultSleep,
  budget?: StreamRetryBudget,
): Promise<StreamVideoInfo> {
  const accountId = Deno.env.get("STREAM_ACCOUNT_ID") ?? "";
  const res = await fetchStreamWithRetry(
    fetchFn,
    `${streamBase(accountId)}/${uid}`,
    { headers: authHeaders() },
    sleepFn,
    budget,
  );
  if (res.status === 404) return { state: "notfound", duration: null, hls: null, thumbnail: null };
  if (!res.ok) throw new Error("stream get failed: " + res.status);
  const json = await res.json().catch(() => null) as
    | {
      result?: {
        status?: { state?: string };
        duration?: number;
        playback?: { hls?: string };
        thumbnail?: string;
      };
    }
    | null;
  const r = json?.result;
  const raw = r?.status?.state;
  const state: StreamVideoState = raw === "ready" || raw === "error" || raw === "pendingupload"
    ? raw
    : "inprogress";
  const duration = typeof r?.duration === "number" && r.duration >= 0 ? r.duration : null;
  return {
    state,
    duration,
    hls: typeof r?.playback?.hls === "string" ? r.playback.hls : null,
    thumbnail: typeof r?.thumbnail === "string" ? r.thumbnail : null,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-shared_test.ts`
Expected: PASS (all old + 5 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stream.ts supabase/functions/__tests__/stream-shared_test.ts
git commit -m "feat(stream): direct upload público e consulta completa de vídeo"
```

---

### Task 3: Orphan reap spares tutorial videos

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/stream-steps.ts:271-280` (`orphanReap` + its doc comment)
- Modify: `CLAUDE.md` (`STREAM_REAP_INTERVAL_HOURS` paragraph)
- Test: `supabase/functions/__tests__/stream-steps_test.ts`

**Interfaces:**
- Consumes: `kb_videos (id bigint, stream_uid text)` from Task 1.

- [ ] **Step 1: Write the failing tests** (append to `stream-steps_test.ts`)

```ts
Deno.test("stream-steps: reap spares a 2-day-old uid known only to kb_videos (tutorial video)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] });
  db.queue("file_deletions", "select", { data: [] });
  db.queue("kb_videos", "select", { data: [{ id: 1, stream_uid: "tutorial-uid" }] });

  const deleted: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    listStreamVideos: async () => [
      { uid: "tutorial-uid", created: hoursAgoIso(48) },
      { uid: "orphan-old", created: hoursAgoIso(2) },
    ],
    deleteStreamVideo: async (uid) => {
      deleted.push(uid);
    },
  }));

  assertEquals(deleted, ["orphan-old"]);
  assertEquals(result.reaped, 1);
  const kbSelects = callsFor(db, "kb_videos", "select");
  assertEquals(kbSelects.length, 1);
  assertEquals(kbSelects[0].modifiers.find((m) => m.method === "gt")?.args, ["id", 0]);
});

Deno.test("stream-steps: a failed kb_videos read aborts the reap before any delete", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] });
  db.queue("file_deletions", "select", { data: [] });
  db.queue("kb_videos", "select", { data: null, error: { message: "boom" } });

  const deleted: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    listStreamVideos: async () => [{ uid: "tutorial-uid", created: hoursAgoIso(48) }],
    deleteStreamVideo: async (uid) => {
      deleted.push(uid);
    },
  }));

  assertEquals(deleted, []);
  assertEquals(result.reaped, 0);
  assertEquals(result.errors, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-steps_test.ts`
Expected: FAIL; the first test deletes `tutorial-uid` too.

- [ ] **Step 3: Implement** — replace the start of `orphanReap` and its doc comment:

```ts
/** Deletes Stream videos that neither `files.stream_uid`, the `file_deletions` delete queue nor
 * `kb_videos.stream_uid` (Central de Ajuda tutorials) knows about — a copy whose uid was never
 * persisted (e.g. index update failed after the Stream API call succeeded). The 1h age gate
 * spares an in-flight ingest that just hasn't been saved yet. Rows already queued in
 * `file_deletions` are deliberately excluded from "orphan": they're on their way to deletion via
 * the drain loop, not double-deleted here.
 *
 * ROLLBACK HAZARD: once any kb_videos.stream_uid exists, deploying a version of this function
 * that does not read kb_videos deletes every tutorial within STREAM_REAP_INTERVAL_HOURS. Turn the
 * reap off first (STREAM_REAP_INTERVAL_HOURS=876000). See the "Rollback" section of
 * docs/superpowers/specs/2026-09-28-ajuda-video-playlist-design.md. */
async function orphanReap(deps: StreamStepsDeps, nowMs: () => number): Promise<number> {
  const known = await fetchKnownStreamUids(deps.db, "files");
  const queued = await fetchKnownStreamUids(deps.db, "file_deletions");
  for (const uid of queued) known.add(uid);
  const tutorials = await fetchKnownStreamUids(deps.db, "kb_videos");
  for (const uid of tutorials) known.add(uid);
```

(The rest of the function is unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-steps_test.ts`
Expected: PASS. Existing reap tests still pass because an unqueued `kb_videos` select defaults to `{ data: [] }`.

- [ ] **Step 5: Document it in CLAUDE.md**

In the `STREAM_REAP_INTERVAL_HOURS` bullet, after the sentence ending `...shows the last actual run`, add:

```markdown
  The reap's "known" set is `files` + `file_deletions` + `kb_videos` (Central de Ajuda
  tutorials, public playback). Rolling the cron back to a version that doesn't read
  `kb_videos` deletes every tutorial: set this interval to `876000` BEFORE such a deploy
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/post-media-cleanup-cron/stream-steps.ts supabase/functions/__tests__/stream-steps_test.ts CLAUDE.md
git commit -m "fix(stream): orphan reap não apaga vídeos tutoriais (kb_videos)"
```

---

### Task 4: stream-webhook settles kb_videos

**Files:**
- Modify: `supabase/functions/stream-webhook/handler.ts`
- Modify: `supabase/functions/stream-webhook/index.ts`
- Test: `supabase/functions/__tests__/stream-webhook_test.ts`

**Interfaces:**
- Consumes: `getStreamVideo`, `StreamVideoInfo` (Task 2).
- Produces: `StreamWebhookDeps.getStreamVideo: (uid: string) => Promise<StreamVideoInfo>`.

- [ ] **Step 1: Write the failing tests**

In `stream-webhook_test.ts`, add to `baseDeps` defaults:

```ts
    getStreamVideo: (unreachable("getStreamVideo") as unknown) as StreamWebhookDeps["getStreamVideo"],
```

Append:

```ts
const KB_HLS = "https://customer-c.cloudflarestream.com/kb-uid/manifest/video.m3u8";
const KB_THUMB = "https://customer-c.cloudflarestream.com/kb-uid/thumbnails/thumbnail.jpg";

Deno.test("stream-webhook: ready for a pending kb_videos uid fetches playback details and settles it", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  db.queue("kb_videos", "select", { data: [{ id: 7 }], error: null });
  db.queue("kb_videos", "update", { data: null, error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, {
    verifySignature: () => Promise.resolve(true),
    getStreamVideo: async (uid) => {
      assertEquals(uid, "kb-uid");
      return { state: "ready", duration: 65.4, hls: KB_HLS, thumbnail: KB_THUMB };
    },
  }));

  const response = await handler(webhookRequest(payload({ uid: "kb-uid", state: "ready" })));

  assertEquals(response.status, 200);
  const selects = callsFor(db, "kb_videos", "select");
  assertEquals(selects[0].modifiers, [
    { method: "eq", args: ["stream_uid", "kb-uid"] },
    { method: "eq", args: ["stream_status", "pending"] },
    { method: "limit", args: [1] },
  ]);
  const updates = callsFor(db, "kb_videos", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, {
    stream_status: "ready",
    duration_seconds: 65.4,
    hls_url: KB_HLS,
    thumbnail_url: KB_THUMB,
    stream_upload_expires_at: null,
  });
  assertEquals(updates[0].modifiers, [
    { method: "eq", args: ["id", 7] },
    { method: "eq", args: ["stream_uid", "kb-uid"] },
    { method: "eq", args: ["stream_status", "pending"] },
  ]);
});

Deno.test("stream-webhook: error for a pending kb_videos uid marks it error without a Stream lookup", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  db.queue("kb_videos", "select", { data: [{ id: 7 }], error: null });
  db.queue("kb_videos", "update", { data: null, error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "kb-uid", state: "error" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update")[0].payload, {
    stream_status: "error",
    stream_upload_expires_at: null,
  });
});

Deno.test("stream-webhook: a uid with no pending kb_videos row (files video, or already settled) never touches kb_videos", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  db.queue("kb_videos", "select", { data: [], error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "video-uid-1", state: "error" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
});

Deno.test("stream-webhook: a failed Stream lookup acks 200 and leaves the kb_videos row pending", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  db.queue("kb_videos", "select", { data: [{ id: 7 }], error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, {
    verifySignature: () => Promise.resolve(true),
    getStreamVideo: () => Promise.reject(new Error("stream get failed: 503")),
  }));

  const response = await handler(webhookRequest(payload({ uid: "kb-uid", state: "ready" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
});

Deno.test("stream-webhook: ready without an HLS url yet leaves the kb_videos row pending", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  db.queue("kb_videos", "select", { data: [{ id: 7 }], error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, {
    verifySignature: () => Promise.resolve(true),
    getStreamVideo: async () => ({ state: "inprogress", duration: null, hls: null, thumbnail: null }),
  }));

  const response = await handler(webhookRequest(payload({ uid: "kb-uid", state: "ready" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-webhook_test.ts`
Expected: FAIL (no `kb_videos` calls are made).

- [ ] **Step 3: Implement**

In `handler.ts`, add the import and extend the deps:

```ts
import type { StreamVideoInfo } from "../_shared/stream.ts";
```

```ts
export interface StreamWebhookDeps {
  createDb: () => DbClient;
  verifySignature: (body: string, header: string | null) => Promise<boolean>;
  /** Authoritative playback details for a tutorial video (kb_videos) once Stream says ready. */
  getStreamVideo: (uid: string) => Promise<StreamVideoInfo>;
}
```

Add this helper above `createStreamWebhookHandler`:

```ts
/** Patch for a pending kb_videos row, or null to leave it pending (refresh-kb-video in the Admin
 * resolves it later). Playback fields come from the Stream API, not the webhook body, so the
 * handler never depends on the delivery's shape; `ready` is never written without an HLS url. */
async function kbVideoPatch(
  deps: StreamWebhookDeps,
  uid: string,
  mapped: "ready" | "error",
): Promise<Record<string, unknown> | null> {
  if (mapped === "error") return { stream_status: "error", stream_upload_expires_at: null };
  try {
    const info = await deps.getStreamVideo(uid);
    if (info.state !== "ready" || !info.hls) {
      console.warn("[stream-webhook:kb-settle] not ready yet", uid, info.state);
      return null;
    }
    return {
      stream_status: "ready",
      duration_seconds: info.duration,
      hls_url: info.hls,
      thumbnail_url: info.thumbnail,
      stream_upload_expires_at: null,
    };
  } catch (err) {
    console.error("[stream-webhook:kb-settle] stream lookup failed", uid, err);
    return null;
  }
}
```

Inside the existing `try` block, right after the `files` update's `if (error) return …`, add:

```ts
      // Tutoriais da Central de Ajuda. Uids do Stream são únicos na conta, então no máximo uma
      // das duas tabelas casa. Mesma guarda monotônica (só sai de pending) que files.
      const { data: kbRows, error: kbErr } = await svc
        .from("kb_videos")
        .select("id")
        .eq("stream_uid", uid)
        .eq("stream_status", "pending")
        .limit(1);
      if (kbErr) return internalServerError(json, "stream-webhook:kb-settle", kbErr);
      const kbRow = ((kbRows ?? []) as Array<{ id: number }>)[0];
      if (kbRow) {
        const patch = await kbVideoPatch(deps, uid, mapped);
        if (patch) {
          const { error: updErr } = await svc
            .from("kb_videos")
            .update(patch)
            .eq("id", kbRow.id)
            .eq("stream_uid", uid)
            .eq("stream_status", "pending");
          if (updErr) return internalServerError(json, "stream-webhook:kb-settle", updErr);
        }
      }
```

In `index.ts`, import `getStreamVideo` alongside `verifyStreamWebhookSignature` and add it to the deps:

```ts
import { getStreamVideo, verifyStreamWebhookSignature } from "../_shared/stream.ts";
```

```ts
  verifySignature: (body, header) => verifyStreamWebhookSignature(body, header),
  getStreamVideo: (uid) => getStreamVideo(uid),
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/stream-webhook_test.ts && npm run check:functions`
Expected: PASS; `deno check` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stream-webhook supabase/functions/__tests__/stream-webhook_test.ts
git commit -m "feat(stream-webhook): conclui processamento de vídeos tutoriais"
```

---

### Task 5: Validation for series and videos (+ reserve the `video` slug)

**Files:**
- Create: `supabase/functions/_shared/admin-kb-videos.ts`
- Modify: `supabase/functions/_shared/admin-kb.ts:12` (`RESERVED_SLUGS`)
- Modify: `apps/admin/src/pages/KbArticleEditorPage.tsx:52` (mirror)
- Test: create `supabase/functions/__tests__/admin-kb-videos_test.ts`; modify `supabase/functions/__tests__/admin-kb_test.ts`

**Interfaces:**
- Produces (all from `_shared/admin-kb-videos.ts`):
  - `KB_VIDEO_SERIES_COLUMNS`, `KB_VIDEO_COLUMNS`, `KB_VIDEO_STREAM_COLUMNS` (readonly string tuples)
  - `KB_VIDEO_MAX_DURATION_S = 900`, `KB_VIDEO_UPLOAD_TTL_MS = 7_200_000`
  - `pickColumns(body: Record<string, unknown>, columns: readonly string[]): Record<string, unknown>`
  - `hasStreamColumns(body: Record<string, unknown>): boolean`
  - `normalizeKbVideoRow(row: Record<string, unknown>): Record<string, unknown>`
  - `validateKbVideoSeries(row: Record<string, unknown>): string | null`
  - `validateKbVideo(row: Record<string, unknown>): string | null`

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/admin-kb-videos_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  hasStreamColumns,
  KB_VIDEO_COLUMNS,
  normalizeKbVideoRow,
  pickColumns,
  validateKbVideo,
  validateKbVideoSeries,
} from "../_shared/admin-kb-videos.ts";

const SERIES = { title: "Primeiros passos", slug: "primeiros-passos", status: "draft" };
const VIDEO = { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1", status: "draft" };

Deno.test("validateKbVideoSeries: title 1..200, slug format and reserved slugs", () => {
  assertEquals(validateKbVideoSeries(SERIES), null);
  assert(validateKbVideoSeries({ ...SERIES, title: "" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, title: "x".repeat(201) }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "Com Espaço" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "novo" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "video" }) !== null);
});

Deno.test("validateKbVideoSeries: description max 500, display_order integer 0..10000, status enum", () => {
  assert(validateKbVideoSeries({ ...SERIES, description: "x".repeat(501) }) !== null);
  assertEquals(validateKbVideoSeries({ ...SERIES, description: null }), null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: -1 }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: 1.5 }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: 10_001 }) !== null);
  assertEquals(validateKbVideoSeries({ ...SERIES, display_order: 10_000 }), null);
  assert(validateKbVideoSeries({ ...SERIES, status: "archived" }) !== null);
});

Deno.test("validateKbVideo: requires a series and a string article id when present", () => {
  assertEquals(validateKbVideo(VIDEO), null);
  assert(validateKbVideo({ ...VIDEO, series_id: "" }) !== null);
  assert(validateKbVideo({ ...VIDEO, series_id: undefined }) !== null);
  assert(validateKbVideo({ ...VIDEO, article_id: 42 }) !== null);
  assertEquals(validateKbVideo({ ...VIDEO, article_id: null }), null);
});

Deno.test("validateKbVideo: publishing requires a ready video with an HLS url", () => {
  assert(validateKbVideo({ ...VIDEO, status: "published" }) !== null);
  assert(validateKbVideo({ ...VIDEO, status: "published", stream_status: "pending" }) !== null);
  assert(validateKbVideo({ ...VIDEO, status: "published", stream_status: "ready", hls_url: null }) !== null);
  assertEquals(
    validateKbVideo({ ...VIDEO, status: "published", stream_status: "ready", hls_url: "https://x/v.m3u8" }),
    null,
  );
});

Deno.test("pickColumns + normalizeKbVideoRow: allowlist, trim, '' → null", () => {
  const picked = pickColumns(
    { title: " T ", slug: " t ", description: "", article_id: "", series_id: "s1", hls_url: "x", action: "y" },
    KB_VIDEO_COLUMNS,
  );
  assertEquals(Object.keys(picked).sort(), ["article_id", "description", "series_id", "slug", "title"]);
  assertEquals(normalizeKbVideoRow(picked), {
    title: "T",
    slug: "t",
    description: null,
    article_id: null,
    series_id: "s1",
  });
});

Deno.test("hasStreamColumns: any Stream-owned column in the body is flagged", () => {
  assertEquals(hasStreamColumns({ title: "x" }), false);
  assert(hasStreamColumns({ hls_url: "x" }));
  assert(hasStreamColumns({ stream_status: "ready" }));
  assert(hasStreamColumns({ stream_upload_expires_at: null }));
});
```

In `admin-kb_test.ts`, add to the first `validateKbArticle` test:

```ts
  assert(validateKbArticle({ ...BASE, slug: "video" }) !== null);
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/admin-kb-videos_test.ts supabase/functions/__tests__/admin-kb_test.ts`
Expected: FAIL (module not found; `video` accepted).

- [ ] **Step 3: Implement**

In `_shared/admin-kb.ts`, replace the `RESERVED_SLUGS` block:

```ts
/** Colidem com as rotas do Admin /admin/kb-articles/new e /:id/edit, e com /ajuda/video/:slug
 * do CRM. Espelho em apps/admin/src/pages/KbArticleEditorPage.tsx (RESERVED_SLUGS). */
export const RESERVED_SLUGS = ["novo", "editar", "video"];
```

In `apps/admin/src/pages/KbArticleEditorPage.tsx:52`:

```ts
const RESERVED_SLUGS = ['novo', 'editar', 'video'];
```

Create `supabase/functions/_shared/admin-kb-videos.ts`:

```ts
// Validação de séries e vídeos tutoriais da Central de Ajuda (kb_video_series, kb_videos).
// Usado por platform-admin/kb-videos.ts. Linha MESCLADA em update (current + campos novos).
import { RESERVED_SLUGS, SLUG_RE } from "./admin-kb.ts";

export const KB_VIDEO_SERIES_COLUMNS = ["title", "slug", "description", "display_order", "status"] as const;
export const KB_VIDEO_COLUMNS = [
  "title", "slug", "description", "series_id", "article_id", "display_order", "status",
] as const;
/** Escritas só pelo upload, pelo refresh, pelo cancelamento e pelo stream-webhook. */
export const KB_VIDEO_STREAM_COLUMNS = [
  "stream_uid", "stream_status", "stream_upload_expires_at", "duration_seconds", "hls_url", "thumbnail_url",
] as const;

export const KB_VIDEO_MAX_DURATION_S = 900;
export const KB_VIDEO_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_DISPLAY_ORDER = 10_000;
const MAX_DESCRIPTION = 500;

export function pickColumns(body: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

export function hasStreamColumns(body: Record<string, unknown>): boolean {
  return KB_VIDEO_STREAM_COLUMNS.some((col) => col in body);
}

export function normalizeKbVideoRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const col of ["title", "slug"] as const) {
    if (typeof out[col] === "string") out[col] = (out[col] as string).trim();
  }
  for (const col of ["description", "article_id"] as const) {
    if (typeof out[col] === "string") {
      const t = (out[col] as string).trim();
      out[col] = t.length > 0 ? t : null;
    }
  }
  return out;
}

function validateCommon(row: Record<string, unknown>): string | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length === 0 || title.length > 200) return "title required (max 200)";
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return "slug must be lowercase words separated by hyphens";
  if (RESERVED_SLUGS.includes(slug)) return `slug "${slug}" is reserved`;
  const description = row.description ?? null;
  if (description !== null && (typeof description !== "string" || description.length > MAX_DESCRIPTION)) {
    return `description max ${MAX_DESCRIPTION}`;
  }
  if (row.display_order !== undefined && row.display_order !== null) {
    const order = row.display_order;
    if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > MAX_DISPLAY_ORDER) {
      return `display_order must be an integer between 0 and ${MAX_DISPLAY_ORDER}`;
    }
  }
  const status = row.status ?? "draft";
  if (status !== "draft" && status !== "published") return "invalid status";
  return null;
}

export function validateKbVideoSeries(row: Record<string, unknown>): string | null {
  return validateCommon(row);
}

export function validateKbVideo(row: Record<string, unknown>): string | null {
  const common = validateCommon(row);
  if (common) return common;
  if (typeof row.series_id !== "string" || row.series_id.length === 0) return "series_id is required";
  const articleId = row.article_id ?? null;
  if (articleId !== null && (typeof articleId !== "string" || articleId.length === 0)) return "invalid article_id";
  if ((row.status ?? "draft") === "published") {
    if (row.stream_status !== "ready" || typeof row.hls_url !== "string" || row.hls_url.length === 0) {
      return "only a ready video can be published";
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/admin-kb-videos_test.ts supabase/functions/__tests__/admin-kb_test.ts`
Expected: PASS.

- [ ] **Step 5: Check no existing article already uses the `video` slug**

Run: `npx supabase db query --linked "select id, slug from kb_articles where slug = 'video'"`
Expected: zero rows. If a row exists, stop and ask the user before continuing (renaming that article changes a public URL).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/admin-kb-videos.ts supabase/functions/_shared/admin-kb.ts supabase/functions/__tests__/admin-kb-videos_test.ts supabase/functions/__tests__/admin-kb_test.ts apps/admin/src/pages/KbArticleEditorPage.tsx
git commit -m "feat(admin-kb): validação de séries e vídeos tutoriais; reserva o slug video"
```

---

### Task 6: platform-admin actions for videos

**Files:**
- Create: `supabase/functions/platform-admin/kb-videos.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (imports + `switch` cases before `default:`)
- Test: create `supabase/functions/__tests__/platform-admin-kb-videos_test.ts`

**Interfaces:**
- Consumes: Task 2 (`createStreamDirectUpload`, `getStreamVideo`, `deleteStreamVideo`, `isStreamCleanupEnabled`, `StreamVideoInfo`), Task 5 (validation module), `isUniqueViolation` from `_shared/admin-kb.ts`.
- Produces actions (request body → response JSON):
  - `list-kb-video-series` → `{ series: KbVideoSeries[] }`
  - `upsert-kb-video-series` `{ series_id?, title, slug, description?, display_order?, status? }` → `{ series }` (201 create / 200 update / 400 / 404 / 409)
  - `delete-kb-video-series` `{ series_id }` → `{ message }` (409 `series has videos`)
  - `list-kb-videos` → `{ videos: KbVideo[] }`
  - `get-kb-video` `{ video_id }` → `{ video }` (404)
  - `upsert-kb-video` `{ video_id?, title, slug, series_id, description?, article_id?, display_order?, status? }` → `{ video }` (201/200/400/404/409)
  - `delete-kb-video` `{ video_id }` → `{ message }`
  - `create-kb-video-upload` `{ video_id }` → `{ uploadURL, video }` (503 `stream_not_configured`, 404)
  - `refresh-kb-video` `{ video_id }` → `{ video }` (503, 404)
  - `cancel-kb-video-upload` `{ video_id, stream_uid }` → `{ video }` (400, 404)
  - `reorder-kb-videos` `{ items: Array<{ id: number; display_order: number }> }` → `{ message }` (400)
  - `interface KbVideoStreamDeps { enabled(): boolean; createDirectUpload(opts): Promise<{ uid; uploadURL }>; getVideo(uid): Promise<StreamVideoInfo>; deleteVideo(uid): Promise<void>; now(): number }`

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/platform-admin-kb-videos_test.ts`:

```ts
import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import {
  handleCancelKbVideoUpload,
  handleCreateKbVideoUpload,
  handleDeleteKbVideoSeries,
  handleRefreshKbVideo,
  handleReorderKbVideos,
  handleUpsertKbVideo,
  type KbVideoStreamDeps,
} from "../platform-admin/kb-videos.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;
const H = { "Content-Type": "application/json" };
const NOW = new Date("2026-09-28T12:00:00.000Z").getTime();

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, series_id: "s1", title: "Primeiro acesso", slug: "primeiro-acesso", description: null,
    article_id: null, display_order: 10, status: "draft", stream_uid: null, stream_status: "pending",
    stream_upload_expires_at: null, duration_seconds: null, hls_url: null, thumbnail_url: null,
    created_at: "2026-09-28T10:00:00.000Z", updated_at: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

function fakeStream(overrides: Partial<KbVideoStreamDeps> = {}) {
  const deleted: string[] = [];
  const uploads: Array<{ maxDurationSeconds: number; expiry: string; meta: Record<string, string> }> = [];
  const deps: KbVideoStreamDeps = {
    enabled: () => true,
    createDirectUpload: async (opts) => {
      uploads.push(opts);
      return { uid: "new-uid", uploadURL: "https://upload.example/new" };
    },
    getVideo: () => Promise.reject(new Error("unexpected getVideo")),
    deleteVideo: async (uid) => {
      deleted.push(uid);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, deleted, uploads };
}

Deno.test("create-kb-video-upload: persists uid + expiry before answering and deletes the replaced uid", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_uid: "old-uid", stream_status: "ready", hls_url: "h" }) });
  db.queue("kb_videos", "update", { data: row({ stream_uid: "new-uid" }) });
  const { deps, deleted, uploads } = fakeStream();

  const res = await handleCreateKbVideoUpload(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  const body = await readJson(res) as { uploadURL: string };
  assertEquals(body.uploadURL, "https://upload.example/new");
  const expiry = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();
  assertEquals(uploads, [{ maxDurationSeconds: 900, expiry, meta: { kind: "kb-video", video_id: "7" } }]);
  assertEquals(callsFor(db, "kb_videos", "update")[0].payload, {
    stream_uid: "new-uid",
    stream_status: "pending",
    stream_upload_expires_at: expiry,
    duration_seconds: null,
    hls_url: null,
    thumbnail_url: null,
  });
  assertEquals(deleted, ["old-uid"]);
});

Deno.test("create-kb-video-upload: 503 without Stream, and the new uid is released if the row write fails", async () => {
  const off = fakeStream({ enabled: () => false });
  const res = await handleCreateKbVideoUpload(createSupabaseQueryMock() as never, { video_id: 7 }, off.deps, H);
  assertEquals(res.status, 503);
  assertEquals((await readJson(res) as { error: string }).error, "stream_not_configured");

  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row() });
  db.queue("kb_videos", "update", { data: null, error: { message: "boom" } });
  const { deps, deleted } = fakeStream();
  let threw = false;
  try {
    await handleCreateKbVideoUpload(db as never, { video_id: 7 }, deps, H);
  } catch {
    threw = true;
  }
  assert(threw, "a failed row write must throw (generic 500 upstream)");
  assertEquals(deleted, ["new-uid"]);
});

Deno.test("upsert-kb-video: rejects Stream-owned columns from the client", async () => {
  const res = await handleUpsertKbVideo(
    createSupabaseQueryMock() as never,
    { title: "x", slug: "x", series_id: "s1", hls_url: "https://evil" },
    H,
  );
  assertEquals(res.status, 400);
});

Deno.test("upsert-kb-video: publishing a video that is not ready is refused", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_status: "pending", stream_uid: "u1" }) });
  const res = await handleUpsertKbVideo(db as never, { video_id: 7, status: "published" }, H);
  assertEquals(res.status, 400);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
});

Deno.test("upsert-kb-video: a related article must be published", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_articles", "select", { data: { id: "a1", status: "draft" } });
  const res = await handleUpsertKbVideo(
    db as never,
    { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1", article_id: "a1" },
    H,
  );
  assertEquals(res.status, 400);
  assertEquals(callsFor(db, "kb_videos", "insert").length, 0);
});

Deno.test("upsert-kb-video: creates a draft video with only allowlisted columns", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_videos", "insert", { data: row() });
  const res = await handleUpsertKbVideo(
    db as never,
    { action: "upsert-kb-video", title: " Primeiro acesso ", slug: "primeiro-acesso", series_id: "s1", display_order: 10 },
    H,
  );
  assertEquals(res.status, 201);
  assertEquals(callsFor(db, "kb_videos", "insert")[0].payload, {
    title: "Primeiro acesso",
    slug: "primeiro-acesso",
    series_id: "s1",
    display_order: 10,
  });
});

Deno.test("upsert-kb-video: duplicate slug is a 409", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_videos", "insert", { data: null, error: { code: "23505", message: "dup" } });
  const res = await handleUpsertKbVideo(
    db as never,
    { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1" },
    H,
  );
  assertEquals(res.status, 409);
});

Deno.test("refresh-kb-video: an expired upload that never arrived is cleared and its uid released", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", {
    data: row({ stream_uid: "u1", stream_upload_expires_at: new Date(NOW - 60_000).toISOString() }),
  });
  db.queue("kb_videos", "update", { data: row({ stream_uid: null, stream_status: "error" }) });
  const { deps, deleted } = fakeStream({
    getVideo: async () => ({ state: "pendingupload", duration: null, hls: null, thumbnail: null }),
  });

  const res = await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  const upd = callsFor(db, "kb_videos", "update")[0];
  assertEquals(upd.payload, { stream_uid: null, stream_status: "error", stream_upload_expires_at: null });
  // The mock also records .maybeSingle() as a modifier; the guard is the three eq filters.
  assertEquals(upd.modifiers.filter((m) => m.method === "eq"), [
    { method: "eq", args: ["id", 7] },
    { method: "eq", args: ["stream_uid", "u1"] },
    { method: "eq", args: ["stream_status", "pending"] },
  ]);
  assertEquals(deleted, ["u1"]);
});

Deno.test("refresh-kb-video: an upload still within its window is left alone", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", {
    data: row({ stream_uid: "u1", stream_upload_expires_at: new Date(NOW + 60_000).toISOString() }),
  });
  const { deps, deleted } = fakeStream({
    getVideo: async () => ({ state: "pendingupload", duration: null, hls: null, thumbnail: null }),
  });

  const res = await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
  assertEquals(deleted, []);
});

Deno.test("refresh-kb-video: a ready video is settled with its playback fields", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_uid: "u1" }) });
  db.queue("kb_videos", "update", { data: row({ stream_uid: "u1", stream_status: "ready" }) });
  const { deps } = fakeStream({
    getVideo: async () => ({ state: "ready", duration: 58, hls: "https://h/u1.m3u8", thumbnail: "https://h/u1.jpg" }),
  });

  await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(callsFor(db, "kb_videos", "update")[0].payload, {
    stream_status: "ready",
    duration_seconds: 58,
    hls_url: "https://h/u1.m3u8",
    thumbnail_url: "https://h/u1.jpg",
    stream_upload_expires_at: null,
  });
});

Deno.test("cancel-kb-video-upload: clears at once, but ignores a uid that is no longer current", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "update", { data: row({ stream_uid: null, stream_status: "error" }) });
  const { deps, deleted } = fakeStream();
  const res = await handleCancelKbVideoUpload(db as never, { video_id: 7, stream_uid: "u1" }, deps, H);
  assertEquals(res.status, 200);
  assertEquals(deleted, ["u1"]);

  const stale = createSupabaseQueryMock();
  stale.queue("kb_videos", "update", { data: null });
  stale.queue("kb_videos", "select", { data: row({ stream_uid: "newer" }) });
  const s = fakeStream();
  const res2 = await handleCancelKbVideoUpload(stale as never, { video_id: 7, stream_uid: "u1" }, s.deps, H);
  assertEquals(res2.status, 200);
  assertEquals(s.deleted, []);

  const bad = await handleCancelKbVideoUpload(createSupabaseQueryMock() as never, { video_id: 7 }, s.deps, H);
  assertEquals(bad.status, 400);
});

Deno.test("delete-kb-video-series: a series that still has videos is a 409", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "delete", { data: null, error: { code: "23503", message: "fk" } });
  const res = await handleDeleteKbVideoSeries(db as never, { series_id: "s1" }, H);
  assertEquals(res.status, 409);
});

Deno.test("reorder-kb-videos: validates every item before writing", async () => {
  const db = createSupabaseQueryMock();
  const bad = await handleReorderKbVideos(db as never, { items: [{ id: 1, display_order: 10 }, { id: "x", display_order: 20 }] }, H);
  assertEquals(bad.status, 400);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);

  const ok = await handleReorderKbVideos(db as never, { items: [{ id: 1, display_order: 20 }, { id: 2, display_order: 10 }] }, H);
  assertEquals(ok.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").map((c) => c.payload), [{ display_order: 20 }, { display_order: 10 }]);
});

Deno.test("platform-admin: every kb-video action is dispatched behind the admin gate", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  const gate = src.indexOf("if (!admin)");
  assert(gate > 0, "admin gate not found");
  for (
    const action of [
      "list-kb-video-series", "upsert-kb-video-series", "delete-kb-video-series", "list-kb-videos",
      "get-kb-video", "upsert-kb-video", "delete-kb-video", "create-kb-video-upload",
      "refresh-kb-video", "cancel-kb-video-upload", "reorder-kb-videos",
    ]
  ) {
    const at = src.indexOf(`case "${action}":`);
    assert(at > gate, `${action} must be dispatched after the admin gate`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/platform-admin-kb-videos_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the handlers**

`supabase/functions/platform-admin/kb-videos.ts`:

```ts
// Actions do Admin para os vídeos tutoriais da Central de Ajuda (spec
// 2026-09-28-ajuda-video-playlist-design). Handlers exportados para teste direto, no padrão de
// popups.ts. A autorização (platform_admins) já aconteceu em index.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isUniqueViolation } from "../_shared/admin-kb.ts";
import {
  hasStreamColumns,
  KB_VIDEO_COLUMNS,
  KB_VIDEO_MAX_DURATION_S,
  KB_VIDEO_SERIES_COLUMNS,
  KB_VIDEO_UPLOAD_TTL_MS,
  normalizeKbVideoRow,
  pickColumns,
  validateKbVideo,
  validateKbVideoSeries,
} from "../_shared/admin-kb-videos.ts";
import type { StreamVideoInfo } from "../_shared/stream.ts";

type Svc = SupabaseClient;
type Headers = Record<string, string>;
type Row = Record<string, unknown>;

export interface KbVideoStreamDeps {
  enabled(): boolean;
  createDirectUpload(
    opts: { maxDurationSeconds: number; expiry: string; meta: Record<string, string> },
  ): Promise<{ uid: string; uploadURL: string }>;
  getVideo(uid: string): Promise<StreamVideoInfo>;
  deleteVideo(uid: string): Promise<void>;
  now(): number;
}

const MAX_REORDER_ITEMS = 200;
const MAX_DISPLAY_ORDER = 10_000;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function isFkViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23503";
}

function parseVideoId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function bestEffortDelete(stream: KbVideoStreamDeps, uid: string, scope: string): Promise<void> {
  try {
    await stream.deleteVideo(uid);
  } catch (err) {
    // O orphan reap remove depois: este uid deixou de ser conhecido por kb_videos.
    console.error(`[platform-admin:${scope}] stream delete failed`, uid, err);
  }
}

async function readVideo(svc: Svc, id: number): Promise<Row | null> {
  const { data, error } = await svc.from("kb_videos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

/** Guarded write out of `pending`: matches only while the row still holds `uid`, so a newer upload
 * is never overwritten. Returns the updated row, or null when nothing matched. */
async function settlePending(svc: Svc, id: number, uid: string, patch: Row): Promise<Row | null> {
  const { data, error } = await svc
    .from("kb_videos")
    .update(patch)
    .eq("id", id)
    .eq("stream_uid", uid)
    .eq("stream_status", "pending")
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

async function clearUpload(svc: Svc, stream: KbVideoStreamDeps, id: number, uid: string): Promise<Row | null> {
  const video = await settlePending(svc, id, uid, {
    stream_uid: null,
    stream_status: "error",
    stream_upload_expires_at: null,
  });
  if (video) await bestEffortDelete(stream, uid, "kb-video-clear");
  return video;
}

// ─── Séries ──────────────────────────────────────────────────────

export async function handleListKbVideoSeries(svc: Svc, headers: Headers) {
  const { data, error } = await svc
    .from("kb_video_series")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return json({ series: data ?? [] }, 200, headers);
}

export async function handleUpsertKbVideoSeries(svc: Svc, body: Row, headers: Headers) {
  const seriesId = typeof body.series_id === "string" && body.series_id ? body.series_id : null;
  const fields = normalizeKbVideoRow(pickColumns(body, KB_VIDEO_SERIES_COLUMNS));
  let merged = fields;
  if (seriesId) {
    const { data: current, error } = await svc.from("kb_video_series").select("*").eq("id", seriesId).maybeSingle();
    if (error) throw error;
    if (!current) return json({ error: "Series not found" }, 404, headers);
    merged = { ...(current as Row), ...fields };
  }
  const fieldError = validateKbVideoSeries(merged);
  if (fieldError) return json({ error: fieldError }, 400, headers);

  const { data, error } = seriesId
    ? await svc.from("kb_video_series").update(fields).eq("id", seriesId).select().single()
    : await svc.from("kb_video_series").insert(fields).select().single();
  if (error) {
    if (isUniqueViolation(error)) return json({ error: "slug already in use" }, 409, headers);
    throw error;
  }
  return json({ series: data }, seriesId ? 200 : 201, headers);
}

export async function handleDeleteKbVideoSeries(svc: Svc, body: Row, headers: Headers) {
  const seriesId = typeof body.series_id === "string" && body.series_id ? body.series_id : null;
  if (!seriesId) return json({ error: "series_id is required" }, 400, headers);
  const { error } = await svc.from("kb_video_series").delete().eq("id", seriesId);
  if (error) {
    if (isFkViolation(error)) return json({ error: "series has videos" }, 409, headers);
    throw error;
  }
  return json({ message: "Series deleted" }, 200, headers);
}

// ─── Vídeos ──────────────────────────────────────────────────────

export async function handleListKbVideos(svc: Svc, headers: Headers) {
  const { data, error } = await svc.from("kb_videos").select("*").order("display_order", { ascending: true });
  if (error) throw error;
  return json({ videos: data ?? [] }, 200, headers);
}

export async function handleGetKbVideo(svc: Svc, body: Row, headers: Headers) {
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const video = await readVideo(svc, id);
  if (!video) return json({ error: "Video not found" }, 404, headers);
  return json({ video }, 200, headers);
}

export async function handleUpsertKbVideo(svc: Svc, body: Row, headers: Headers) {
  if (hasStreamColumns(body)) return json({ error: "stream fields are read-only" }, 400, headers);
  const hasId = body.video_id !== undefined && body.video_id !== null;
  const id = hasId ? parseVideoId(body.video_id) : null;
  if (hasId && !id) return json({ error: "invalid video_id" }, 400, headers);

  const fields = normalizeKbVideoRow(pickColumns(body, KB_VIDEO_COLUMNS));
  let current: Row | null = null;
  if (id) {
    current = await readVideo(svc, id);
    if (!current) return json({ error: "Video not found" }, 404, headers);
  }
  const merged = { ...(current ?? {}), ...fields };
  const fieldError = validateKbVideo(merged);
  if (fieldError) return json({ error: fieldError }, 400, headers);

  const { data: series, error: seriesErr } = await svc
    .from("kb_video_series").select("id").eq("id", merged.series_id as string).maybeSingle();
  if (seriesErr) throw seriesErr;
  if (!series) return json({ error: "series not found" }, 400, headers);

  if (merged.article_id) {
    const { data: article, error: articleErr } = await svc
      .from("kb_articles").select("id, status").eq("id", merged.article_id as string).maybeSingle();
    if (articleErr) throw articleErr;
    if (!article || (article as Row).status !== "published") {
      return json({ error: "related article must be published" }, 400, headers);
    }
  }

  const { data, error } = id
    ? await svc.from("kb_videos").update(fields).eq("id", id).select().single()
    : await svc.from("kb_videos").insert(fields).select().single();
  if (error) {
    if (isUniqueViolation(error)) return json({ error: "slug already in use" }, 409, headers);
    throw error;
  }
  return json({ video: data }, id ? 200 : 201, headers);
}

export async function handleDeleteKbVideo(svc: Svc, body: Row, stream: KbVideoStreamDeps, headers: Headers) {
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);
  const { error } = await svc.from("kb_videos").delete().eq("id", id);
  if (error) throw error;
  if (typeof current.stream_uid === "string") await bestEffortDelete(stream, current.stream_uid, "kb-video-delete");
  return json({ message: "Video deleted" }, 200, headers);
}

// ─── Upload / processamento ─────────────────────────────────────

export async function handleCreateKbVideoUpload(
  svc: Svc,
  body: Row,
  stream: KbVideoStreamDeps,
  headers: Headers,
) {
  if (!stream.enabled()) return json({ error: "stream_not_configured" }, 503, headers);
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);

  const expiry = new Date(stream.now() + KB_VIDEO_UPLOAD_TTL_MS).toISOString();
  const { uid, uploadURL } = await stream.createDirectUpload({
    maxDurationSeconds: KB_VIDEO_MAX_DURATION_S,
    expiry,
    meta: { kind: "kb-video", video_id: String(id) },
  });

  // O uid é gravado ANTES de responder: o orphan reap nunca o vê como desconhecido.
  const { data: video, error } = await svc
    .from("kb_videos")
    .update({
      stream_uid: uid,
      stream_status: "pending",
      stream_upload_expires_at: expiry,
      duration_seconds: null,
      hls_url: null,
      thumbnail_url: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    await bestEffortDelete(stream, uid, "kb-video-upload");
    throw error;
  }

  const oldUid = typeof current.stream_uid === "string" ? current.stream_uid : null;
  if (oldUid && oldUid !== uid) await bestEffortDelete(stream, oldUid, "kb-video-upload");

  return json({ uploadURL, video }, 200, headers);
}

export async function handleRefreshKbVideo(svc: Svc, body: Row, stream: KbVideoStreamDeps, headers: Headers) {
  if (!stream.enabled()) return json({ error: "stream_not_configured" }, 503, headers);
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);

  const uid = typeof current.stream_uid === "string" ? current.stream_uid : null;
  if (current.stream_status !== "pending" || !uid) return json({ video: current }, 200, headers);

  const info = await stream.getVideo(uid);
  if (info.state === "ready" && info.hls) {
    const video = await settlePending(svc, id, uid, {
      stream_status: "ready",
      duration_seconds: info.duration,
      hls_url: info.hls,
      thumbnail_url: info.thumbnail,
      stream_upload_expires_at: null,
    });
    return json({ video: video ?? current }, 200, headers);
  }
  if (info.state === "error") {
    const video = await settlePending(svc, id, uid, { stream_status: "error", stream_upload_expires_at: null });
    return json({ video: video ?? current }, 200, headers);
  }
  const expiresAt = typeof current.stream_upload_expires_at === "string"
    ? Date.parse(current.stream_upload_expires_at)
    : NaN;
  const neverArrived = info.state === "pendingupload" || info.state === "notfound";
  if (neverArrived && Number.isFinite(expiresAt) && expiresAt < stream.now()) {
    const video = await clearUpload(svc, stream, id, uid);
    return json({ video: video ?? current }, 200, headers);
  }
  return json({ video: current }, 200, headers);
}

export async function handleCancelKbVideoUpload(
  svc: Svc,
  body: Row,
  stream: KbVideoStreamDeps,
  headers: Headers,
) {
  const id = parseVideoId(body.video_id);
  const uid = typeof body.stream_uid === "string" && body.stream_uid ? body.stream_uid : null;
  if (!id || !uid) return json({ error: "video_id and stream_uid are required" }, 400, headers);
  const video = await clearUpload(svc, stream, id, uid);
  if (video) return json({ video }, 200, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);
  return json({ video: current }, 200, headers);
}

export async function handleReorderKbVideos(svc: Svc, body: Row, headers: Headers) {
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0 || items.length > MAX_REORDER_ITEMS) {
    return json({ error: `items must have 1 to ${MAX_REORDER_ITEMS} entries` }, 400, headers);
  }
  const parsed: Array<{ id: number; display_order: number }> = [];
  for (const item of items as Row[]) {
    const id = parseVideoId(item?.id);
    const order = item?.display_order;
    if (!id || !Number.isInteger(order) || (order as number) < 0 || (order as number) > MAX_DISPLAY_ORDER) {
      return json({ error: "invalid reorder item" }, 400, headers);
    }
    parsed.push({ id, display_order: order as number });
  }
  for (const item of parsed) {
    const { error } = await svc.from("kb_videos").update({ display_order: item.display_order }).eq("id", item.id);
    if (error) throw error;
  }
  return json({ message: "Reordered" }, 200, headers);
}
```

- [ ] **Step 4: Wire the dispatcher**

In `platform-admin/index.ts`, add imports next to the popups import:

```ts
import {
  handleCancelKbVideoUpload,
  handleCreateKbVideoUpload,
  handleDeleteKbVideo,
  handleDeleteKbVideoSeries,
  handleGetKbVideo,
  handleListKbVideos,
  handleListKbVideoSeries,
  handleRefreshKbVideo,
  handleReorderKbVideos,
  handleUpsertKbVideo,
  handleUpsertKbVideoSeries,
  type KbVideoStreamDeps,
} from "./kb-videos.ts";
import { createStreamDirectUpload, deleteStreamVideo, getStreamVideo, isStreamCleanupEnabled } from "../_shared/stream.ts";
```

Below `SUPABASE_SERVICE_ROLE_KEY`:

```ts
// Playback público dos tutoriais não usa as chaves de assinatura: conta + token bastam.
const kbVideoStream: KbVideoStreamDeps = {
  enabled: () => isStreamCleanupEnabled(),
  createDirectUpload: (opts) => createStreamDirectUpload(opts),
  getVideo: (uid) => getStreamVideo(uid),
  deleteVideo: (uid) => deleteStreamVideo(uid),
  now: () => Date.now(),
};
```

In the `switch`, right after `case "delete-kb-context-link": …`:

```ts
      case "list-kb-video-series":
        return await handleListKbVideoSeries(svc, headers);
      case "upsert-kb-video-series":
        return await handleUpsertKbVideoSeries(svc, body, headers);
      case "delete-kb-video-series":
        return await handleDeleteKbVideoSeries(svc, body, headers);
      case "list-kb-videos":
        return await handleListKbVideos(svc, headers);
      case "get-kb-video":
        return await handleGetKbVideo(svc, body, headers);
      case "upsert-kb-video":
        return await handleUpsertKbVideo(svc, body, headers);
      case "delete-kb-video":
        return await handleDeleteKbVideo(svc, body, kbVideoStream, headers);
      case "create-kb-video-upload":
        return await handleCreateKbVideoUpload(svc, body, kbVideoStream, headers);
      case "refresh-kb-video":
        return await handleRefreshKbVideo(svc, body, kbVideoStream, headers);
      case "cancel-kb-video-upload":
        return await handleCancelKbVideoUpload(svc, body, kbVideoStream, headers);
      case "reorder-kb-videos":
        return await handleReorderKbVideos(svc, body, headers);
```

- [ ] **Step 5: Run to verify pass**

Run: `deno test --no-check --allow-env --allow-read supabase/functions/__tests__/platform-admin-kb-videos_test.ts && npm run check:functions`
Expected: PASS; `deno check` clean (fix any `Row` casts it flags).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-admin supabase/functions/__tests__/platform-admin-kb-videos_test.ts
git commit -m "feat(platform-admin): actions de séries, vídeos e upload para o Stream"
```

---

### Task 7: Admin API client, status helpers and Stream upload

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (insert after `deleteKbContextLink`, ~line 832)
- Create: `apps/admin/src/lib/slugify.ts`, `apps/admin/src/lib/kb-video-status.ts`, `apps/admin/src/lib/stream-upload.ts`
- Test: `apps/admin/src/lib/__tests__/kb-video-status.test.ts`, `apps/admin/src/lib/__tests__/stream-upload.test.ts`

**Interfaces:**
- Consumes: Task 6 actions.
- Produces:
  - Types `KbVideoSeries`, `KbVideo`, `KbVideoStreamStatus` and functions `listKbVideoSeries()`, `upsertKbVideoSeries(params)`, `deleteKbVideoSeries(series_id)`, `listKbVideos()`, `getKbVideo(video_id)`, `upsertKbVideo(params)`, `deleteKbVideo(video_id)`, `createKbVideoUpload(video_id)`, `refreshKbVideo(video_id)`, `cancelKbVideoUpload(video_id, stream_uid)`, `reorderKbVideos(items)` from `lib/api.ts`.
  - `slugify(text: string): string` from `lib/slugify.ts`.
  - From `lib/kb-video-status.ts`: `KB_VIDEOS_KEY`, `KB_VIDEO_SERIES_KEY`, `kbVideoKey(id)`, `publishBadge(status)`, `processingBadge(video)`, `needsAutoRefresh(video, nowMs)`, `formatDuration(seconds)`, `reorderedItems(list, index, delta)`, `groupBySeries(series, videos)`, type `BadgeSpec`.
  - From `lib/stream-upload.ts`: `KB_VIDEO_MAX_BYTES`, `validateVideoFile(file)`, `postToStream(uploadURL, file, onProgress?, signal?)`, `uploadKbVideo(videoId, file, opts?)`.

- [ ] **Step 1: Write the failing tests**

`apps/admin/src/lib/__tests__/kb-video-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  groupBySeries,
  needsAutoRefresh,
  processingBadge,
  reorderedItems,
} from '../kb-video-status';
import type { KbVideo, KbVideoSeries } from '../api';

function video(overrides: Partial<KbVideo> = {}): KbVideo {
  return {
    id: 1, series_id: 's1', title: 'V', slug: 'v', description: null, article_id: null, display_order: 10,
    status: 'draft', stream_uid: null, stream_status: 'pending', stream_upload_expires_at: null,
    duration_seconds: null, hls_url: null, thumbnail_url: null,
    created_at: '2026-09-28T10:00:00.000Z', updated_at: '2026-09-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('processingBadge', () => {
  it('names every Stream state the list can show', () => {
    expect(processingBadge(video()).label).toBe('Sem arquivo');
    expect(processingBadge(video({ stream_uid: 'u' })).label).toBe('Processando');
    expect(processingBadge(video({ stream_uid: 'u', stream_status: 'ready' })).label).toBe('Pronto');
    expect(processingBadge(video({ stream_uid: 'u', stream_status: 'error' })).label).toBe('Erro');
    expect(processingBadge(video({ stream_uid: null, stream_status: 'error' })).label).toBe('Envio interrompido');
  });
});

describe('needsAutoRefresh', () => {
  const now = Date.parse('2026-09-28T10:10:00.000Z');
  it('only for a pending upload with a uid older than 5 minutes', () => {
    expect(needsAutoRefresh(video({ stream_uid: 'u' }), now)).toBe(true);
    expect(needsAutoRefresh(video({ stream_uid: 'u', updated_at: '2026-09-28T10:08:00.000Z' }), now)).toBe(false);
    expect(needsAutoRefresh(video(), now)).toBe(false);
    expect(needsAutoRefresh(video({ stream_uid: 'u', stream_status: 'ready' }), now)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats m:ss and hides unknown durations', () => {
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(null)).toBe('');
  });
});

describe('reorderedItems', () => {
  const list = [video({ id: 1 }), video({ id: 2 }), video({ id: 3 })];
  it('moves one item and renumbers the whole series in steps of 10', () => {
    expect(reorderedItems(list, 2, -1)).toEqual([
      { id: 1, display_order: 10 },
      { id: 3, display_order: 20 },
      { id: 2, display_order: 30 },
    ]);
  });
  it('returns null at the edges', () => {
    expect(reorderedItems(list, 0, -1)).toBeNull();
    expect(reorderedItems(list, 2, 1)).toBeNull();
  });
});

describe('groupBySeries', () => {
  it('keeps series order and sorts each group by display_order', () => {
    const series: KbVideoSeries[] = [
      { id: 's2', title: 'B', slug: 'b', description: null, display_order: 2, status: 'draft', created_at: '', updated_at: '' },
      { id: 's1', title: 'A', slug: 'a', description: null, display_order: 1, status: 'draft', created_at: '', updated_at: '' },
    ];
    const groups = groupBySeries(series, [
      video({ id: 1, series_id: 's1', display_order: 20 }),
      video({ id: 2, series_id: 's1', display_order: 10 }),
      video({ id: 3, series_id: 's2' }),
    ]);
    expect(groups.map((g) => g.series.id)).toEqual(['s1', 's2']);
    expect(groups[0].videos.map((v) => v.id)).toEqual([2, 1]);
  });
});
```

`apps/admin/src/lib/__tests__/stream-upload.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  createKbVideoUpload: vi.fn(),
  cancelKbVideoUpload: vi.fn(),
}));

import { cancelKbVideoUpload, createKbVideoUpload } from '../api';
import { postToStream, uploadKbVideo, validateVideoFile } from '../stream-upload';

class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  body: unknown = null;
  status = 0;
  timeout = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXhr.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.mocked(createKbVideoUpload).mockResolvedValue({
    uploadURL: 'https://upload.example/u1',
    video: { id: 7, stream_uid: 'u1' },
  } as never);
  vi.mocked(cancelKbVideoUpload).mockResolvedValue({ video: {} } as never);
});

const file = new File(['x'], 'tutorial.mp4', { type: 'video/mp4' });

describe('validateVideoFile', () => {
  it('accepts videos up to 200 MB only', () => {
    expect(validateVideoFile(file)).toBeNull();
    expect(validateVideoFile(new File(['x'], 'a.png', { type: 'image/png' }))).toMatch(/vídeo/);
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 201 * 1024 * 1024 });
    expect(validateVideoFile(big)).toMatch(/200 MB/);
  });
});

describe('postToStream', () => {
  it('POSTs the file as multipart "file" and reports progress', async () => {
    const onProgress = vi.fn();
    const done = postToStream('https://upload.example/u1', file, onProgress);
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://upload.example/u1');
    expect((xhr.body as FormData).get('file')).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.status = 200;
    xhr.onload?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects on a non-2xx answer', async () => {
    const done = postToStream('https://upload.example/u1', file);
    FakeXhr.last!.status = 400;
    FakeXhr.last!.onload?.();
    await expect(done).rejects.toThrow('400');
  });
});

describe('uploadKbVideo', () => {
  it('cancels the reservation when the upload is aborted', async () => {
    const controller = new AbortController();
    const done = uploadKbVideo(7, file, { signal: controller.signal });
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelKbVideoUpload).toHaveBeenCalledWith(7, 'u1');
  });

  it('returns the pending video after a successful upload', async () => {
    const done = uploadKbVideo(7, file);
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    FakeXhr.last!.status = 200;
    FakeXhr.last!.onload?.();
    await expect(done).resolves.toMatchObject({ id: 7, stream_uid: 'u1' });
    expect(cancelKbVideoUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/lib/__tests__/kb-video-status.test.ts apps/admin/src/lib/__tests__/stream-upload.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

Append to `apps/admin/src/lib/api.ts` after `deleteKbContextLink`:

```ts
// ─── KB Vídeos (tutoriais da Central de Ajuda) ──────────────────

export type KbVideoStreamStatus = 'pending' | 'ready' | 'error';

export interface KbVideoSeries {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  display_order: number;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
}

export interface KbVideo {
  id: number;
  series_id: string;
  title: string;
  slug: string;
  description: string | null;
  article_id: string | null;
  display_order: number;
  status: 'draft' | 'published';
  stream_uid: string | null;
  stream_status: KbVideoStreamStatus;
  stream_upload_expires_at: string | null;
  duration_seconds: number | null;
  hls_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export function listKbVideoSeries() {
  return adminApi<{ series: KbVideoSeries[] }>('list-kb-video-series');
}

export function upsertKbVideoSeries(params: Record<string, unknown>) {
  return adminApi<{ series: KbVideoSeries }>('upsert-kb-video-series', params);
}

export function deleteKbVideoSeries(series_id: string) {
  return adminApi<{ message: string }>('delete-kb-video-series', { series_id });
}

export function listKbVideos() {
  return adminApi<{ videos: KbVideo[] }>('list-kb-videos');
}

export function getKbVideo(video_id: number) {
  return adminApi<{ video: KbVideo }>('get-kb-video', { video_id });
}

export function upsertKbVideo(params: Record<string, unknown>) {
  return adminApi<{ video: KbVideo }>('upsert-kb-video', params);
}

export function deleteKbVideo(video_id: number) {
  return adminApi<{ message: string }>('delete-kb-video', { video_id });
}

export function createKbVideoUpload(video_id: number) {
  return adminApi<{ uploadURL: string; video: KbVideo }>('create-kb-video-upload', { video_id });
}

export function refreshKbVideo(video_id: number) {
  return adminApi<{ video: KbVideo }>('refresh-kb-video', { video_id });
}

export function cancelKbVideoUpload(video_id: number, stream_uid: string) {
  return adminApi<{ video: KbVideo }>('cancel-kb-video-upload', { video_id, stream_uid });
}

export function reorderKbVideos(items: Array<{ id: number; display_order: number }>) {
  return adminApi<{ message: string }>('reorder-kb-videos', { items });
}
```

`apps/admin/src/lib/slugify.ts`:

```ts
/** Mesmo slug que o editor de artigos gera: minúsculas, sem acento, palavras separadas por hífen. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

`apps/admin/src/lib/kb-video-status.ts`:

```ts
import type { KbVideo, KbVideoSeries } from './api';

export const KB_VIDEOS_KEY = ['admin', 'kb-videos'] as const;
export const KB_VIDEO_SERIES_KEY = ['admin', 'kb-video-series'] as const;
export const kbVideoKey = (id: number | null) => ['admin', 'kb-video', id] as const;

/** A pending upload untouched for this long gets one automatic refresh-kb-video per page load. */
export const AUTO_REFRESH_AFTER_MS = 5 * 60_000;

export interface BadgeSpec {
  label: string;
  variant: 'success' | 'neutral' | 'warning' | 'danger' | 'info';
}

export function publishBadge(status: KbVideo['status'] | KbVideoSeries['status']): BadgeSpec {
  return status === 'published'
    ? { label: 'Publicado', variant: 'success' }
    : { label: 'Rascunho', variant: 'neutral' };
}

export function processingBadge(video: Pick<KbVideo, 'stream_status' | 'stream_uid'>): BadgeSpec {
  if (video.stream_status === 'ready') return { label: 'Pronto', variant: 'success' };
  if (video.stream_status === 'error') {
    return video.stream_uid
      ? { label: 'Erro', variant: 'danger' }
      : { label: 'Envio interrompido', variant: 'warning' };
  }
  return video.stream_uid
    ? { label: 'Processando', variant: 'info' }
    : { label: 'Sem arquivo', variant: 'neutral' };
}

export function needsAutoRefresh(video: KbVideo, nowMs: number): boolean {
  if (video.stream_status !== 'pending' || !video.stream_uid) return false;
  const updated = Date.parse(video.updated_at);
  return Number.isFinite(updated) && nowMs - updated > AUTO_REFRESH_AFTER_MS;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Moves list[index] by delta and renumbers the whole list (10, 20, 30…), or null at an edge. */
export function reorderedItems(
  list: KbVideo[],
  index: number,
  delta: -1 | 1,
): Array<{ id: number; display_order: number }> | null {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((v, i) => ({ id: v.id, display_order: (i + 1) * 10 }));
}

export function groupBySeries(
  series: KbVideoSeries[],
  videos: KbVideo[],
): Array<{ series: KbVideoSeries; videos: KbVideo[] }> {
  return [...series]
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => ({
      series: s,
      videos: videos
        .filter((v) => v.series_id === s.id)
        .sort((a, b) => a.display_order - b.display_order || a.id - b.id),
    }));
}
```

`apps/admin/src/lib/stream-upload.ts`:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { cancelKbVideoUpload, createKbVideoUpload, type KbVideo } from './api';

export const KB_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Direct uploads are single POSTs; a 200 MB file on a slow uplink can take a while. */
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

export function validateVideoFile(file: File): string | null {
  if (!file.type.startsWith('video/')) return 'O arquivo precisa ser um vídeo.';
  if (file.size > KB_VIDEO_MAX_BYTES) return 'O vídeo precisa ter até 200 MB.';
  return null;
}

/** POSTs the file to a Stream direct-upload URL as multipart field "file". */
export function postToStream(
  uploadURL: string,
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Envio cancelado.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', uploadURL);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Network error during upload'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Envio cancelado.', 'AbortError'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new DOMException('O envio demorou demais. Tente novamente.', 'TimeoutError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** Reserves a Stream upload for the video, sends the file, and releases the reservation on any
 * failure (cancel included) so the row never sits in "Processando" for bytes that never came.
 * Held in the unsaved-work registry so a silent deploy swap can't abort it. */
export function uploadKbVideo(
  videoId: number,
  file: File,
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
): Promise<KbVideo> {
  return trackUnsavedWork(
    (async () => {
      const { uploadURL, video } = await createKbVideoUpload(videoId);
      try {
        await postToStream(uploadURL, file, opts.onProgress, opts.signal);
      } catch (err) {
        if (video.stream_uid) await cancelKbVideoUpload(videoId, video.stream_uid).catch(() => undefined);
        throw err;
      }
      return video;
    })(),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/admin/src/lib/__tests__/kb-video-status.test.ts apps/admin/src/lib/__tests__/stream-upload.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib
git commit -m "feat(admin): cliente de vídeos tutoriais e upload direto para o Stream"
```

---

### Task 8: Admin "Vídeos" list page + series dialog

**Files:**
- Create: `apps/admin/src/pages/KbVideosPage.tsx`, `apps/admin/src/pages/kb-videos/SeriesDialog.tsx`
- Modify: `apps/admin/src/lib/routes.ts`, `apps/admin/src/router.tsx`, `apps/admin/src/layouts/AdminLayout.tsx`, `apps/admin/src/__tests__/no-hex-literals.test.ts`
- Test: `apps/admin/src/pages/__tests__/KbVideosPage.test.tsx`

**Interfaces:**
- Consumes: Task 7.
- Produces: `kbVideosPath()`, `kbVideoNewPath()`, `kbVideoEditPath(id: number)` in `lib/routes.ts`; routes `/admin/kb-videos`, `/admin/kb-videos/new`, `/admin/kb-videos/:id/edit` (the last two render `KbVideoEditorPage`, created in Task 9; until then point them at a lazy import that Task 9 fills; see Step 4).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/pages/__tests__/KbVideosPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listKbVideoSeries: vi.fn(),
  listKbVideos: vi.fn(),
  refreshKbVideo: vi.fn(),
  reorderKbVideos: vi.fn(),
  upsertKbVideoSeries: vi.fn(),
  deleteKbVideoSeries: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { listKbVideos, listKbVideoSeries, refreshKbVideo, reorderKbVideos } from '../../lib/api';
import KbVideosPage from '../KbVideosPage';

const series = [
  { id: 's1', title: 'Primeiros passos', slug: 'primeiros-passos', description: null, display_order: 1, status: 'published', created_at: '', updated_at: '' },
];
const base = {
  series_id: 's1', description: null, article_id: null, status: 'draft', stream_upload_expires_at: null,
  hls_url: null, thumbnail_url: null, created_at: '', updated_at: new Date().toISOString(),
};
const videos = [
  { ...base, id: 1, title: 'Primeiro acesso', slug: 'primeiro-acesso', display_order: 10, stream_uid: 'u1', stream_status: 'ready', duration_seconds: 65, status: 'published' },
  { ...base, id: 2, title: 'Equipe', slug: 'equipe', display_order: 20, stream_uid: 'u2', stream_status: 'pending', duration_seconds: null },
];

beforeEach(() => {
  vi.mocked(listKbVideoSeries).mockResolvedValue({ series } as never);
  vi.mocked(listKbVideos).mockResolvedValue({ videos } as never);
  vi.mocked(refreshKbVideo).mockResolvedValue({ video: videos[1] } as never);
  vi.mocked(reorderKbVideos).mockResolvedValue({ message: 'ok' } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KbVideosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideosPage', () => {
  it('groups videos under their series with links to the editor', async () => {
    renderPage();
    expect(await screen.findByText('Primeiros passos')).toBeInTheDocument();
    const links = await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    for (const l of links) expect(l).toHaveAttribute('href', '/admin/kb-videos/1/edit');
    expect(screen.getAllByText('Pronto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1:05').length).toBeGreaterThan(0);
  });

  it('"Novo vídeo" links to the new-video route', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Novo vídeo/ })).toHaveAttribute('href', '/admin/kb-videos/new');
  });

  it('moving a video down renumbers the series', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mover Primeiro acesso para baixo' })[0]);
    await waitFor(() =>
      expect(reorderKbVideos).toHaveBeenCalledWith([
        { id: 2, display_order: 10 },
        { id: 1, display_order: 20 },
      ]),
    );
  });

  it('does not auto-refresh a pending upload that is still fresh', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Equipe' });
    expect(refreshKbVideo).not.toHaveBeenCalled();
  });

  it('shows an empty state when there are no series yet', async () => {
    vi.mocked(listKbVideoSeries).mockResolvedValue({ series: [] } as never);
    vi.mocked(listKbVideos).mockResolvedValue({ videos: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhuma série ainda')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbVideosPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Append to `apps/admin/src/lib/routes.ts`:

```ts
export const kbVideosPath = () => '/admin/kb-videos';
export const kbVideoNewPath = () => '/admin/kb-videos/new';
export const kbVideoEditPath = (id: number) => `/admin/kb-videos/${id}/edit`;
```

`apps/admin/src/pages/kb-videos/SeriesDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import {
  deleteKbVideoSeries,
  upsertKbVideoSeries,
  type AdminApiError,
  type KbVideoSeries,
} from '../../lib/api';
import { KB_VIDEO_SERIES_KEY } from '../../lib/kb-video-status';
import { slugify } from '../../lib/slugify';
import { Button } from '../../components/ui/button';

const FIELD =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';

interface SeriesDialogProps {
  /** null = nova série */
  series: KbVideoSeries | null;
  onClose: () => void;
}

export function SeriesDialog({ series, onClose }: SeriesDialogProps) {
  const qc = useQueryClient();
  const isEdit = !!series;
  const [title, setTitle] = useState(series?.title ?? '');
  const [slug, setSlug] = useState(series?.slug ?? '');
  const [description, setDescription] = useState(series?.description ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(series?.display_order ?? 0));
  const [status, setStatus] = useState<'draft' | 'published'>(series?.status ?? 'draft');

  useEffect(() => {
    if (!isEdit) setSlug(slugify(title));
  }, [title, isEdit]);

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey: KB_VIDEO_SERIES_KEY });
    toast.success(message);
    onClose();
  };

  const saveMut = useMutation({
    mutationFn: () =>
      upsertKbVideoSeries({
        ...(series ? { series_id: series.id } : {}),
        title,
        slug,
        description: description || null,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status,
      }),
    onSuccess: () => done(isEdit ? 'Série atualizada' : 'Série criada'),
    onError: (err: AdminApiError) =>
      toast.error(err.status === 409 ? 'Já existe uma série com esse slug.' : err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteKbVideoSeries(series!.id),
    onSuccess: () => done('Série excluída'),
    onError: (err: AdminApiError) =>
      toast.error(
        err.status === 409 ? 'Esta série ainda tem vídeos. Mova ou exclua os vídeos antes.' : err.message,
      ),
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-dialog-title"
        className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="series-dialog-title" className="text-lg font-semibold">
            {isEdit ? 'Editar série' : 'Nova série'}
          </h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
        >
          <div>
            <label htmlFor="series-title" className={LABEL}>Título</label>
            <input id="series-title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label htmlFor="series-slug" className={LABEL}>Slug</label>
            <input id="series-slug" className={FIELD} value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div>
            <label htmlFor="series-description" className={LABEL}>Descrição</label>
            <textarea
              id="series-description"
              className={FIELD}
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="series-order" className={LABEL}>Ordem</label>
              <input
                id="series-order"
                type="number"
                min={0}
                max={10000}
                className={FIELD}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="series-status" className={LABEL}>Status</label>
              <select
                id="series-status"
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
              >
                <option value="draft">Rascunho</option>
                <option value="published">Publicado</option>
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {isEdit ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (confirm('Excluir esta série?')) deleteMut.mutate();
                }}
              >
                Excluir série
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={saveMut.isPending || !title || !slug}>
              {saveMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

`apps/admin/src/pages/KbVideosPage.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Film, FolderPlus, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  listKbVideos,
  listKbVideoSeries,
  refreshKbVideo,
  reorderKbVideos,
  type KbVideo,
  type KbVideoSeries,
} from '../lib/api';
import {
  formatDuration,
  groupBySeries,
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  needsAutoRefresh,
  processingBadge,
  publishBadge,
  reorderedItems,
} from '../lib/kb-video-status';
import { kbVideoEditPath, kbVideoNewPath } from '../lib/routes';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { SeriesDialog } from './kb-videos/SeriesDialog';

const PENDING_POLL_MS = 10_000;

export default function KbVideosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ series: KbVideoSeries | null } | null>(null);

  const seriesQuery = useQuery({ queryKey: KB_VIDEO_SERIES_KEY, queryFn: listKbVideoSeries });
  const videosQuery = useQuery({
    queryKey: KB_VIDEOS_KEY,
    queryFn: listKbVideos,
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => v.stream_status === 'pending' && v.stream_uid)
        ? PENDING_POLL_MS
        : false,
  });

  // One refresh-kb-video per stale pending row per page load: covers a missed webhook and
  // uploads abandoned past their expiry.
  const refreshed = useRef(new Set<number>());
  useEffect(() => {
    const now = Date.now();
    for (const v of videosQuery.data?.videos ?? []) {
      if (!needsAutoRefresh(v, now) || refreshed.current.has(v.id)) continue;
      refreshed.current.add(v.id);
      refreshKbVideo(v.id)
        .then(() => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }))
        .catch(() => undefined);
    }
  }, [videosQuery.data, qc]);

  const reorderMut = useMutation({
    mutationFn: reorderKbVideos,
    onSuccess: () => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }),
    onError: () => toast.error('Não foi possível reordenar.'),
  });

  const groups = useMemo(
    () => groupBySeries(seriesQuery.data?.series ?? [], videosQuery.data?.videos ?? []),
    [seriesQuery.data, videosQuery.data],
  );

  const move = (list: KbVideo[], index: number, delta: -1 | 1) => {
    const items = reorderedItems(list, index, delta);
    if (items) reorderMut.mutate(items);
  };

  const isLoading = seriesQuery.isLoading || videosQuery.isLoading;
  const isError = seriesQuery.isError || videosQuery.isError;

  return (
    <div>
      <PageHeader
        title="Vídeos tutoriais"
        description="Playlist da Central de Ajuda do CRM"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDialog({ series: null })}>
              <FolderPlus />
              Nova série
            </Button>
            <Button asChild>
              <Link to={kbVideoNewPath()}>
                <Plus />
                Novo vídeo
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        </Card>
      ) : isError ? (
        <Card className="p-5">
          <ErrorState
            message="Não foi possível carregar os vídeos."
            onRetry={() => {
              seriesQuery.refetch();
              videosQuery.refetch();
            }}
          />
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={Film}
            title="Nenhuma série ainda"
            description="Crie uma série para agrupar os vídeos da playlist."
            action={
              <Button variant="outline" size="sm" onClick={() => setDialog({ series: null })}>
                Nova série
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ series, videos }) => {
            const sBadge = publishBadge(series.status);
            return (
              <Card key={series.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{series.title}</h2>
                    <Badge variant={sBadge.variant} size="sm">
                      {sBadge.label}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ series })}>
                    <Pencil size={14} />
                    Editar série
                  </Button>
                </div>
                {videos.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">Nenhum vídeo nesta série.</p>
                ) : (
                  videos.map((v, index) => {
                    const pBadge = publishBadge(v.status);
                    const sb = processingBadge(v);
                    const to = kbVideoEditPath(v.id);
                    return (
                      <div
                        key={v.id}
                        onClick={() => navigate(to)}
                        className={cn(
                          '-mx-5 grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-secondary/30',
                          v.status === 'draft' && 'opacity-70',
                        )}
                      >
                        <div className="aspect-video w-16 overflow-hidden rounded-md bg-secondary">
                          {v.thumbnail_url && (
                            <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <RowLink to={to} className="block truncate text-sm">
                            {v.title}
                          </RowLink>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">{formatDuration(v.duration_seconds)}</span>
                            <Badge variant={pBadge.variant} size="sm">
                              {pBadge.label}
                            </Badge>
                            <Badge variant={sb.variant} size="sm">
                              {sb.label}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Mover ${v.title} para cima`}
                            disabled={index === 0 || reorderMut.isPending}
                            onClick={() => move(videos, index, -1)}
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Mover ${v.title} para baixo`}
                            disabled={index === videos.length - 1 || reorderMut.isPending}
                            onClick={() => move(videos, index, 1)}
                          >
                            <ArrowDown size={14} />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </Card>
            );
          })}
        </div>
      )}

      {dialog && <SeriesDialog series={dialog.series} onClose={() => setDialog(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Routes, nav, hex guard**

`apps/admin/src/router.tsx`, after the `kb-articles/:id/edit` entry:

```tsx
      {
        path: 'kb-videos',
        lazy: async () => ({ Component: (await import('./pages/KbVideosPage')).default }),
      },
      {
        path: 'kb-videos/new',
        lazy: async () => ({ Component: (await import('./pages/KbVideoEditorPage')).default }),
      },
      {
        path: 'kb-videos/:id/edit',
        lazy: async () => ({ Component: (await import('./pages/KbVideoEditorPage')).default }),
      },
```

Task 9 creates `KbVideoEditorPage.tsx`. If you commit this task first, create a placeholder so `tsc` passes, and Task 9 replaces it:

```tsx
// apps/admin/src/pages/KbVideoEditorPage.tsx (placeholder; replaced in Task 9)
export default function KbVideoEditorPage() {
  return null;
}
```

`apps/admin/src/layouts/AdminLayout.tsx`: add `Film` to the lucide import and the nav item after `Artigos`:

```ts
  { to: '/admin/kb-videos', icon: Film, label: 'Vídeos' },
```

`apps/admin/src/__tests__/no-hex-literals.test.ts`: add to `FILES`:

```ts
  'pages/KbVideosPage.tsx',
  'pages/KbVideoEditorPage.tsx',
  'pages/kb-videos/SeriesDialog.tsx',
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbVideosPage.test.tsx apps/admin/src/__tests__/no-hex-literals.test.ts test/route-lazy-contract.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): página Vídeos com séries, ordem e status de processamento"
```

---

### Task 9: Admin video editor with upload

**Files:**
- Create (replace placeholder): `apps/admin/src/pages/KbVideoEditorPage.tsx`
- Test: `apps/admin/src/pages/__tests__/KbVideoEditorPage.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`getKbVideo`, `upsertKbVideo`, `deleteKbVideo`, `listKbVideoSeries`, `listKbArticles`, `uploadKbVideo`, `validateVideoFile`, `processingBadge`, `formatDuration`, keys), Task 8 routes.

- [ ] **Step 1: Write the failing test**

`apps/admin/src/pages/__tests__/KbVideoEditorPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  getKbVideo: vi.fn(),
  upsertKbVideo: vi.fn(),
  deleteKbVideo: vi.fn(),
  listKbVideoSeries: vi.fn(),
  listKbArticles: vi.fn(),
}));
vi.mock('../../lib/stream-upload', async (orig) => ({
  ...(await orig<typeof import('../../lib/stream-upload')>()),
  uploadKbVideo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { getKbVideo, listKbArticles, listKbVideoSeries, upsertKbVideo } from '../../lib/api';
import { uploadKbVideo } from '../../lib/stream-upload';
import KbVideoEditorPage from '../KbVideoEditorPage';

const video = {
  id: 7, series_id: 's1', title: 'Primeiro acesso', slug: 'primeiro-acesso', description: null, article_id: null,
  display_order: 10, status: 'draft', stream_uid: 'u1', stream_status: 'pending', stream_upload_expires_at: null,
  duration_seconds: null, hls_url: null, thumbnail_url: null, created_at: '', updated_at: '',
};

beforeEach(() => {
  vi.mocked(listKbVideoSeries).mockResolvedValue({
    series: [{ id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1, status: 'published', created_at: '', updated_at: '' }],
  } as never);
  vi.mocked(listKbArticles).mockResolvedValue({ articles: [] } as never);
  vi.mocked(getKbVideo).mockResolvedValue({ video } as never);
  vi.mocked(upsertKbVideo).mockResolvedValue({ video } as never);
  vi.mocked(uploadKbVideo).mockResolvedValue(video as never);
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/kb-videos/new" element={<KbVideoEditorPage />} />
          <Route path="/admin/kb-videos/:id/edit" element={<KbVideoEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideoEditorPage', () => {
  it('cannot publish a video that is still processing', async () => {
    renderAt('/admin/kb-videos/7/edit');
    expect(await screen.findByDisplayValue('Primeiro acesso')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Publicado' })).toBeDisabled();
    expect(screen.getByText(/Só é possível publicar/)).toBeInTheDocument();
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
  });

  it('allows publishing once the video is ready', async () => {
    vi.mocked(getKbVideo).mockResolvedValue({
      video: { ...video, stream_status: 'ready', hls_url: 'https://h/u1.m3u8', duration_seconds: 65 },
    } as never);
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    expect(screen.getByRole('option', { name: 'Publicado' })).not.toBeDisabled();
  });

  it('asks to save first on a new video (no file field yet)', async () => {
    renderAt('/admin/kb-videos/new');
    expect(await screen.findByText(/Salve o vídeo para enviar o arquivo/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo de vídeo')).toBeNull();
  });

  it('uploads a chosen file for an existing video', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    const input = screen.getByLabelText('Arquivo de vídeo');
    const file = new File(['x'], 'tutorial.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadKbVideo).toHaveBeenCalledWith(7, file, expect.any(Object)));
  });

  it('saves the metadata with the series and order', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }));
    await waitFor(() =>
      expect(upsertKbVideo).toHaveBeenCalledWith(
        expect.objectContaining({ video_id: 7, series_id: 's1', display_order: 10, status: 'draft' }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbVideoEditorPage.test.tsx`
Expected: FAIL (placeholder renders nothing).

- [ ] **Step 3: Implement**

`apps/admin/src/pages/KbVideoEditorPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, Trash2, Upload, X } from 'lucide-react';
import {
  deleteKbVideo,
  getKbVideo,
  listKbArticles,
  listKbVideoSeries,
  upsertKbVideo,
  type AdminApiError,
} from '../lib/api';
import {
  formatDuration,
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  kbVideoKey,
  processingBadge,
} from '../lib/kb-video-status';
import { kbVideoEditPath, kbVideosPath } from '../lib/routes';
import { slugify } from '../lib/slugify';
import { uploadKbVideo, validateVideoFile } from '../lib/stream-upload';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

const FIELD =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';
const RESERVED_SLUGS = ['novo', 'editar', 'video'];
const PENDING_POLL_MS = 10_000;

export default function KbVideoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parsedId = id ? parseInt(id, 10) : NaN;
  const isEdit = !!id;
  const videoId = Number.isNaN(parsedId) ? null : parsedId;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [articleId, setArticleId] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoQuery = useQuery({
    queryKey: kbVideoKey(videoId),
    queryFn: () => getKbVideo(videoId!),
    enabled: videoId !== null,
    refetchInterval: (query) => {
      const v = query.state.data?.video;
      return v && v.stream_status === 'pending' && v.stream_uid && !abortRef.current ? PENDING_POLL_MS : false;
    },
  });
  const video = videoQuery.data?.video;

  const { data: seriesData } = useQuery({ queryKey: KB_VIDEO_SERIES_KEY, queryFn: listKbVideoSeries });
  const { data: articlesData } = useQuery({
    queryKey: ['admin', 'kb-articles', 'published', ''],
    queryFn: () => listKbArticles({ status: 'published' }),
  });

  useEffect(() => {
    if (!video) return;
    setTitle(video.title);
    setSlug(video.slug);
    setDescription(video.description ?? '');
    setSeriesId(video.series_id);
    setArticleId(video.article_id ?? '');
    setDisplayOrder(String(video.display_order));
    setStatus(video.status);
  }, [video]);

  useEffect(() => {
    if (!isEdit && title) setSlug(slugify(title));
  }, [title, isEdit]);

  useEffect(() => {
    if (!isEdit && !seriesId && seriesData?.series[0]) setSeriesId(seriesData.series[0].id);
  }, [isEdit, seriesId, seriesData]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY });
    qc.invalidateQueries({ queryKey: kbVideoKey(videoId) });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      upsertKbVideo({
        ...(video ? { video_id: video.id } : {}),
        title,
        slug,
        description: description || null,
        series_id: seriesId,
        article_id: articleId || null,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status,
      }),
    onSuccess: (data) => {
      invalidate();
      toast.success(isEdit ? 'Vídeo atualizado' : 'Vídeo criado. Agora envie o arquivo.');
      if (!isEdit && data.video) navigate(kbVideoEditPath(data.video.id), { replace: true });
    },
    onError: (err: AdminApiError) =>
      toast.error(err.status === 409 ? 'Já existe um vídeo com esse slug.' : err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteKbVideo(video!.id),
    onSuccess: () => {
      invalidate();
      toast.success('Vídeo excluído');
      navigate(kbVideosPath(), { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleFile = async (file: File) => {
    if (!video) return;
    const problem = validateVideoFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      await uploadKbVideo(video.id, file, { onProgress: setProgress, signal: controller.signal });
      toast.success('Vídeo enviado. O processamento leva alguns minutos.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast('Envio cancelado');
      else toast.error('Não foi possível enviar o vídeo. Tente novamente.');
    } finally {
      abortRef.current = null;
      setProgress(null);
      invalidate();
    }
  };

  const slugError =
    slug &&
    (RESERVED_SLUGS.includes(slug)
      ? 'Slug reservado'
      : !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
        ? 'Apenas letras minúsculas, números e hifens'
        : null);
  const canPublish = !!video && video.stream_status === 'ready' && !!video.hls_url;
  const uploading = progress !== null;

  if (isEdit && videoId === null) {
    return <p className="py-8 text-sm text-dim-foreground">Vídeo não encontrado.</p>;
  }
  if (isEdit && videoQuery.isLoading) {
    return <p className="py-8 text-sm text-dim-foreground">Carregando…</p>;
  }
  if (isEdit && !video) {
    return <p className="py-8 text-sm text-dim-foreground">Vídeo não encontrado.</p>;
  }

  const badge = video ? processingBadge(video) : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate(kbVideosPath())}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Vídeos
        </button>
        <div className="flex gap-2">
          {video && (
            <Button
              variant="outline"
              size="sm"
              disabled={deleteMut.isPending || uploading}
              onClick={() => {
                if (confirm('Excluir este vídeo? O arquivo também é removido do Stream.')) deleteMut.mutate();
              }}
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title || !slug || !seriesId || !!slugError}
          >
            <Save size={14} /> {saveMut.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      <h1 className="mb-6 text-2xl font-semibold">{isEdit ? 'Editar vídeo' : 'Novo vídeo'}</h1>

      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="video-title" className={LABEL}>Título</label>
          <input id="video-title" className={FIELD} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="video-slug" className={LABEL}>Slug</label>
          <input id="video-slug" className={FIELD} value={slug} onChange={(e) => setSlug(e.target.value)} />
          {slugError && <p className="mt-1 text-xs text-destructive">{slugError}</p>}
        </div>
        <div>
          <label htmlFor="video-description" className={LABEL}>Descrição</label>
          <textarea
            id="video-description"
            className={FIELD}
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="video-series" className={LABEL}>Série</label>
            <select id="video-series" className={FIELD} value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              {(seriesData?.series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="video-article" className={LABEL}>Artigo relacionado</label>
            <select id="video-article" className={FIELD} value={articleId} onChange={(e) => setArticleId(e.target.value)}>
              <option value="">Nenhum</option>
              {(articlesData?.articles ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="video-order" className={LABEL}>Ordem</label>
            <input
              id="video-order"
              type="number"
              min={0}
              max={10000}
              className={FIELD}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="video-status" className={LABEL}>Status</label>
            <select
              id="video-status"
              className={FIELD}
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
            >
              <option value="draft">Rascunho</option>
              <option value="published" disabled={!canPublish}>
                Publicado
              </option>
            </select>
            {!canPublish && (
              <p className="mt-1 text-xs text-muted-foreground">
                Só é possível publicar depois que o vídeo terminar de processar.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className={LABEL}>Arquivo</p>
          {!video ? (
            <p className="text-sm text-muted-foreground">Salve o vídeo para enviar o arquivo.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {video.thumbnail_url && (
                  <img src={video.thumbnail_url} alt="" className="aspect-video w-32 rounded-md object-cover" />
                )}
                {badge && (
                  <Badge variant={badge.variant} size="sm">
                    {uploading ? `Enviando ${Math.round((progress ?? 0) * 100)}%` : badge.label}
                  </Badge>
                )}
                {video.duration_seconds != null && (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDuration(video.duration_seconds)}
                  </span>
                )}
              </div>
              {uploading && (
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                </div>
              )}
              <input
                ref={fileInputRef}
                id="video-file"
                aria-label="Arquivo de vídeo"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                {uploading ? (
                  <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                    <X size={14} /> Cancelar envio
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    {videoQuery.isFetching ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {video.stream_uid ? 'Substituir arquivo' : 'Enviar arquivo'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">MP4 ou MOV, até 200 MB e 15 minutos.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbVideoEditorPage.test.tsx apps/admin/src/__tests__/no-hex-literals.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/KbVideoEditorPage.tsx apps/admin/src/pages/__tests__/KbVideoEditorPage.test.tsx
git commit -m "feat(admin): editor de vídeo tutorial com envio, cancelamento e publicação"
```

---

### Task 10: CRM store for videos and progress

**Files:**
- Create: `apps/crm/src/store/kbVideos.ts`
- Test: `apps/crm/src/store/__tests__/kbVideos.test.ts`

**Interfaces:**
- Consumes: Task 1 schema/RPC.
- Produces:
  - `interface KbVideoArticleRef { slug: string; title: string }`
  - `interface KbVideo { id: number; series_id: string; title: string; slug: string; description: string | null; display_order: number; duration_seconds: number | null; hls_url: string; thumbnail_url: string | null; article: KbVideoArticleRef | null }`
  - `interface KbVideoSeries { id: string; title: string; slug: string; description: string | null; display_order: number; videos: KbVideo[] }`
  - `interface KbVideoProgress { video_id: number; position_seconds: number; completed_at: string | null }`
  - `getPublishedVideoSeries(): Promise<KbVideoSeries[]>` (drops series with no visible video; videos sorted)
  - `getMyVideoProgress(): Promise<KbVideoProgress[]>`
  - `saveVideoProgress(videoId: number, positionSeconds: number, completed: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test**

`apps/crm/src/store/__tests__/kbVideos.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock('../core', () => ({ supabase: { from: fromMock, rpc: rpcMock } }));

import { getMyVideoProgress, getPublishedVideoSeries, saveVideoProgress } from '../kbVideos';

function selectChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

const video = (id: number, display_order: number) => ({
  id, series_id: 's1', title: `V${id}`, slug: `v${id}`, description: null, display_order,
  duration_seconds: 60, hls_url: `https://h/${id}.m3u8`, thumbnail_url: null, article: null,
});

describe('store/kbVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops series without a visible video and sorts each series by display_order', async () => {
    fromMock.mockReturnValue(
      selectChain({
        data: [
          { id: 's1', title: 'A', slug: 'a', description: null, display_order: 1, videos: [video(2, 20), video(1, 10)] },
          { id: 's2', title: 'Vazia', slug: 'vazia', description: null, display_order: 2, videos: [] },
          { id: 's3', title: 'Nula', slug: 'nula', description: null, display_order: 3, videos: null },
        ],
        error: null,
      }),
    );

    const series = await getPublishedVideoSeries();

    expect(fromMock).toHaveBeenCalledWith('kb_video_series');
    expect(series.map((s) => s.id)).toEqual(['s1']);
    expect(series[0].videos.map((v) => v.id)).toEqual([1, 2]);
  });

  it('throws when the series query fails', async () => {
    fromMock.mockReturnValue(selectChain({ data: null, error: { message: 'boom' } }));
    await expect(getPublishedVideoSeries()).rejects.toBeTruthy();
  });

  it('reads only the progress columns it needs', async () => {
    const chain = selectChain({ data: [{ video_id: 1, position_seconds: 12, completed_at: null }], error: null });
    fromMock.mockReturnValue(chain);
    const rows = await getMyVideoProgress();
    expect(fromMock).toHaveBeenCalledWith('kb_video_progress');
    expect(chain.select).toHaveBeenCalledWith('video_id,position_seconds,completed_at');
    expect(rows).toHaveLength(1);
  });

  it('saves progress through the RPC with p_-prefixed params', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await saveVideoProgress(7, 42.5, true);
    expect(rpcMock).toHaveBeenCalledWith('save_kb_video_progress', {
      p_video_id: 7,
      p_position: 42.5,
      p_completed: true,
    });
  });

  it('throws when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(saveVideoProgress(7, 1, false)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/store/__tests__/kbVideos.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/crm/src/store/kbVideos.ts`:

```ts
import { supabase } from './core';

export interface KbVideoArticleRef {
  slug: string;
  title: string;
}

export interface KbVideo {
  id: number;
  series_id: string;
  title: string;
  slug: string;
  description: string | null;
  display_order: number;
  duration_seconds: number | null;
  hls_url: string;
  thumbnail_url: string | null;
  /** Null when there is no related article, or when it went back to draft (hidden by RLS). */
  article: KbVideoArticleRef | null;
}

export interface KbVideoSeries {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  display_order: number;
  videos: KbVideo[];
}

export interface KbVideoProgress {
  video_id: number;
  position_seconds: number;
  completed_at: string | null;
}

// RLS decides visibility: only published series, and inside them only published + ready videos.
const SERIES_SELECT =
  'id,title,slug,description,display_order,' +
  'videos:kb_videos(id,series_id,title,slug,description,display_order,duration_seconds,hls_url,thumbnail_url,' +
  'article:kb_articles!article_id(slug,title))';

/** Published series with at least one visible video, each with its videos in display order.
 * A published series whose videos are all draft or still processing is dropped here, so no
 * consumer ever sees an empty series. */
export async function getPublishedVideoSeries(): Promise<KbVideoSeries[]> {
  const { data, error } = await supabase.from('kb_video_series').select(SERIES_SELECT).order('display_order');
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Omit<KbVideoSeries, 'videos'> & { videos: KbVideo[] | null }>)
    .map((s) => ({
      ...s,
      videos: [...(s.videos ?? [])].sort((a, b) => a.display_order - b.display_order || a.id - b.id),
    }))
    .filter((s) => s.videos.length > 0);
}

export async function getMyVideoProgress(): Promise<KbVideoProgress[]> {
  const { data, error } = await supabase.from('kb_video_progress').select('video_id,position_seconds,completed_at');
  if (error) throw error;
  return (data ?? []) as KbVideoProgress[];
}

export async function saveVideoProgress(videoId: number, positionSeconds: number, completed: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_kb_video_progress', {
    p_video_id: videoId,
    p_position: positionSeconds,
    p_completed: completed,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/crm/src/store/__tests__/kbVideos.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/kbVideos.ts apps/crm/src/store/__tests__/kbVideos.test.ts
git commit -m "feat(crm): store de vídeos tutoriais e progresso"
```

---

### Task 11: CRM playlist logic and query hooks

**Files:**
- Create: `apps/crm/src/pages/ajuda/videos/playlist.ts`, `apps/crm/src/pages/ajuda/videos/useKbVideos.ts`
- Test: `apps/crm/src/pages/ajuda/videos/__tests__/playlist.test.ts`

**Interfaces:**
- Consumes: Task 10 types and functions.
- Produces (from `playlist.ts`):
  - `type ProgressMap = ReadonlyMap<number, KbVideoProgress>`
  - `interface PlaylistSelection { seriesId: string; videoId: number }`
  - `interface VideoSearchHit { video: KbVideo; seriesTitle: string }`
  - `toProgressMap(rows)`, `isCompleted(progress, videoId)`, `completedCount(series, progress)`, `allCompleted(series[], progress)`, `firstUnwatched(series, progress)`, `pickInitial(series[], progress, requestedSlug?)`, `resolveSelection(series[], selection)` → `{ series, video } | null`, `nextInSeries(series, videoId)`, `reachedCompletion(currentTime, duration)`, `resumePosition(progress, videoId)`, `mergeProgress(rows, videoId, position, completed, nowIso)`, `formatDuration(seconds)`, `filterVideos(series[], search)`
- Produces (from `useKbVideos.ts`): `KB_VIDEO_SERIES_KEY`, `KB_VIDEO_PROGRESS_KEY`, `useKbVideoSeries()`, `useVideoProgress()` → `{ progress: ProgressMap; save(videoId, position, completed): void; isLoading: boolean }`

- [ ] **Step 1: Write the failing test**

`apps/crm/src/pages/ajuda/videos/__tests__/playlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import {
  allCompleted,
  completedCount,
  filterVideos,
  formatDuration,
  mergeProgress,
  nextInSeries,
  pickInitial,
  reachedCompletion,
  resolveSelection,
  resumePosition,
  toProgressMap,
} from '../playlist';

function v(id: number, seriesId: string, title = `Vídeo ${id}`): KbVideo {
  return {
    id, series_id: seriesId, title, slug: `video-${id}`, description: null, display_order: id,
    duration_seconds: 60, hls_url: `https://h/${id}.m3u8`, thumbnail_url: null, article: null,
  };
}

const series: KbVideoSeries[] = [
  { id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1, videos: [v(1, 's1', 'Primeiro acesso'), v(2, 's1', 'Relatório mensal')] },
  { id: 's2', title: 'Relatórios', slug: 'rel', description: null, display_order: 2, videos: [v(3, 's2')] },
];
const done = (id: number) => ({ video_id: id, position_seconds: 60, completed_at: '2026-09-28T10:00:00Z' });

describe('pickInitial', () => {
  it('starts at the first unwatched video of the first unfinished series', () => {
    expect(pickInitial(series, toProgressMap([]))).toEqual({ seriesId: 's1', videoId: 1 });
    expect(pickInitial(series, toProgressMap([done(1)]))).toEqual({ seriesId: 's1', videoId: 2 });
    expect(pickInitial(series, toProgressMap([done(1), done(2)]))).toEqual({ seriesId: 's2', videoId: 3 });
  });
  it('honours a requested slug first', () => {
    expect(pickInitial(series, toProgressMap([]), 'video-3')).toEqual({ seriesId: 's2', videoId: 3 });
  });
  it('falls back to the first video when everything was watched, and to null with no series', () => {
    expect(pickInitial(series, toProgressMap([done(1), done(2), done(3)]))).toEqual({ seriesId: 's1', videoId: 1 });
    expect(pickInitial([], toProgressMap([]))).toBeNull();
  });
});

describe('completion', () => {
  it('counts completed videos per series and across all series', () => {
    const p = toProgressMap([done(1)]);
    expect(completedCount(series[0], p)).toBe(1);
    expect(allCompleted(series, p)).toBe(false);
    expect(allCompleted(series, toProgressMap([done(1), done(2), done(3)]))).toBe(true);
  });
  it('an empty list is never "all completed"', () => {
    expect(allCompleted([], toProgressMap([]))).toBe(false);
  });
  it('reaches completion at 90% of a known duration', () => {
    expect(reachedCompletion(89, 100)).toBe(false);
    expect(reachedCompletion(90, 100)).toBe(true);
    expect(reachedCompletion(10, NaN)).toBe(false);
    expect(reachedCompletion(10, 0)).toBe(false);
  });
});

describe('navigation', () => {
  it('resolves a selection and finds the next video in the same series', () => {
    expect(resolveSelection(series, { seriesId: 's1', videoId: 2 })?.video.id).toBe(2);
    expect(resolveSelection(series, { seriesId: 's1', videoId: 99 })).toBeNull();
    expect(nextInSeries(series[0], 1)?.id).toBe(2);
    expect(nextInSeries(series[0], 2)).toBeNull();
  });
});

describe('progress', () => {
  it('resumes only an unfinished video with a saved position', () => {
    expect(resumePosition(toProgressMap([{ video_id: 1, position_seconds: 20, completed_at: null }]), 1)).toBe(20);
    expect(resumePosition(toProgressMap([done(1)]), 1)).toBeNull();
    expect(resumePosition(toProgressMap([]), 1)).toBeNull();
  });
  it('merges a save optimistically without ever clearing completed_at', () => {
    const rows = mergeProgress([done(1)], 1, 5, false, '2026-09-28T12:00:00Z');
    expect(rows).toEqual([{ video_id: 1, position_seconds: 5, completed_at: '2026-09-28T10:00:00Z' }]);
    const added = mergeProgress([], 2, 54, true, '2026-09-28T12:00:00Z');
    expect(added).toEqual([{ video_id: 2, position_seconds: 54, completed_at: '2026-09-28T12:00:00Z' }]);
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(null)).toBe('');
  });
});

describe('filterVideos', () => {
  it('matches titles ignoring accents and reports the series', () => {
    const hits = filterVideos(series, 'relatorio');
    expect(hits.map((h) => h.video.id)).toEqual([2]);
    expect(hits[0].seriesTitle).toBe('Primeiros passos');
    expect(filterVideos(series, '  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos/__tests__/playlist.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/crm/src/pages/ajuda/videos/playlist.ts`:

```ts
import { normalize } from '@/lib/normalizeText';
import type { KbVideo, KbVideoProgress, KbVideoSeries } from '@/store/kbVideos';

export type ProgressMap = ReadonlyMap<number, KbVideoProgress>;

export interface PlaylistSelection {
  seriesId: string;
  videoId: number;
}

export interface VideoSearchHit {
  video: KbVideo;
  seriesTitle: string;
}

/** A video counts as watched from this fraction of its duration on. */
export const COMPLETION_RATIO = 0.9;

export function toProgressMap(rows: KbVideoProgress[]): ProgressMap {
  return new Map(rows.map((r) => [r.video_id, r]));
}

export function isCompleted(progress: ProgressMap, videoId: number): boolean {
  return !!progress.get(videoId)?.completed_at;
}

export function completedCount(series: KbVideoSeries, progress: ProgressMap): number {
  return series.videos.filter((v) => isCompleted(progress, v.id)).length;
}

export function allCompleted(series: KbVideoSeries[], progress: ProgressMap): boolean {
  const videos = series.flatMap((s) => s.videos);
  return videos.length > 0 && videos.every((v) => isCompleted(progress, v.id));
}

export function firstUnwatched(series: KbVideoSeries, progress: ProgressMap): KbVideo | null {
  return series.videos.find((v) => !isCompleted(progress, v.id)) ?? null;
}

export function pickInitial(
  series: KbVideoSeries[],
  progress: ProgressMap,
  requestedSlug?: string | null,
): PlaylistSelection | null {
  if (requestedSlug) {
    for (const s of series) {
      const hit = s.videos.find((v) => v.slug === requestedSlug);
      if (hit) return { seriesId: s.id, videoId: hit.id };
    }
  }
  for (const s of series) {
    const next = firstUnwatched(s, progress);
    if (next) return { seriesId: s.id, videoId: next.id };
  }
  const first = series[0];
  return first && first.videos[0] ? { seriesId: first.id, videoId: first.videos[0].id } : null;
}

export function resolveSelection(
  series: KbVideoSeries[],
  selection: PlaylistSelection | null,
): { series: KbVideoSeries; video: KbVideo } | null {
  if (!selection) return null;
  const s = series.find((x) => x.id === selection.seriesId);
  const video = s?.videos.find((x) => x.id === selection.videoId);
  return s && video ? { series: s, video } : null;
}

export function nextInSeries(series: KbVideoSeries, videoId: number): KbVideo | null {
  const index = series.videos.findIndex((v) => v.id === videoId);
  return index >= 0 ? (series.videos[index + 1] ?? null) : null;
}

export function reachedCompletion(currentTime: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && currentTime >= duration * COMPLETION_RATIO;
}

/** Saved position to resume from, or null for a finished or never-started video. */
export function resumePosition(progress: ProgressMap, videoId: number): number | null {
  const p = progress.get(videoId);
  if (!p || p.completed_at || !(p.position_seconds > 0)) return null;
  return p.position_seconds;
}

/** Optimistic cache update mirroring save_kb_video_progress: last position wins, completed_at
 * is never cleared. */
export function mergeProgress(
  rows: KbVideoProgress[],
  videoId: number,
  position: number,
  completed: boolean,
  nowIso: string,
): KbVideoProgress[] {
  const existing = rows.find((r) => r.video_id === videoId);
  const next: KbVideoProgress = {
    video_id: videoId,
    position_seconds: Math.max(0, position),
    completed_at: existing?.completed_at ?? (completed ? nowIso : null),
  };
  return existing ? rows.map((r) => (r.video_id === videoId ? next : r)) : [...rows, next];
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Busca da Central de Ajuda sobre os vídeos: título ou descrição, sem diferenciar acentos. */
export function filterVideos(series: KbVideoSeries[], search: string): VideoSearchHit[] {
  const q = normalize(search.trim());
  if (!q) return [];
  return series.flatMap((s) =>
    s.videos
      .filter((v) => normalize(v.title).includes(q) || normalize(v.description ?? '').includes(q))
      .map((video) => ({ video, seriesTitle: s.title })),
  );
}
```

`apps/crm/src/pages/ajuda/videos/useKbVideos.ts`:

```ts
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyVideoProgress,
  getPublishedVideoSeries,
  saveVideoProgress,
  type KbVideoProgress,
} from '@/store/kbVideos';
import { mergeProgress, toProgressMap, type ProgressMap } from './playlist';

export const KB_VIDEO_SERIES_KEY = ['kb-video-series'] as const;
export const KB_VIDEO_PROGRESS_KEY = ['kb-video-progress'] as const;

export function useKbVideoSeries() {
  return useQuery({
    queryKey: KB_VIDEO_SERIES_KEY,
    queryFn: getPublishedVideoSeries,
    staleTime: 5 * 60_000,
  });
}

export function useVideoProgress(): {
  progress: ProgressMap;
  save: (videoId: number, position: number, completed: boolean) => void;
  isLoading: boolean;
} {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KB_VIDEO_PROGRESS_KEY, queryFn: getMyVideoProgress });
  const progress = useMemo(() => toProgressMap(query.data ?? []), [query.data]);

  // Fire-and-forget: a failed save never interrupts the video nor shows a toast (spec). The
  // optimistic cache write keeps the rail's checkmarks in step with what the user just watched.
  const save = useCallback(
    (videoId: number, position: number, completed: boolean) => {
      qc.setQueryData<KbVideoProgress[]>(KB_VIDEO_PROGRESS_KEY, (old = []) =>
        mergeProgress(old, videoId, position, completed, new Date().toISOString()),
      );
      saveVideoProgress(videoId, position, completed).catch((err) =>
        console.error('[kb-video-progress] save failed', err),
      );
    },
    [qc],
  );

  return { progress, save, isLoading: query.isLoading };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos/__tests__/playlist.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/ajuda/videos
git commit -m "feat(crm): lógica da playlist de vídeos e hooks de consulta"
```

---

### Task 12: CRM playlist block (player, rail, overlays)

**Files:**
- Create: `apps/crm/src/pages/ajuda/videos/NextUpOverlay.tsx`, `VideoRail.tsx`, `VideoStage.tsx`, `VideoPlaylistBlock.tsx`
- Test: `apps/crm/src/pages/ajuda/videos/__tests__/NextUpOverlay.test.tsx`, `apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx`

**Interfaces:**
- Consumes: Task 11.
- Produces: `VideoPlaylistBlock(props: { series: KbVideoSeries[]; progress: ProgressMap; onSaveProgress: (videoId: number, position: number, completed: boolean) => void; requestedSlug?: string | null; collapsible?: boolean; onVideoChange?: (video: KbVideo) => void })`.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/pages/ajuda/videos/__tests__/NextUpOverlay.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextUpOverlay } from '../NextUpOverlay';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('NextUpOverlay', () => {
  it('plays the next video after a 5 second countdown', () => {
    const onGo = vi.fn();
    render(<NextUpOverlay title="Equipe" onGo={onGo} onCancel={vi.fn()} />);
    expect(screen.getByText('Próximo: Equipe')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    expect(onGo).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it('cancel stops the countdown', () => {
    const onCancel = vi.fn();
    render(<NextUpOverlay title="Equipe" onGo={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

`apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { VideoPlaylistBlock } from '../VideoPlaylistBlock';
import { toProgressMap } from '../playlist';

function v(id: number, title: string, extra: Partial<KbVideo> = {}): KbVideo {
  return {
    id, series_id: 's1', title, slug: `video-${id}`, description: null, display_order: id,
    duration_seconds: 100, hls_url: `https://h/${id}.m3u8`, thumbnail_url: null, article: null, ...extra,
  };
}

const series: KbVideoSeries[] = [
  {
    id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1,
    videos: [
      v(1, 'Primeiro acesso'),
      v(2, 'Convidando a equipe', { article: { slug: 'convidar-equipe', title: 'Convidar' } }),
      v(3, 'Primeiro cliente'),
    ],
  },
];
const done = (id: number) => ({ video_id: id, position_seconds: 100, completed_at: '2026-09-28T10:00:00Z' });

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (t: string) => CanPlayTypeResult;
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderBlock(props: Partial<Parameters<typeof VideoPlaylistBlock>[0]> = {}) {
  const onSaveProgress = vi.fn();
  const utils = render(
    <MemoryRouter>
      <VideoPlaylistBlock
        series={series}
        progress={toProgressMap([done(1)])}
        onSaveProgress={onSaveProgress}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onSaveProgress };
}

function videoEl(container: HTMLElement) {
  return container.querySelector('video') as HTMLVideoElement;
}

function setMedia(el: HTMLVideoElement, currentTime: number, duration = 100) {
  Object.defineProperty(el, 'currentTime', { configurable: true, writable: true, value: currentTime });
  Object.defineProperty(el, 'duration', { configurable: true, value: duration });
}

describe('VideoPlaylistBlock', () => {
  it('opens on the first unwatched video and shows series progress', () => {
    renderBlock();
    expect(screen.getByRole('heading', { name: 'Convidando a equipe' })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Convidando a equipe/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /Ler artigo/ })).toHaveAttribute('href', '/ajuda/convidar-equipe');
  });

  it('switches video from the rail', () => {
    renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /Primeiro cliente/ }));
    expect(screen.getByRole('heading', { name: 'Primeiro cliente' })).toBeInTheDocument();
  });

  it('marks a video complete once at 90%', () => {
    const { container, onSaveProgress } = renderBlock();
    const el = videoEl(container);
    setMedia(el, 91);
    fireEvent.timeUpdate(el);
    setMedia(el, 95);
    fireEvent.timeUpdate(el);
    expect(onSaveProgress.mock.calls.filter((c) => c[2] === true)).toEqual([[2, 91, true]]);
  });

  it('resumes from the saved position', () => {
    const { container } = renderBlock({
      progress: toProgressMap([done(1), { video_id: 2, position_seconds: 42, completed_at: null }]),
    });
    const el = videoEl(container);
    setMedia(el, 0);
    fireEvent.loadedMetadata(el);
    expect(el.currentTime).toBe(42);
  });

  it('offers the next video when one ends', () => {
    const { container } = renderBlock();
    const el = videoEl(container);
    setMedia(el, 100);
    fireEvent.ended(el);
    expect(screen.getByText('Próximo: Primeiro cliente')).toBeInTheDocument();
  });

  it('collapses when everything was watched and expands on "Rever"', () => {
    renderBlock({ collapsible: true, progress: toProgressMap([done(1), done(2), done(3)]) });
    expect(screen.queryByRole('heading', { name: 'Primeiro acesso' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rever' }));
    expect(screen.getByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
  });

  it('shows a retry state when the video cannot load', () => {
    const { container } = renderBlock();
    fireEvent.error(videoEl(container)); // native-hls → fallback
    fireEvent.error(videoEl(container)); // fallback fails → fatal
    expect(screen.getByText('Não foi possível carregar este vídeo.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(videoEl(container)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos/__tests__/NextUpOverlay.test.tsx apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`apps/crm/src/pages/ajuda/videos/NextUpOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const NEXT_UP_SECONDS = 5;

interface NextUpOverlayProps {
  title: string;
  onGo: () => void;
  onCancel: () => void;
}

export function NextUpOverlay({ title, onGo, onCancel }: NextUpOverlayProps) {
  const [remaining, setRemaining] = useState(NEXT_UP_SECONDS);
  const onGoRef = useRef(onGo);
  useEffect(() => {
    onGoRef.current = onGo;
  });

  useEffect(() => {
    if (remaining <= 0) {
      onGoRef.current();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-white"
    >
      <p className="text-[0.75rem] uppercase tracking-wider text-white/70">Em {Math.max(remaining, 0)}s</p>
      <p className="text-[1.05rem] font-semibold">Próximo: {title}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onGo}>
          Assistir agora
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
```

`apps/crm/src/pages/ajuda/videos/VideoRail.tsx`:

```tsx
import { CheckCircle2, Circle, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { KbVideoSeries } from '@/store/kbVideos';
import { completedCount, formatDuration, isCompleted, type ProgressMap } from './playlist';

interface VideoRailProps {
  series: KbVideoSeries[];
  currentSeries: KbVideoSeries;
  currentVideoId: number;
  progress: ProgressMap;
  onSelectSeries: (seriesId: string) => void;
  onSelectVideo: (videoId: number) => void;
}

export function VideoRail({
  series,
  currentSeries,
  currentVideoId,
  progress,
  onSelectSeries,
  onSelectVideo,
}: VideoRailProps) {
  const done = completedCount(currentSeries, progress);
  const total = currentSeries.videos.length;

  return (
    <div className="flex min-w-0 flex-col gap-3 self-start rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="flex items-center justify-between gap-3">
        {series.length > 1 ? (
          <Select value={currentSeries.id} onValueChange={onSelectSeries}>
            <SelectTrigger aria-label="Série de vídeos" className="h-9 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {series.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="min-w-0 truncate text-[0.95rem] font-semibold text-[var(--text-main)]">{currentSeries.title}</p>
        )}
        <span className="shrink-0 text-[0.78rem] tabular-nums text-[var(--text-light)]">
          {done} de {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Progresso da série"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]"
      >
        <div
          className="h-full rounded-full bg-[var(--primary-color)] transition-[width]"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <ol className="flex flex-col gap-0.5">
        {currentSeries.videos.map((video, index) => {
          const isCurrent = video.id === currentVideoId;
          const completed = isCompleted(progress, video.id);
          const Icon = isCurrent ? PlayCircle : completed ? CheckCircle2 : Circle;
          return (
            <li key={video.id}>
              <button
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onSelectVideo(video.id)}
                className={cn(
                  'grid w-full grid-cols-[18px_20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left text-[0.82rem] transition-colors',
                  isCurrent
                    ? 'bg-[rgba(var(--primary-rgb),0.14)] font-semibold text-[var(--text-main)]'
                    : 'text-[var(--text-light)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'h-4 w-4',
                    isCurrent ? 'text-[var(--text-main)]' : completed ? 'text-[var(--success)]' : 'opacity-50',
                  )}
                />
                <span className="tabular-nums">{index + 1}</span>
                <span className="truncate">{video.title}</span>
                <span className="tabular-nums text-[0.75rem]">{formatDuration(video.duration_seconds)}</span>
                {completed && <span className="sr-only">(assistido)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

`apps/crm/src/pages/ajuda/videos/VideoStage.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { NextUpOverlay } from './NextUpOverlay';
import {
  isCompleted,
  nextInSeries,
  reachedCompletion,
  resumePosition,
  type ProgressMap,
} from './playlist';

/** How often playback position is persisted while the video plays. */
const SAVE_INTERVAL_MS = 10_000;

interface VideoStageProps {
  video: KbVideo;
  series: KbVideoSeries;
  progress: ProgressMap;
  autoPlay: boolean;
  onSaveProgress: (videoId: number, position: number, completed: boolean) => void;
  onPlayNext: (next: KbVideo) => void;
}

/** Player + metadata for ONE video. The parent keys it by video id, so every ref below starts
 * fresh per video. */
export function VideoStage({ video, series, progress, autoPlay, onSaveProgress, onPlayNext }: VideoStageProps) {
  const [endState, setEndState] = useState<'playing' | 'next' | 'done'>('playing');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const saveRef = useRef(onSaveProgress);
  useEffect(() => {
    saveRef.current = onSaveProgress;
  });
  const positionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const completedRef = useRef(isCompleted(progress, video.id));
  const resumeRef = useRef(resumePosition(progress, video.id));

  useEffect(() => {
    lastSaveAtRef.current = Date.now();
  }, []);

  const flush = useCallback(() => {
    if (positionRef.current > 0) saveRef.current(video.id, positionRef.current, false);
  }, [video.id]);

  // Save on tab close/navigation away and when this stage unmounts (video switch, leaving /ajuda).
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const next = nextInSeries(series, video.id);

  const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (resume !== null && (!Number.isFinite(el.duration) || resume < el.duration - 1)) {
      el.currentTime = resume;
    }
  };

  const handleTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    positionRef.current = el.currentTime;
    const now = Date.now();
    if (!completedRef.current && reachedCompletion(el.currentTime, el.duration)) {
      completedRef.current = true;
      lastSaveAtRef.current = now;
      saveRef.current(video.id, el.currentTime, true);
      return;
    }
    if (now - lastSaveAtRef.current >= SAVE_INTERVAL_MS) {
      lastSaveAtRef.current = now;
      saveRef.current(video.id, el.currentTime, false);
    }
  };

  const handlePause = (e: SyntheticEvent<HTMLVideoElement>) => {
    positionRef.current = e.currentTarget.currentTime;
    if (positionRef.current > 0) {
      lastSaveAtRef.current = Date.now();
      saveRef.current(video.id, positionRef.current, false);
    }
  };

  const handleEnded = (e: SyntheticEvent<HTMLVideoElement>) => {
    positionRef.current = e.currentTarget.currentTime;
    completedRef.current = true;
    saveRef.current(video.id, positionRef.current, true);
    setEndState(next ? 'next' : 'done');
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-2xl bg-black">
        {failed ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white"
          >
            <p className="text-[0.9rem]">Não foi possível carregar este vídeo.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <VideoPlayer
            key={attempt}
            hlsSrc={video.hls_url}
            src={video.hls_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            autoPlay={autoPlay || attempt > 0}
            className="h-full w-full"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPause={handlePause}
            onEnded={handleEnded}
            onFatalError={() => setFailed(true)}
          />
        )}
        {endState === 'next' && next && (
          <NextUpOverlay title={next.title} onGo={() => onPlayNext(next)} onCancel={() => setEndState('playing')} />
        )}
        {endState === 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-white">
            <p className="text-[1.05rem] font-semibold">Série concluída</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEndState('playing');
                setAttempt((a) => a + 1);
              }}
            >
              Assistir de novo
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-light)]">
          {series.title}
        </p>
        <h2 className="text-[1.15rem] font-bold text-[var(--text-main)] font-[var(--font-heading)]">{video.title}</h2>
        {video.article && (
          <Link
            to={`/ajuda/${video.article.slug}`}
            className="inline-flex items-center gap-1.5 text-[0.82rem] font-medium text-[var(--text-main)] underline-offset-4 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Ler artigo
          </Link>
        )}
        {video.description && (
          <p className="max-w-[65ch] text-[0.85rem] leading-relaxed text-[var(--text-light)]">{video.description}</p>
        )}
      </div>
    </div>
  );
}
```

`apps/crm/src/pages/ajuda/videos/VideoPlaylistBlock.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import {
  allCompleted,
  firstUnwatched,
  pickInitial,
  resolveSelection,
  type PlaylistSelection,
  type ProgressMap,
} from './playlist';
import { VideoRail } from './VideoRail';
import { VideoStage } from './VideoStage';

export interface VideoPlaylistBlockProps {
  /** Only series with at least one visible video (getPublishedVideoSeries guarantees it). */
  series: KbVideoSeries[];
  progress: ProgressMap;
  onSaveProgress: (videoId: number, position: number, completed: boolean) => void;
  requestedSlug?: string | null;
  /** Hero on /ajuda: shrink to a slim bar when everything was already watched. */
  collapsible?: boolean;
  onVideoChange?: (video: KbVideo) => void;
}

export function VideoPlaylistBlock({
  series,
  progress,
  onSaveProgress,
  requestedSlug = null,
  collapsible = false,
  onVideoChange,
}: VideoPlaylistBlockProps) {
  const [selection, setSelection] = useState<PlaylistSelection | null>(() =>
    pickInitial(series, progress, requestedSlug),
  );
  // Decided once at mount: finishing the last video mid-session must not collapse the player.
  const [collapsed, setCollapsed] = useState(() => collapsible && !requestedSlug && allCompleted(series, progress));
  const [autoPlay, setAutoPlay] = useState(false);

  const resolved =
    resolveSelection(series, selection) ?? resolveSelection(series, pickInitial(series, progress, null));

  const onVideoChangeRef = useRef(onVideoChange);
  useEffect(() => {
    onVideoChangeRef.current = onVideoChange;
  });
  const currentVideo = resolved?.video ?? null;
  useEffect(() => {
    if (currentVideo) onVideoChangeRef.current?.(currentVideo);
  }, [currentVideo]);

  if (!resolved) return null;

  const select = (seriesId: string, videoId: number, play: boolean) => {
    setSelection({ seriesId, videoId });
    setAutoPlay(play);
  };

  if (collapsed) {
    return (
      <section
        aria-label="Tutoriais em vídeo"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-3.5"
      >
        <div className="flex items-center gap-3">
          <PlayCircle aria-hidden className="h-5 w-5 text-[var(--text-light)]" />
          <div>
            <p className="text-[0.9rem] font-semibold text-[var(--text-main)]">Tutoriais em vídeo</p>
            <p className="text-[0.78rem] text-[var(--text-light)]">Você já assistiu todos os vídeos.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCollapsed(false)}>
          Rever
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-label="Tutoriais em vídeo"
      className="grid gap-5 min-[901px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
    >
      <VideoStage
        key={resolved.video.id}
        video={resolved.video}
        series={resolved.series}
        progress={progress}
        autoPlay={autoPlay}
        onSaveProgress={onSaveProgress}
        onPlayNext={(next) => select(resolved.series.id, next.id, true)}
      />
      <VideoRail
        series={series}
        currentSeries={resolved.series}
        currentVideoId={resolved.video.id}
        progress={progress}
        onSelectSeries={(seriesId) => {
          const target = series.find((s) => s.id === seriesId);
          if (!target) return;
          const video = firstUnwatched(target, progress) ?? target.videos[0];
          if (video) select(target.id, video.id, false);
        }}
        onSelectVideo={(videoId) => select(resolved.series.id, videoId, false)}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos && npx tsc -p apps/crm/tsconfig.json --noEmit && npx eslint apps/crm/src/pages/ajuda/videos`
Expected: PASS; no lint errors (if `react-hooks` flags the ref-sync effects, keep the effect form, never assign refs during render).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/ajuda/videos
git commit -m "feat(crm): bloco de playlist com player, trilha, próximo vídeo e progresso"
```

---

### Task 13: CRM `/ajuda` hero, search and `/ajuda/video/:slug`

**Files:**
- Create: `apps/crm/src/pages/ajuda/videos/VideoPlaylistHero.tsx`, `apps/crm/src/pages/ajuda/videos/VideoResultCard.tsx`, `apps/crm/src/pages/ajuda/VideoPage.tsx`
- Modify: `apps/crm/src/pages/ajuda/AjudaPage.tsx`, `apps/crm/src/App.tsx:85-87,256-259`
- Test: `apps/crm/src/pages/ajuda/__tests__/AjudaPage.test.tsx`, `apps/crm/src/pages/ajuda/__tests__/VideoPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 10–12.

- [ ] **Step 1: Write the failing tests**

Both test files below define the same `SERIES` fixture:

```tsx
const SERIES = [
  {
    id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1,
    videos: [
      { id: 1, series_id: 's1', title: 'Primeiro acesso', slug: 'primeiro-acesso', description: null, display_order: 1,
        duration_seconds: 65, hls_url: 'https://h/1.m3u8', thumbnail_url: null, article: null },
      { id: 2, series_id: 's1', title: 'Relatório mensal', slug: 'relatorio-mensal', description: null, display_order: 2,
        duration_seconds: 80, hls_url: 'https://h/2.m3u8', thumbnail_url: null, article: null },
    ],
  },
];
```

`apps/crm/src/pages/ajuda/__tests__/AjudaPage.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kb', () => ({ getPublishedArticles: vi.fn() }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getPublishedArticles } from '@/store/kb';
import { getMyVideoProgress, getPublishedVideoSeries, saveVideoProgress } from '@/store/kbVideos';
import AjudaPage from '../AjudaPage';

const SERIES = [
  {
    id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1,
    videos: [
      { id: 1, series_id: 's1', title: 'Primeiro acesso', slug: 'primeiro-acesso', description: null, display_order: 1,
        duration_seconds: 65, hls_url: 'https://h/1.m3u8', thumbnail_url: null, article: null },
      { id: 2, series_id: 's1', title: 'Relatório mensal', slug: 'relatorio-mensal', description: null, display_order: 2,
        duration_seconds: 80, hls_url: 'https://h/2.m3u8', thumbnail_url: null, article: null },
    ],
  },
];

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (t: string) => CanPlayTypeResult;
  vi.mocked(getPublishedArticles).mockResolvedValue([]);
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES as never);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
  vi.mocked(saveVideoProgress).mockResolvedValue();
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderPage(path = '/ajuda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AjudaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AjudaPage videos', () => {
  it('shows the playlist above the search', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar vídeos e artigos...')).toBeInTheDocument();
  });

  it('opens on the video named in ?video=', async () => {
    renderPage('/ajuda?video=relatorio-mensal');
    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
  });

  it('hides the block when no series has a visible video', async () => {
    vi.mocked(getPublishedVideoSeries).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nenhum artigo publicado ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tutoriais em vídeo' })).toBeNull();
  });

  it('search finds videos, linking to their page', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    fireEvent.change(screen.getByPlaceholderText('Buscar vídeos e artigos...'), { target: { value: 'relatorio' } });
    expect(await screen.findByRole('link', { name: /Relatório mensal/ })).toHaveAttribute(
      'href',
      '/ajuda/video/relatorio-mensal',
    );
  });
});
```

`apps/crm/src/pages/ajuda/__tests__/VideoPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getMyVideoProgress, getPublishedVideoSeries } from '@/store/kbVideos';
import VideoPage from '../VideoPage';

const SERIES = [
  {
    id: 's1', title: 'Primeiros passos', slug: 'pp', description: null, display_order: 1,
    videos: [
      { id: 1, series_id: 's1', title: 'Primeiro acesso', slug: 'primeiro-acesso', description: null, display_order: 1,
        duration_seconds: 65, hls_url: 'https://h/1.m3u8', thumbnail_url: null, article: null },
      { id: 2, series_id: 's1', title: 'Relatório mensal', slug: 'relatorio-mensal', description: null, display_order: 2,
        duration_seconds: 80, hls_url: 'https://h/2.m3u8', thumbnail_url: null, article: null },
    ],
  },
];

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (t: string) => CanPlayTypeResult;
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES as never);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderAt(slug: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ajuda/video/${slug}`]}>
        <Routes>
          <Route path="/ajuda/video/:slug" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VideoPage', () => {
  it('plays the video from the URL and restores the tab title on unmount', async () => {
    document.title = 'Dashboard | Mesaas';
    const { unmount } = renderAt('relatorio-mensal');
    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
    expect(document.title).toBe('Relatório mensal | Mesaas');
    expect(screen.getByRole('link', { name: /Central de Ajuda/ })).toHaveAttribute('href', '/ajuda');
    unmount();
    expect(document.title).toBe('Dashboard | Mesaas');
  });

  it('shows "Vídeo não encontrado" for an unknown slug', async () => {
    renderAt('nao-existe');
    expect(await screen.findByText('Vídeo não encontrado.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/ajuda/__tests__/AjudaPage.test.tsx apps/crm/src/pages/ajuda/__tests__/VideoPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/crm/src/pages/ajuda/videos/VideoPlaylistHero.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';
import { VideoPlaylistBlock } from './VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './useKbVideos';

/** Top of /ajuda. Waits for BOTH queries so the first selection sees the user's progress, keeps
 * the block's height while loading, and renders nothing when there is no visible series (or the
 * query failed: articles still work). */
export function VideoPlaylistHero({ requestedSlug }: { requestedSlug: string | null }) {
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();

  if (isLoading || progressLoading) {
    return <Skeleton aria-hidden className="h-[clamp(220px,32vw,420px)] w-full rounded-2xl" />;
  }
  if (isError || series.length === 0) return null;

  return (
    <VideoPlaylistBlock
      series={series}
      progress={progress}
      onSaveProgress={save}
      requestedSlug={requestedSlug}
      collapsible
    />
  );
}
```

`apps/crm/src/pages/ajuda/videos/VideoResultCard.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { formatDuration, type VideoSearchHit } from './playlist';

export function VideoResultCard({ hit }: { hit: VideoSearchHit }) {
  const { video, seriesTitle } = hit;
  return (
    <Link
      to={`/ajuda/video/${video.slug}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--surface-darker)]">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <PlayCircle className="h-10 w-10 text-[var(--text-light)] opacity-40" />
          </div>
        )}
        {video.duration_seconds != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[0.7rem] font-medium tabular-nums text-white">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>
      <div className="p-5">
        <span className="mb-2 inline-block rounded-sm bg-[rgba(234,179,8,0.1)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--primary-color)]">
          Vídeo · {seriesTitle}
        </span>
        <h3 className="line-clamp-2 text-[1.05rem] font-bold leading-snug text-[var(--text-main)] font-[var(--font-heading)]">
          {video.title}
        </h3>
      </div>
    </Link>
  );
}
```

`apps/crm/src/pages/ajuda/AjudaPage.tsx`: apply these edits.

Imports (add):

```tsx
import { VideoPlaylistHero } from './videos/VideoPlaylistHero';
import { VideoResultCard } from './videos/VideoResultCard';
import { useKbVideoSeries } from './videos/useKbVideos';
import { filterVideos } from './videos/playlist';
```

Inside the component, after `filteredArticles`:

```tsx
  const { data: videoSeries = [] } = useKbVideoSeries();
  const filteredVideos = useMemo(() => filterVideos(videoSeries, search), [videoSeries, search]);
```

Right after the header `</div>` (before the search wrapper):

```tsx
      <VideoPlaylistHero requestedSlug={searchParams.get('video')} />
```

Placeholder:

```tsx
          placeholder="Buscar vídeos e artigos..."
```

Replace this existing branch (current `AjudaPage.tsx:57-73`):

```tsx
      ) : isSearching ? (
        filteredArticles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[0.9rem] text-[var(--text-light)]">
              Nenhum artigo encontrado para esta busca.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
            {filteredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )
```

with:

```tsx
      ) : isSearching ? (
        filteredArticles.length === 0 && filteredVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[0.9rem] text-[var(--text-light)]">
              Nenhum vídeo ou artigo encontrado para esta busca.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
            {filteredVideos.map((hit) => (
              <VideoResultCard key={`video-${hit.video.id}`} hit={hit} />
            ))}
            {filteredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )
```

`apps/crm/src/pages/ajuda/VideoPage.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import type { KbVideo } from '@/store/kbVideos';
import { VideoPlaylistBlock } from './videos/VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './videos/useKbVideos';

export default function VideoPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();

  const video = useMemo(
    () => series.flatMap((s) => s.videos).find((v) => v.slug === slug) ?? null,
    [series, slug],
  );

  // Same capture+restore as EntregasPage: nothing else sets the tab title for this route.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${video ? video.title : 'Vídeo'} | Mesaas`;
    return () => {
      document.title = previousTitle;
    };
  }, [video]);

  // Keep the URL shareable as the user moves through the playlist.
  const handleVideoChange = (current: KbVideo) => {
    if (current.slug !== slug) navigate(`/ajuda/video/${current.slug}`, { replace: true });
  };

  if (isLoading || progressLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !video) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-[var(--text-light)]">Vídeo não encontrado.</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">
            Voltar à Central de Ajuda
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/ajuda"
        className="inline-flex items-center gap-1.5 text-[0.82rem] text-[var(--text-light)] transition-colors hover:text-[var(--text-main)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Central de Ajuda
      </Link>
      <VideoPlaylistBlock
        series={series}
        progress={progress}
        onSaveProgress={save}
        requestedSlug={slug ?? null}
        onVideoChange={handleVideoChange}
      />
    </div>
  );
}
```

`apps/crm/src/App.tsx`: next to the other ajuda lazy imports:

```tsx
const VideoPage = lazy(() => import('./pages/ajuda/VideoPage'));
```

In the routes, before `<Route path="/ajuda/:slug" …>`:

```tsx
                <Route path="/ajuda/video/:slug" element={<VideoPage />} />
                <Route path="/ajuda/video" element={<Navigate to="/ajuda" replace />} />
```

(`vercel.json` already routes `/ajuda(/.*)?` to the CRM: no change.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/crm/src/pages/ajuda && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS (existing ajuda tests included).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/ajuda apps/crm/src/App.tsx
git commit -m "feat(ajuda): playlist de vídeos no topo, busca de vídeos e página do vídeo"
```

---

### Task 14: Full verification

**Files:** none new (fixes only, if a gate fails).

- [ ] **Step 1: Edge-function gates**

Run: `npm run check:functions && npm run test:functions`
Expected: both PASS.

- [ ] **Step 2: Restore node_modules after Deno**

Run: `ls node_modules/.deno >/dev/null 2>&1 && npm ci || true` and `git status --short deno.lock` (revert an incidental `deno.lock` change with `git checkout deno.lock` unless a new dependency needs it).

- [ ] **Step 3: Frontend gates (all four typechecks, as CI does)**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all PASS. Fix `format:check` with `npm run format`.

- [ ] **Step 4: Entitlement suite**

Run (Docker/colima available): `npm run test:db`. Otherwise note in the PR that CI's `entitlement-tests` covers `99_kb_videos.sql`.

- [ ] **Step 5: Browser check of the CRM block (no backend data exists yet)**

Start the CRM (`preview_start` with the CRM dev config; in a worktree use `npm run dev:env`). Log in with the seed flow from memory `reference_seed_login_browser_verification`. Before navigating to `/ajuda`, patch `fetch` in the page (memory `reference_hub_repro_patch_fetch_browser_pane`) so:

- `GET …/rest/v1/kb_video_series…` returns two series: "Primeiros passos" with 3 videos, "Relatórios" with 1. Use `hls_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"` (public test HLS) and a `thumbnail_url` of any public JPG.
- `GET …/rest/v1/kb_video_progress…` returns `[{ video_id: 1, position_seconds: 200, completed_at: "2026-09-28T10:00:00Z" }]`.
- `POST …/rest/v1/rpc/save_kb_video_progress` returns `204`.

Check with `read_page` and screenshots:
1. `/ajuda` at desktop width: player left, rail right; "1 de 3"; video 2 highlighted; series dropdown lists both series.
2. Play: the video starts; after ~10 s a `save_kb_video_progress` request appears in `read_network_requests`.
3. Seek near the end: "Próximo: …" overlay with countdown; "Cancelar" dismisses it.
4. `resize_window` to 375×812: rail stacks under the player, no horizontal scroll.
5. Dark theme (`colorScheme: "dark"` + `data-theme="dark"`): text on the rail and overlays readable.
6. Search "relat": video card first, links to `/ajuda/video/…`; open it, the tab title is `<título> | Mesaas`.
7. Reset the viewport with `preset: "desktop"`.

- [ ] **Step 6: Commit any fixes, then hand off**

```bash
git status --short
git add -A && git commit -m "fix(ajuda): ajustes da verificação no navegador"   # only if something changed
```

Hand-off to the user (do not do these without explicit approval; memory `feedback_merge_deploys_frontend_migrations_first`): renumber the migration if `origin/main` moved; `db push` staging then prod; deploy `stream-webhook`, `post-media-cleanup-cron`, `platform-admin` with `--use-api` (and `--no-verify-jwt`, as today) **before** merging and before the first upload; then merge; then upload the 8 "Primeiros passos" videos in the Admin and publish the series.
