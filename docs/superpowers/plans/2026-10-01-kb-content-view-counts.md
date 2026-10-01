# Central de Ajuda view counts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** record Central de Ajuda article opens and video plays, and show views and unique users (last 30 days and all time) plus video completions on the Admin's article and video lists.

**Architecture:** a new `kb_content_views` event table is written only through a SECURITY DEFINER RPC `record_kb_view`, which the CRM calls fire-and-forget. A service-role-only SQL function `kb_view_stats()` aggregates the counts, and a new `platform-admin` action `kb-view-stats` exposes it to the Admin, which renders a `KbViewStats` cell on both list pages. Platform admins are excluded at **read** time, for every metric.

**Tech stack:** Postgres (Supabase migrations plus psql entitlement suites), Deno edge function, React 19 with TanStack Query (CRM + Admin), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-kb-content-view-counts-design.md`

## Global constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/admin-content-view-counts-9aa3e3`, branch `claude/admin-content-view-counts-9aa3e3`. Run every command from there.
- Migration filename: `supabase/migrations/20261001000001_kb_content_views.sql`. Before opening the PR, confirm the prefix is still above `ls supabase/migrations | tail -1` on `origin/main`, and renumber if it isn't.
- Function grants list every role explicitly (`FROM PUBLIC, anon, authenticated, service_role`), because `REVOKE FROM PUBLIC` alone leaves Supabase's direct grants in place.
- Edge functions never return raw error detail. `platform-admin/index.ts`'s catch-all already logs the error and returns a generic `500 Internal server error`, so handlers just `throw`.
- User-facing copy is Portuguese, with **no em-dashes**; use `·` as the separator.
- Admin primitives import from `../components/ui/*` and `cn` from `../lib/utils` (never `@/lib/utils`).
- View recording must never toast, block rendering, or break the page when it fails.
- Before pushing, run all of: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions` and `npm run test:functions`. After any `deno test` run, `ls node_modules/.deno` and `npm ci` if it exists (Deno pollutes `node_modules`), and `git checkout deno.lock` if it got dirtied.

---

### Task 1: migration and entitlement suite

**Files:**
- Create: `supabase/migrations/20261001000001_kb_content_views.sql`
- Create: `supabase/tests/entitlements/99_kb_content_views.sql`

**Interfaces:**
- Produces:
  - SQL `public.record_kb_view(p_article_id uuid DEFAULT NULL, p_video_id bigint DEFAULT NULL) RETURNS void`, executable by `authenticated` only;
  - SQL `public.kb_view_stats() RETURNS TABLE (kind text, item_id text, views_30d bigint, users_30d bigint, views_total bigint, users_total bigint, completed_total bigint)`, executable by `service_role` only. `kind` is `'article'` or `'video'`. `completed_total` is NULL for articles.

- [ ] **Step 1: write the failing entitlement suite**

Create `supabase/tests/entitlements/99_kb_content_views.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contagem de visualizações da Central de Ajuda (migration 20261001000001).
-- (a) grants: tabela fechada para anon/authenticated; record_kb_view só authenticated;
--     kb_view_stats só service_role. (b) record_kb_view ignora conteúdo oculto, deduplica
--     por 30 min, exige exatamente um alvo. (c) kb_view_stats: janelas 30d/total, pessoas
--     únicas, conclusões só de quem tem visualização registrada, admins excluídos NA LEITURA.
begin;
-- kb_content_views é excluída: a parity grant concederia ALL e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(array['kb_content_views']);
do $$
declare
  v_ua        uuid := gen_random_uuid();
  v_ub        uuid := gen_random_uuid();
  v_adm       uuid := gen_random_uuid();
  v_s_pub     uuid;
  v_s_draft   uuid;
  v_art_pub   uuid;
  v_art_draft uuid;
  v_v_ok      bigint;
  v_v_pending bigint;
  v_v_hidden  bigint;
  v_n         int;
  v_rejected  boolean;
  r           record;
begin
  -- ---- (a) grants ----
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'SELECT'),
    'authenticated tem SELECT em kb_content_views';
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'INSERT'),
    'authenticated tem INSERT em kb_content_views';
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'UPDATE'),
    'authenticated tem UPDATE em kb_content_views';
  assert not has_table_privilege('anon', 'public.kb_content_views', 'SELECT'),
    'anon tem SELECT em kb_content_views';
  assert not has_function_privilege('anon', 'public.record_kb_view(uuid,bigint)', 'EXECUTE'),
    'anon nao pode executar record_kb_view';
  assert has_function_privilege('authenticated', 'public.record_kb_view(uuid,bigint)', 'EXECUTE'),
    'authenticated precisa executar record_kb_view';
  assert not has_function_privilege('authenticated', 'public.kb_view_stats()', 'EXECUTE'),
    'authenticated nao pode executar kb_view_stats';
  assert not has_function_privilege('anon', 'public.kb_view_stats()', 'EXECUTE'),
    'anon nao pode executar kb_view_stats';
  assert has_function_privilege('service_role', 'public.kb_view_stats()', 'EXECUTE'),
    'service_role precisa executar kb_view_stats';

  -- ---- fixtures ----
  insert into auth.users (id) values (v_ua), (v_ub), (v_adm);
  insert into platform_admins (user_id, email) values (v_adm, 'adm@kbviews.test');

  insert into kb_articles (title, slug, category, status) values ('Pub', 'kbv-pub', 'geral', 'published')
    returning id into v_art_pub;
  insert into kb_articles (title, slug, category, status) values ('Draft', 'kbv-draft', 'geral', 'draft')
    returning id into v_art_draft;

  insert into kb_video_series (title, slug, status) values ('S', 'kbv-s', 'published') returning id into v_s_pub;
  insert into kb_video_series (title, slug, status) values ('D', 'kbv-d', 'draft') returning id into v_s_draft;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Ok', 'kbv-ok', 'published', 'kbv-uid-ok', 'ready', 'https://x.test/ok.m3u8', 100)
    returning id into v_v_ok;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status)
    values (v_s_pub, 'Pend', 'kbv-pend', 'published', 'kbv-uid-pend', 'pending')
    returning id into v_v_pending;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_draft, 'Hid', 'kbv-hid', 'published', 'kbv-uid-hid', 'ready', 'https://x.test/h.m3u8', 30)
    returning id into v_v_hidden;

  -- ---- (b) record_kb_view como A ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform record_kb_view(p_article_id => v_art_pub);
  perform record_kb_view(p_article_id => v_art_pub);          -- dedupe 30 min
  perform record_kb_view(p_article_id => v_art_draft);        -- oculto: silencioso
  perform record_kb_view(p_article_id => gen_random_uuid());  -- inexistente: silencioso
  perform record_kb_view(p_video_id => v_v_ok);
  perform record_kb_view(p_video_id => v_v_pending);          -- não pronto
  perform record_kb_view(p_video_id => v_v_hidden);           -- série rascunho

  v_rejected := false;
  begin
    perform record_kb_view(p_article_id => v_art_pub, p_video_id => v_v_ok);
  exception when invalid_parameter_value then v_rejected := true;
  end;
  assert v_rejected, 'record_kb_view aceitou dois alvos';

  v_rejected := false;
  begin
    perform record_kb_view();
  exception when invalid_parameter_value then v_rejected := true;
  end;
  assert v_rejected, 'record_kb_view aceitou nenhum alvo';

  v_rejected := false;
  begin
    perform 1 from kb_content_views;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated leu kb_content_views direto';
  execute 'reset role';

  select count(*) into v_n from kb_content_views where user_id = v_ua and article_id = v_art_pub;
  assert v_n = 1, format('dedupe falhou: %s linhas para o artigo publicado', v_n);
  select count(*) into v_n from kb_content_views where article_id = v_art_draft;
  assert v_n = 0, 'artigo rascunho foi registrado';
  select count(*) into v_n from kb_content_views where video_id in (v_v_pending, v_v_hidden);
  assert v_n = 0, 'video oculto foi registrado';
  select count(*) into v_n from kb_content_views where user_id = v_ua and video_id = v_v_ok;
  assert v_n = 1, 'video pronto nao foi registrado';

  -- passada a janela de 30 min, uma nova visualização conta
  update kb_content_views set viewed_at = now() - interval '31 minutes' where user_id = v_ua and article_id = v_art_pub;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform record_kb_view(p_article_id => v_art_pub);
  execute 'reset role';
  select count(*) into v_n from kb_content_views where user_id = v_ua and article_id = v_art_pub;
  assert v_n = 2, format('apos 31 min deveria haver 2 linhas, ha %s', v_n);

  -- admin é registrado normalmente (exclusão é na leitura)
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform record_kb_view(p_article_id => v_art_pub);
  perform record_kb_view(p_video_id => v_v_ok);
  execute 'reset role';
  select count(*) into v_n from kb_content_views where user_id = v_adm;
  assert v_n = 2, 'visualizacao de admin deveria ser gravada';

  -- B: uma visualização antiga (40 dias) do artigo
  insert into kb_content_views (article_id, user_id, viewed_at) values (v_art_pub, v_ub, now() - interval '40 days');

  -- conclusões: A concluiu (tem view), B concluiu sem view (pré-feature), admin concluiu
  insert into kb_video_progress (user_id, video_id, position_seconds, completed_at) values
    (v_ua, v_v_ok, 100, now()), (v_ub, v_v_ok, 100, now()), (v_adm, v_v_ok, 100, now());

  -- ---- (c) kb_view_stats ----
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  -- A: 2 views (ambas < 30d: now()-31min e now()); B: 1 view de 40 dias; admin excluído
  assert r.views_30d = 2, format('artigo views_30d = %s, esperado 2', r.views_30d);
  assert r.users_30d = 1, format('artigo users_30d = %s, esperado 1', r.users_30d);
  assert r.views_total = 3, format('artigo views_total = %s, esperado 3', r.views_total);
  assert r.users_total = 2, format('artigo users_total = %s, esperado 2', r.users_total);
  assert r.completed_total is null, 'artigo nao tem completed_total';

  select * into r from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert r.views_total = 1, format('video views_total = %s, esperado 1 (admin excluido)', r.views_total);
  assert r.completed_total = 1,
    format('video completed_total = %s, esperado 1 (B sem view, admin excluido)', r.completed_total);

  select count(*) into v_n from kb_view_stats() where item_id in (v_art_draft::text, v_v_pending::text);
  assert v_n = 0, 'itens sem visualizacao nao devem aparecer';

  -- promover A a admin remove views e conclusões dele; remover devolve
  insert into platform_admins (user_id, email) values (v_ua, 'a@kbviews.test');
  select count(*) into v_n from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert v_n = 0, 'video deveria sumir: unico viewer virou admin';
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  assert r.views_total = 1 and r.users_total = 1, format('apos promover A: total=%s users=%s', r.views_total, r.users_total);

  delete from platform_admins where user_id = v_ua;
  select * into r from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert r.views_total = 1 and r.completed_total = 1, 'remover admin deveria devolver views e conclusoes';

  -- usuário apagado: views ficam no total, saem das pessoas únicas
  delete from kb_video_progress where user_id = v_ub;
  delete from auth.users where id = v_ub;
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  assert r.views_total = 3 and r.users_total = 1,
    format('apos apagar B: total=%s users=%s', r.views_total, r.users_total);
end $$;
rollback;
```

- [ ] **Step 2: run it and confirm it fails**

Local Supabase runs on colima (see memory `reference_local_supabase_colima`). If it's available:

```bash
colima status && npx supabase start && bash scripts/test-entitlements.sh 2>&1 | grep -E "kb_content_views|FAIL"
```

Expected: `FAIL 99_kb_content_views.sql`, with `relation "kb_content_views" does not exist`. If no local DB is available, skip ahead and rely on the `entitlement-tests` CI job, and say so in the PR body.

- [ ] **Step 3: write the migration**

Create `supabase/migrations/20261001000001_kb_content_views.sql`:

```sql
-- Contagem de visualizações da Central de Ajuda (spec 2026-10-01-kb-content-view-counts-design).
-- Um evento por abertura de artigo / play de vídeo. Escrita só via record_kb_view (SECURITY
-- DEFINER, authenticated); leitura agregada só via kb_view_stats (service_role, usada pelo
-- platform-admin). Admins da plataforma são gravados como qualquer usuário e excluídos NA
-- LEITURA, em todas as métricas, para que promover/remover um admin mova views e conclusões juntas.

CREATE TABLE IF NOT EXISTS kb_content_views (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id uuid   REFERENCES kb_articles(id) ON DELETE CASCADE,
  video_id   bigint REFERENCES kb_videos(id)   ON DELETE CASCADE,
  user_id    uuid   REFERENCES auth.users(id)  ON DELETE SET NULL,
  conta_id   uuid,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_content_views_one_target CHECK (num_nonnulls(article_id, video_id) = 1)
);

CREATE INDEX IF NOT EXISTS kb_content_views_article
  ON kb_content_views (article_id, viewed_at) WHERE article_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kb_content_views_video
  ON kb_content_views (video_id, viewed_at) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kb_content_views_user
  ON kb_content_views (user_id, viewed_at);

-- Sem policies: ninguém além do service role / funções DEFINER toca a tabela. Hosted Supabase
-- concede ALL em tabela nova a anon/authenticated por ACL padrão, daí o REVOKE explícito.
ALTER TABLE kb_content_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kb_content_views FROM anon, authenticated;

-- Registra uma visualização do usuário atual. Conteúdo oculto ou inexistente retorna em
-- silêncio (mesmos critérios das policies de SELECT de kb_articles/kb_videos), então um
-- rascunho não se distingue de um id inexistente. Dedupe de 30 min por usuário+alvo para
-- refresh e StrictMode; sob concorrência duas linhas podem passar, aceitável para analytics.
CREATE OR REPLACE FUNCTION public.record_kb_view(
  p_article_id uuid DEFAULT NULL,
  p_video_id bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_article_id, p_video_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of p_article_id, p_video_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_article_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM kb_articles a WHERE a.id = p_article_id AND a.status = 'published'
    ) THEN
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM kb_content_views cv
      WHERE cv.user_id = v_uid AND cv.article_id = p_article_id
        AND cv.viewed_at > now() - interval '30 minutes'
    ) THEN
      RETURN;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM kb_videos v
      JOIN kb_video_series s ON s.id = v.series_id
      WHERE v.id = p_video_id
        AND v.status = 'published'
        AND v.stream_status = 'ready'
        AND s.status = 'published'
    ) THEN
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM kb_content_views cv
      WHERE cv.user_id = v_uid AND cv.video_id = p_video_id
        AND cv.viewed_at > now() - interval '30 minutes'
    ) THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO kb_content_views (article_id, video_id, user_id, conta_id)
  VALUES (p_article_id, p_video_id, v_uid, get_my_conta_id());
END;
$$;

REVOKE ALL ON FUNCTION public.record_kb_view(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_kb_view(uuid, bigint) TO authenticated;

-- Agregado por item para o Admin. Exclusão de admins é por pertencimento ATUAL a
-- platform_admins, em views e conclusões. Linhas de usuário apagado (user_id NULL) contam no
-- total e não em pessoas únicas. completed_total conta só quem concluiu E tem visualização
-- registrada do vídeo: conclusões anteriores à feature não aparecem, e um vídeo nunca mostra
-- conclusões sem views. Só itens com ao menos uma visualização retornam.
CREATE OR REPLACE FUNCTION public.kb_view_stats()
RETURNS TABLE (
  kind text,
  item_id text,
  views_30d bigint,
  users_30d bigint,
  views_total bigint,
  users_total bigint,
  completed_total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT cv.article_id, cv.video_id, cv.user_id, cv.viewed_at
    FROM kb_content_views cv
    WHERE cv.user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = cv.user_id)
  )
  SELECT
    'article'::text,
    v.article_id::text,
    count(*) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(DISTINCT v.user_id) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(*),
    count(DISTINCT v.user_id),
    NULL::bigint
  FROM v
  WHERE v.article_id IS NOT NULL
  GROUP BY v.article_id
  UNION ALL
  SELECT
    'video'::text,
    v.video_id::text,
    count(*) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(DISTINCT v.user_id) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(*),
    count(DISTINCT v.user_id),
    (
      SELECT count(*)
      FROM kb_video_progress p
      WHERE p.video_id = v.video_id
        AND p.completed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM v v2 WHERE v2.video_id = p.video_id AND v2.user_id = p.user_id)
    )
  FROM v
  WHERE v.video_id IS NOT NULL
  GROUP BY v.video_id;
$$;

REVOKE ALL ON FUNCTION public.kb_view_stats()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_view_stats() TO service_role;
```

- [ ] **Step 4: run the suite and confirm it passes**

```bash
npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep -E "kb_content_views|FAIL"
```

Expected: `PASS 99_kb_content_views.sql` and no `FAIL` lines. If an assertion message points to a wrong count, fix the SQL rather than the expectation; the expectations encode the spec. Run `git status`, and never commit `supabase/config.toml` port overrides.

- [ ] **Step 5: commit**

```bash
git add supabase/migrations/20261001000001_kb_content_views.sql supabase/tests/entitlements/99_kb_content_views.sql
git commit -m "feat(kb): tabela kb_content_views, record_kb_view e kb_view_stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `platform-admin` action `kb-view-stats`

**Files:**
- Create: `supabase/functions/platform-admin/kb-views.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (import near the `./kb-videos.ts` import at line ~37; new `case` before `default:` at line ~214)
- Test: `supabase/functions/__tests__/platform-admin-kb-views_test.ts`

**Interfaces:**
- Consumes: SQL `kb_view_stats()` from Task 1.
- Produces: the `platform-admin` action `"kb-view-stats"` (no params). Response `200`:

  ```json
  {
    "articles": { "<uuid>": { "views_30d": 0, "users_30d": 0, "views_total": 0, "users_total": 0 } },
    "videos":   { "<videoId as string>": { "views_30d": 0, "users_30d": 0, "views_total": 0, "users_total": 0, "completed": 0 } }
  }
  ```

  All values are JS numbers. Items with no views are absent.

- [ ] **Step 1: write the failing test**

Create `supabase/functions/__tests__/platform-admin-kb-views_test.ts`:

```ts
import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { handleKbViewStats, shapeKbViewStats } from "../platform-admin/kb-views.ts";

const H = { "Content-Type": "application/json" };

Deno.test("shapeKbViewStats: splits by kind and coerces bigint strings to numbers", () => {
  const out = shapeKbViewStats([
    {
      kind: "article", item_id: "a1", views_30d: "48", users_30d: "12",
      views_total: "210", users_total: "64", completed_total: null,
    },
    {
      kind: "video", item_id: "7", views_30d: 3, users_30d: 2,
      views_total: 9, users_total: 5, completed_total: "4",
    },
  ]);
  assertEquals(out, {
    articles: { a1: { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64 } },
    videos: { "7": { views_30d: 3, users_30d: 2, views_total: 9, users_total: 5, completed: 4 } },
  });
});

Deno.test("shapeKbViewStats: ignores unknown kinds and treats junk numbers as 0", () => {
  const out = shapeKbViewStats([
    { kind: "banner", item_id: "x", views_30d: 1, users_30d: 1, views_total: 1, users_total: 1, completed_total: null },
    { kind: "video", item_id: "8", views_30d: "abc", users_30d: null, views_total: 2, users_total: 1, completed_total: null },
  ]);
  assertEquals(out, {
    articles: {},
    videos: { "8": { views_30d: 0, users_30d: 0, views_total: 2, users_total: 1, completed: 0 } },
  });
});

Deno.test("kb-view-stats: returns the shaped payload from the RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", {
    data: [{
      kind: "article", item_id: "a1", views_30d: 1, users_30d: 1,
      views_total: 1, users_total: 1, completed_total: null,
    }],
  });
  const res = await handleKbViewStats(db as never, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.articles.a1.views_total, 1);
  assertEquals(body.videos, {});
  assert(db.calls.some((c) => c.table === "rpc:kb_view_stats"), "rpc not called");
});

Deno.test("kb-view-stats: null data is an empty payload", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", { data: null });
  const res = await handleKbViewStats(db as never, H);
  assertEquals(await readJson(res), { articles: {}, videos: {} });
});

Deno.test("kb-view-stats: RPC error is thrown for index.ts's generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await handleKbViewStats(db as never, H);
  } catch {
    threw = true;
  }
  assert(threw, "expected the handler to throw on RPC error");
});
```

- [ ] **Step 2: run it and confirm it fails**

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/platform-admin-kb-views_test.ts
```

Expected: FAIL with a module-not-found error for `../platform-admin/kb-views.ts`.

- [ ] **Step 3: implement the handler**

Create `supabase/functions/platform-admin/kb-views.ts`:

```ts
// Contagem de visualizações da Central de Ajuda (spec 2026-10-01-kb-content-view-counts-design).
// A agregação (janelas, pessoas únicas, exclusão de admins) vive em kb_view_stats() no banco;
// aqui só se separa por tipo e converte bigint (que pode chegar como string) para number.
// A autorização (platform_admins) já aconteceu em index.ts; erro sobe para o 500 genérico de lá.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Headers = Record<string, string>;

export interface KbViewStatsRow {
  kind: string;
  item_id: string;
  views_30d: unknown;
  users_30d: unknown;
  views_total: unknown;
  users_total: unknown;
  completed_total: unknown;
}

export interface KbViewStats {
  views_30d: number;
  users_30d: number;
  views_total: number;
  users_total: number;
}

export interface KbVideoViewStats extends KbViewStats {
  completed: number;
}

export interface KbViewStatsPayload {
  articles: Record<string, KbViewStats>;
  videos: Record<string, KbVideoViewStats>;
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function baseStats(row: KbViewStatsRow): KbViewStats {
  return {
    views_30d: toCount(row.views_30d),
    users_30d: toCount(row.users_30d),
    views_total: toCount(row.views_total),
    users_total: toCount(row.users_total),
  };
}

export function shapeKbViewStats(rows: KbViewStatsRow[]): KbViewStatsPayload {
  const out: KbViewStatsPayload = { articles: {}, videos: {} };
  for (const row of rows) {
    if (row.kind === "article") {
      out.articles[row.item_id] = baseStats(row);
    } else if (row.kind === "video") {
      out.videos[row.item_id] = { ...baseStats(row), completed: toCount(row.completed_total) };
    }
  }
  return out;
}

export async function handleKbViewStats(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const { data, error } = await svc.rpc("kb_view_stats");
  if (error) throw error;
  const payload = shapeKbViewStats((data ?? []) as KbViewStatsRow[]);
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
```

- [ ] **Step 4: wire it into `index.ts`**

In `supabase/functions/platform-admin/index.ts`, add after the `} from "./kb-videos.ts";` import:

```ts
import { handleKbViewStats } from "./kb-views.ts";
```

Add this case right after the `case "reorder-kb-videos":` pair, before `default:`:

```ts
      case "kb-view-stats":
        return await handleKbViewStats(svc, headers);
```

- [ ] **Step 5: run the tests and type check**

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/platform-admin-kb-views_test.ts && npm run check:functions
```

Expected: 5 passing tests, and `check:functions` exits 0. Then `ls node_modules/.deno 2>/dev/null && npm ci`, and `git checkout deno.lock` if it changed.

- [ ] **Step 6: commit**

```bash
git add supabase/functions/platform-admin/kb-views.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-kb-views_test.ts
git commit -m "feat(platform-admin): action kb-view-stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CRM records article opens and video plays

**Files:**
- Create: `apps/crm/src/store/kbViews.ts`
- Create: `apps/crm/src/pages/ajuda/useRecordKbView.ts`
- Modify: `apps/crm/src/pages/ajuda/ArtigoPage.tsx` (call the hook after the `article` query, ~line 38)
- Modify: `apps/crm/src/pages/ajuda/videos/VideoStage.tsx` (new optional prop and `onPlay` handler)
- Modify: `apps/crm/src/pages/ajuda/videos/VideoPlaylistBlock.tsx` (pass the new prop through)
- Modify: `apps/crm/src/pages/ajuda/videos/VideoPlaylistHero.tsx`, `apps/crm/src/pages/ajuda/VideoPage.tsx` (supply it)
- Modify: `apps/crm/src/pages/ajuda/__tests__/AjudaPage.test.tsx`, `apps/crm/src/pages/ajuda/__tests__/VideoPage.test.tsx` (mock the new store module)
- Test: `apps/crm/src/store/__tests__/kbViews.test.ts`, `apps/crm/src/pages/ajuda/__tests__/useRecordKbView.test.tsx`, `apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx`

`recordKbView` lives in its own module, `store/kbViews.ts`, not in `store/kb.ts` as the spec says. Existing tests mock `@/store/kb` with explicit factories, so a new export there would come back `undefined` in them.

**Interfaces:**
- Consumes: SQL `record_kb_view(p_article_id, p_video_id)` from Task 1.
- Produces:
  - `export type KbViewTarget = { articleId: string } | { videoId: number }` and `export async function recordKbView(target: KbViewTarget): Promise<void>` (throws on RPC error), in `@/store/kbViews`;
  - `export function recordKbViewSafely(target: KbViewTarget): void` (fire-and-forget; logs with `console.debug`) and `export function useRecordArticleView(article: { id: string; status: string } | null | undefined): void`, in `apps/crm/src/pages/ajuda/useRecordKbView.ts`;
  - a new optional prop `onFirstPlay?: (videoId: number) => void` on `VideoStage` and `VideoPlaylistBlock`.

- [ ] **Step 1: write the failing store test**

Create `apps/crm/src/store/__tests__/kbViews.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../core', () => ({ supabase: { rpc: rpcMock } }));

import { recordKbView } from '../kbViews';

describe('store/kbViews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only p_article_id for an article', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await recordKbView({ articleId: 'a1' });
    expect(rpcMock).toHaveBeenCalledWith('record_kb_view', { p_article_id: 'a1' });
  });

  it('sends only p_video_id for a video', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await recordKbView({ videoId: 7 });
    expect(rpcMock).toHaveBeenCalledWith('record_kb_view', { p_video_id: 7 });
  });

  it('throws the RPC error', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'boom' } });
    await expect(recordKbView({ videoId: 7 })).rejects.toEqual({ message: 'boom' });
  });
});
```

- [ ] **Step 2: write the failing hook test**

Create `apps/crm/src/pages/ajuda/__tests__/useRecordKbView.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn() }));

import { recordKbView } from '@/store/kbViews';
import { recordKbViewSafely, useRecordArticleView } from '../useRecordKbView';

beforeEach(() => {
  vi.mocked(recordKbView).mockReset();
  vi.mocked(recordKbView).mockResolvedValue();
});

describe('useRecordArticleView', () => {
  it('records once per published article id', () => {
    const { rerender } = renderHook(({ a }) => useRecordArticleView(a), {
      initialProps: { a: { id: 'a1', status: 'published' } as { id: string; status: string } | null },
    });
    rerender({ a: { id: 'a1', status: 'published' } });
    expect(recordKbView).toHaveBeenCalledTimes(1);
    expect(recordKbView).toHaveBeenCalledWith({ articleId: 'a1' });

    rerender({ a: { id: 'a2', status: 'published' } });
    expect(recordKbView).toHaveBeenCalledTimes(2);
    expect(recordKbView).toHaveBeenLastCalledWith({ articleId: 'a2' });
  });

  it('does not record a missing or draft article', () => {
    const { rerender } = renderHook(({ a }) => useRecordArticleView(a), {
      initialProps: { a: null as { id: string; status: string } | null | undefined },
    });
    rerender({ a: undefined });
    rerender({ a: { id: 'a3', status: 'draft' } });
    expect(recordKbView).not.toHaveBeenCalled();
  });
});

describe('recordKbViewSafely', () => {
  it('swallows a failed record', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(recordKbView).mockRejectedValue(new Error('offline'));
    expect(() => recordKbViewSafely({ videoId: 1 })).not.toThrow();
    await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    debug.mockRestore();
  });
});
```

- [ ] **Step 3: add the failing video test**

In `apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx`, add inside `describe('VideoPlaylistBlock', ...)`:

```tsx
  it('reports the first play of each video once', () => {
    const onFirstPlay = vi.fn();
    const { container } = renderBlock({ onFirstPlay });
    // Opens on video 2 (first unwatched).
    fireEvent.play(videoEl(container));
    fireEvent.pause(videoEl(container));
    fireEvent.play(videoEl(container));
    expect(onFirstPlay).toHaveBeenCalledTimes(1);
    expect(onFirstPlay).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: /Primeiro cliente/ }));
    fireEvent.play(videoEl(container));
    expect(onFirstPlay).toHaveBeenCalledTimes(2);
    expect(onFirstPlay).toHaveBeenLastCalledWith(3);
  });

  it('reports nothing when the video is only shown', () => {
    const onFirstPlay = vi.fn();
    renderBlock({ onFirstPlay });
    expect(onFirstPlay).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/store/__tests__/kbViews.test.ts apps/crm/src/pages/ajuda/__tests__/useRecordKbView.test.tsx apps/crm/src/pages/ajuda/videos/__tests__/VideoPlaylistBlock.test.tsx
```

Expected: the first two files fail to resolve their imports, and the two new `VideoPlaylistBlock` tests fail because `onFirstPlay` is never called.

- [ ] **Step 5: implement the store module**

Create `apps/crm/src/store/kbViews.ts`:

```ts
import { supabase } from './core';

export type KbViewTarget = { articleId: string } | { videoId: number };

/** Records one view for the current user. Visibility, 30-minute dedupe and the platform-admin
 * rule all live in the record_kb_view RPC; callers fire and forget. */
export async function recordKbView(target: KbViewTarget): Promise<void> {
  const params =
    'articleId' in target ? { p_article_id: target.articleId } : { p_video_id: target.videoId };
  const { error } = await supabase.rpc('record_kb_view', params);
  if (error) throw error;
}
```

- [ ] **Step 6: implement the hook**

Create `apps/crm/src/pages/ajuda/useRecordKbView.ts`:

```ts
import { useEffect } from 'react';
import { recordKbView, type KbViewTarget } from '@/store/kbViews';

/** Fire-and-forget: a failed record never toasts nor affects reading (spec). */
export function recordKbViewSafely(target: KbViewTarget): void {
  recordKbView(target).catch((err) => console.debug('[kb-view] record failed', err));
}

/** Records one view per published article id shown. The server dedupes repeats within 30
 * minutes, which also absorbs StrictMode's double effect in dev. */
export function useRecordArticleView(
  article: { id: string; status: string } | null | undefined,
): void {
  const id = article?.id;
  const published = article?.status === 'published';
  useEffect(() => {
    if (id && published) recordKbViewSafely({ articleId: id });
  }, [id, published]);
}
```

- [ ] **Step 7: call it from `ArtigoPage`**

In `apps/crm/src/pages/ajuda/ArtigoPage.tsx`, add the import:

```ts
import { useRecordArticleView } from './useRecordKbView';
```

and right after the `const { data: article, isLoading } = useQuery({...});` block:

```ts
  useRecordArticleView(article);
```

- [ ] **Step 8: add `onFirstPlay` to `VideoStage`**

In `apps/crm/src/pages/ajuda/videos/VideoStage.tsx`:

1. Add to `VideoStageProps`, after `onPlayNext`:

   ```ts
     /** Called on the first `play` of this video (the parent keys the stage by video id). */
     onFirstPlay?: (videoId: number) => void;
   ```

2. Destructure `onFirstPlay` in the function parameters, after `onPlayNext`.

3. After the `resumeRef` line, add:

   ```ts
     const playedRef = useRef(false);
   ```

4. Next to `handlePause`, add:

   ```ts
     const handlePlay = () => {
       if (playedRef.current) return;
       playedRef.current = true;
       onFirstPlay?.(video.id);
     };
   ```

5. On `<VideoPlayer ...>`, add `onPlay={handlePlay}` next to `onPause={handlePause}`. `VideoPlayer` spreads the rest of its props onto `<video>`, so `onPlay` reaches the element.

`playedRef` lives on `VideoStage`, not on the inner `VideoPlayer`, so "Tentar novamente" and "Assistir de novo" (which remount the player through `attempt`) don't count a second view.

- [ ] **Step 9: pass it through `VideoPlaylistBlock`**

In `apps/crm/src/pages/ajuda/videos/VideoPlaylistBlock.tsx`:

1. Add to `VideoPlaylistBlockProps`, after `onVideoChange`:

   ```ts
     /** First play of each video; used to record a Central de Ajuda view. */
     onFirstPlay?: (videoId: number) => void;
   ```

2. Destructure `onFirstPlay` in the component parameters.
3. Pass `onFirstPlay={onFirstPlay}` to `<VideoStage ...>`.

- [ ] **Step 10: supply it from the hero and the video page**

In `apps/crm/src/pages/ajuda/videos/VideoPlaylistHero.tsx`, add the import:

```ts
import { recordKbViewSafely } from '../useRecordKbView';
```

and the prop on `<VideoPlaylistBlock ...>`:

```tsx
      onFirstPlay={(videoId) => recordKbViewSafely({ videoId })}
```

In `apps/crm/src/pages/ajuda/VideoPage.tsx`, add the import:

```ts
import { recordKbViewSafely } from './useRecordKbView';
```

and the same prop on its `<VideoPlaylistBlock ...>`:

```tsx
        onFirstPlay={(videoId) => recordKbViewSafely({ videoId })}
```

- [ ] **Step 11: mock the new module in the page tests**

`AjudaPage.test.tsx` and `VideoPage.test.tsx` render these components without mocking `@/store/core`. Add next to their existing `vi.mock` calls:

```ts
vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn(() => Promise.resolve()) }));
```

- [ ] **Step 12: run the tests and confirm they pass**

```bash
npx vitest run apps/crm/src/store/__tests__/kbViews.test.ts apps/crm/src/pages/ajuda apps/crm/src/store/__tests__/kbVideos.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: all green, and `tsc` exits 0.

- [ ] **Step 13: commit**

```bash
git add apps/crm/src/store/kbViews.ts apps/crm/src/store/__tests__/kbViews.test.ts apps/crm/src/pages/ajuda
git commit -m "feat(ajuda): registra abertura de artigo e play de vídeo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin shows the counts

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (types plus `getKbViewStats`, after `reorderKbVideos` at ~line 908)
- Create: `apps/admin/src/lib/kb-view-stats.ts` (query hook plus pt-BR formatters)
- Create: `apps/admin/src/components/KbViewStats.tsx`
- Modify: `apps/admin/src/pages/KbArticlesPage.tsx` (header grid ~line 147, row grid ~line 202, mobile block ~line 191)
- Modify: `apps/admin/src/pages/KbVideosPage.tsx` (row meta, ~line 186-200)
- Test: `apps/admin/src/components/__tests__/KbViewStats.test.tsx`, `apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`, `apps/admin/src/pages/__tests__/KbVideosPage.test.tsx`

**Interfaces:**
- Consumes: the action `kb-view-stats` from Task 2.
- Produces:
  - in `api.ts`: `KbViewStatsEntry`, `KbViewStatsResponse` and `getKbViewStats()`;
  - in `lib/kb-view-stats.ts`: `KB_VIEW_STATS_KEY`, `useKbViewStats()`, `formatViews(n)`, `formatPeople(n)` and `formatCompleted(n)`;
  - the `<KbViewStats stats loading failed showCompleted? className? />` component.

- [ ] **Step 1: add the API client**

In `apps/admin/src/lib/api.ts`, after `reorderKbVideos`:

```ts
export interface KbViewStatsEntry {
  views_30d: number;
  users_30d: number;
  views_total: number;
  users_total: number;
  /** Videos only. */
  completed?: number;
}

export interface KbViewStatsResponse {
  /** Keyed by article uuid. Items with no views are absent. */
  articles: Record<string, KbViewStatsEntry>;
  /** Keyed by String(video id). */
  videos: Record<string, KbViewStatsEntry>;
}

export function getKbViewStats() {
  return adminApi<KbViewStatsResponse>('kb-view-stats');
}
```

- [ ] **Step 2: write the failing component test**

Create `apps/admin/src/components/__tests__/KbViewStats.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KbViewStats } from '../KbViewStats';

const stats = { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64, completed: 31 };

describe('KbViewStats', () => {
  it('shows 30-day views and people, then the all-time total', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} />);
    expect(screen.getByText('48 visualizações · 12 pessoas')).toBeInTheDocument();
    expect(screen.getByText('Total: 210 · 64 pessoas')).toBeInTheDocument();
    expect(screen.queryByText(/concluíram/)).not.toBeInTheDocument();
  });

  it('adds completions for videos', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} showCompleted />);
    expect(screen.getByText('Total: 210 · 64 pessoas · 31 concluíram')).toBeInTheDocument();
  });

  it('uses singulars', () => {
    render(
      <KbViewStats
        stats={{ views_30d: 1, users_30d: 1, views_total: 1, users_total: 1, completed: 1 }}
        loading={false}
        failed={false}
        showCompleted
      />,
    );
    expect(screen.getByText('1 visualização · 1 pessoa')).toBeInTheDocument();
    expect(screen.getByText('Total: 1 · 1 pessoa · 1 concluiu')).toBeInTheDocument();
  });

  it('formats thousands in pt-BR', () => {
    render(
      <KbViewStats
        stats={{ views_30d: 1200, users_30d: 2, views_total: 15000, users_total: 1500 }}
        loading={false}
        failed={false}
      />,
    );
    expect(screen.getByText('1.200 visualizações · 2 pessoas')).toBeInTheDocument();
    expect(screen.getByText('Total: 15.000 · 1.500 pessoas')).toBeInTheDocument();
  });

  it('shows the zero state when there are no stats', () => {
    render(<KbViewStats stats={undefined} loading={false} failed={false} />);
    expect(screen.getByText('Sem visualizações')).toBeInTheDocument();
  });

  it('renders nothing when the stats query failed', () => {
    const { container } = render(<KbViewStats stats={undefined} loading={false} failed />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the 30-day line for assistive tech', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} />);
    expect(screen.getByText('Últimos 30 dias:')).toHaveClass('sr-only');
  });
});
```

- [ ] **Step 3: run it and confirm it fails**

```bash
npx vitest run apps/admin/src/components/__tests__/KbViewStats.test.tsx
```

Expected: FAIL, because `../KbViewStats` cannot be resolved.

- [ ] **Step 4: implement the formatters, the hook and the component**

Create `apps/admin/src/lib/kb-view-stats.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { getKbViewStats } from './api';

export const KB_VIEW_STATS_KEY = ['admin', 'kb-view-stats'] as const;

/** Separate from the list queries: a failed or slow stats call never blocks the lists. */
export function useKbViewStats() {
  return useQuery({ queryKey: KB_VIEW_STATS_KEY, queryFn: getKbViewStats, staleTime: 60_000 });
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

export const formatViews = (n: number) =>
  n === 1 ? '1 visualização' : `${fmt(n)} visualizações`;
export const formatPeople = (n: number) => (n === 1 ? '1 pessoa' : `${fmt(n)} pessoas`);
export const formatCompleted = (n: number) => (n === 1 ? '1 concluiu' : `${fmt(n)} concluíram`);
```

Create `apps/admin/src/components/KbViewStats.tsx`:

```tsx
import type { KbViewStatsEntry } from '../lib/api';
import { formatCompleted, formatPeople, formatViews } from '../lib/kb-view-stats';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

interface KbViewStatsProps {
  stats: KbViewStatsEntry | undefined;
  loading: boolean;
  failed: boolean;
  /** Videos: append the completions count to the total line. */
  showCompleted?: boolean;
  className?: string;
}

/** One article's or video's view counts: last 30 days first, then all time. */
export function KbViewStats({ stats, loading, failed, showCompleted, className }: KbViewStatsProps) {
  if (loading) return <Skeleton className={cn('h-4 w-28', className)} />;
  if (failed) return null;
  if (!stats || stats.views_total === 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Sem visualizações</span>;
  }

  const total = [`Total: ${stats.views_total.toLocaleString('pt-BR')}`, formatPeople(stats.users_total)];
  if (showCompleted) total.push(formatCompleted(stats.completed ?? 0));

  return (
    <div className={cn('min-w-0 tabular-nums', className)}>
      <div className="text-sm" title="Últimos 30 dias">
        <span className="sr-only">Últimos 30 dias:</span>
        {`${formatViews(stats.views_30d)} · ${formatPeople(stats.users_30d)}`}
      </div>
      <div className="text-xs text-muted-foreground">{total.join(' · ')}</div>
    </div>
  );
}
```

`getByText('48 visualizações · 12 pessoas')` matches against the `div`'s own text node, so the `sr-only` sibling `span` doesn't break the match. If it does in practice, wrap the visible string in its own `<span>` and keep the test unchanged.

- [ ] **Step 5: run the component test and confirm it passes**

```bash
npx vitest run apps/admin/src/components/__tests__/KbViewStats.test.tsx
```

Expected: 7 passing tests.

- [ ] **Step 6: write the failing page tests**

In `apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`:

1. Replace the `vi.mock('../../lib/api', ...)` line with:

   ```ts
   vi.mock('../../lib/api', () => ({ listKbArticles: vi.fn(), getKbViewStats: vi.fn() }));
   ```

2. Change the import to `import { getKbViewStats, listKbArticles } from '../../lib/api';`.

3. In `beforeEach`, add:

   ```ts
     vi.mocked(getKbViewStats).mockResolvedValue({
       articles: { k1: { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64 } },
       videos: {},
     });
   ```

4. Add these tests inside `describe('KbArticlesPage', ...)`:

   ```tsx
     it('shows view counts per article and a zero state for unviewed ones', async () => {
       renderPage();
       expect((await screen.findAllByText('48 visualizações · 12 pessoas')).length).toBeGreaterThan(0);
       expect(screen.getAllByText('Total: 210 · 64 pessoas').length).toBeGreaterThan(0);
       expect(screen.getAllByText('Sem visualizações').length).toBeGreaterThan(0);
       expect(screen.getByText('Visualizações')).toBeInTheDocument();
     });

     it('still lists articles when the stats call fails', async () => {
       vi.mocked(getKbViewStats).mockRejectedValue(new Error('down'));
       renderPage();
       expect((await screen.findAllByRole('link', { name: 'Primeiro post' })).length).toBeGreaterThan(0);
       // Stats lines end in "· N pessoa(s)"; the "Visualizações" header must not count.
       expect(screen.queryByText(/· \d+ pessoas?$/)).not.toBeInTheDocument();
       expect(screen.queryByText('Sem visualizações')).not.toBeInTheDocument();
     });
   ```

In `apps/admin/src/pages/__tests__/KbVideosPage.test.tsx`:

1. Add `getKbViewStats: vi.fn(),` to the `vi.mock('../../lib/api', ...)` factory, and `getKbViewStats` to the import from `'../../lib/api'`.

2. In `beforeEach`, add:

   ```ts
     vi.mocked(getKbViewStats).mockResolvedValue({
       articles: {},
       videos: {
         '1': { views_30d: 5, users_30d: 4, views_total: 9, users_total: 7, completed: 3 },
       },
     });
   ```

3. Add inside `describe('KbVideosPage', ...)`:

   ```tsx
     it('shows view counts and completions per video', async () => {
       renderPage();
       expect(await screen.findByText('5 visualizações · 4 pessoas')).toBeInTheDocument();
       expect(screen.getByText('Total: 9 · 7 pessoas · 3 concluíram')).toBeInTheDocument();
       expect(screen.getByText('Sem visualizações')).toBeInTheDocument(); // video 2
     });

     it('still lists videos when the stats call fails', async () => {
       vi.mocked(getKbViewStats).mockRejectedValue(new Error('down'));
       renderPage();
       expect((await screen.findAllByRole('link', { name: 'Primeiro acesso' })).length).toBeGreaterThan(0);
       expect(screen.queryByText(/· \d+ pessoas?$/)).not.toBeInTheDocument();
     });
   ```

- [ ] **Step 7: run the page tests and confirm they fail**

```bash
npx vitest run apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx apps/admin/src/pages/__tests__/KbVideosPage.test.tsx
```

Expected: the new tests fail (no stats text, no "Visualizações" header), and the existing tests still pass.

- [ ] **Step 8: wire `KbArticlesPage`**

In `apps/admin/src/pages/KbArticlesPage.tsx`:

1. Add the imports:

   ```ts
   import { KbViewStats } from '../components/KbViewStats';
   import { useKbViewStats } from '../lib/kb-view-stats';
   ```

2. Inside the component, next to the existing `useQuery`:

   ```ts
     const viewStats = useKbViewStats();
   ```

3. In the header row, change `md:grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr]` to `md:grid-cols-[2fr_1fr_0.7fr_0.5fr_1.3fr_0.3fr]`, and insert `<span>Visualizações</span>` between `<span>Ordem</span>` and the trailing empty `<span></span>`.

4. In each row's desktop grid, make the same `grid-cols` change, and insert this between the `display_order` span and the pencil span:

   ```tsx
                     <KbViewStats
                       stats={viewStats.data?.articles[a.id]}
                       loading={viewStats.isLoading}
                       failed={viewStats.isError}
                     />
   ```

5. In the mobile block (`md:hidden`), after the category/badge `div`:

   ```tsx
                     <KbViewStats
                       stats={viewStats.data?.articles[a.id]}
                       loading={viewStats.isLoading}
                       failed={viewStats.isError}
                     />
   ```

- [ ] **Step 9: wire `KbVideosPage`**

In `apps/admin/src/pages/KbVideosPage.tsx`:

1. Add the same two imports as Step 8.

2. Inside the component, after `videosQuery`:

   ```ts
     const viewStats = useKbViewStats();
   ```

3. In each video row, directly after the closing `</div>` of the meta row (the `mt-1 flex flex-wrap ...` div holding duration and badges), still inside the `min-w-0` column:

   ```tsx
                             <KbViewStats
                               className="mt-1"
                               stats={viewStats.data?.videos[String(v.id)]}
                               loading={viewStats.isLoading}
                               failed={viewStats.isError}
                               showCompleted
                             />
   ```

- [ ] **Step 10: run the Admin tests and type check**

```bash
npx vitest run apps/admin && npx tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: all green, and `tsc` exits 0.

- [ ] **Step 11: commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/lib/kb-view-stats.ts apps/admin/src/components/KbViewStats.tsx apps/admin/src/components/__tests__/KbViewStats.test.tsx apps/admin/src/pages/KbArticlesPage.tsx apps/admin/src/pages/KbVideosPage.tsx apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx apps/admin/src/pages/__tests__/KbVideosPage.test.tsx
git commit -m "feat(admin): visualizações nas listas de artigos e vídeos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: full gate and browser check

**Files:** none new. Fix anything the gates flag in the files touched above.

- [ ] **Step 1: run every CI gate locally**

```bash
npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test && npm run check:functions && npm run test:functions
```

Expected: every command exits 0. If `format:check` fails, run `npm run format` and commit. Afterwards, `ls node_modules/.deno 2>/dev/null && npm ci`, and `git checkout deno.lock` if `test:functions` dirtied it.

- [ ] **Step 2: check the Admin layout in the browser**

The RPC and action don't exist on prod or staging yet, so drive the UI with a patched `fetch`:
1. Use **staging**, where the seed user is a `platform_admins` row. The worktree has no env files, so copy `.env.staging` from the main checkout (`cp /Users/eduardosouza/projects/sm-crm/.env.staging .env.staging`; confirm `git check-ignore .env.staging` prints it). Then `preview_start {name: "admin-staging"}` and read `preview_logs` for the real port (it binds 5177 even when the tool reports 5178). Log in with the seed-login flow in memory `reference_seed_login_browser_verification`, Admin variant: write the session json to `apps/admin/zz-seed-session.json`, fetch `/zz-seed-session.json`, then delete the file immediately; it is not gitignored. If that flow fails, ask the user to log in manually in the Browser pane.
2. Before navigating to `/admin/kb-articles`, patch `window.fetch` with `javascript_tool` so a POST body containing `"action":"kb-view-stats"` resolves to a canned payload, keyed by real ids from the `list-kb-articles` and `list-kb-videos` responses.
3. Check:
   - desktop at 1280px: the "Visualizações" column lines up with the header, and long numbers ("15.000") don't wrap;
   - mobile at 375px: the stats sit under the category badge, with no horizontal scroll;
   - `/admin/kb-videos`: the stats line sits under the badges;
   - an unviewed row reads "Sem visualizações";
   - dark mode: the muted text stays legible.
4. Take screenshots for the PR.

- [ ] **Step 3: commit any fixes**

```bash
git add -A apps supabase/functions supabase/migrations supabase/tests && git commit -m "fix: ajustes de lint/format/layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Skip this step if nothing changed. Never stage `supabase/config.toml` (colima port overrides), `.env*`, or `apps/admin/zz-seed-session.json`.

---

## Rollout (after review, not part of the tasks)

Merging deploys the frontends immediately, so the backend has to go out first:

1. Renumber the migration if `origin/main`'s tail has passed `20261001000001`.
2. Apply the migration to staging, then `npx supabase functions deploy platform-admin --project-ref wlyzhyfondykzpsiqsce --use-api`.
3. Apply the migration to prod, then deploy `platform-admin` to prod the same way, with `--project-ref skjzpekeqefvlojenfsw`. `supabase/config.toml` already sets `verify_jwt = false` for `platform-admin` (it checks the JWT itself), and the deploy picks that up.
4. Merge.
