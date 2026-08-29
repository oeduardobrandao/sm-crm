# Instagram Trial Reels ("Reel de teste") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users publish a reels post as an Instagram Trial Reel (shown only to non-followers) with a per-post graduation choice, end to end: DB column + trigger, publish pipeline (`trial_params`), CRM toggle/badges, Hub chips, and a new non-retryable error code.

**Architecture:** One nullable `ig_trial_strategy` column on `workflow_posts` (`'manual' | 'auto'`, NULL = normal post), guarded by a DB trigger (authoritative invariant) and a blocking media-shape validation. The strategy threads through every container-creation path into `createVideoContainer`, which adds `trial_params` to the Graph API body. Spec: `docs/superpowers/specs/2026-08-28-instagram-trial-reels-design.md`.

**Tech Stack:** Postgres migration (Supabase), Deno edge functions, React 19 + shadcn (CRM/Hub), Vitest, `deno test`, psql SQL suite.

## Global Constraints

- UI copy contains NO em-dashes (house rule; `publishErrorCopy.ts` header states it).
- Edge functions are Deno: imports use `npm:` specifiers or relative `.ts` paths.
- Migration version prefix must be unique vs `origin/main` (`migration-version-guard` CI job). Re-verify at PR-open time: `git ls-tree origin/main:supabase/migrations --name-only | tail`. The plan uses `20260828000010` (prefix `20260828000001` was used by a since-deleted file and may exist in remote `schema_migrations`; do not reuse it).
- `deno test` runs dirty the root `deno.lock`: run `git checkout -- deno.lock` after each Deno test step, before committing.
- `npm run build` typechecks only the CRM. CI typechecks four projects: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`.
- Meta wire format (decided in spec): `trial_params` is a JSON-encoded STRING in the container body: `JSON.stringify({ graduation_strategy: "MANUAL" | "SS_PERFORMANCE" })`. DB values map `'manual'→"MANUAL"`, `'auto'→"SS_PERFORMANCE"`.
- Commit messages in pt-BR conventional style (see `git log`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All file paths below are relative to the repo root (this worktree). Do NOT touch files outside it.

---

### Task 1: Migration — column, trigger, claim RPC redefinition + SQL test

**Files:**
- Create: `supabase/migrations/20260828000010_ig_trial_reels.sql`
- Create: `supabase/tests/entitlements/30_ig_trial_strategy.sql`

**Interfaces:**
- Consumes: current canonical `claim_posts_for_publishing` body from `supabase/migrations/20260807000002_claim_skip_nonretryable.sql` (copied below with exactly THREE edits).
- Produces: `workflow_posts.ig_trial_strategy text NULL CHECK IN ('manual','auto')`; trigger `workflow_posts_z5_clear_ig_trial`; RPC now returns `ig_trial_strategy` and its retry phase skips `'TRIAL_INELIGIBLE'`.

- [ ] **Step 1: Verify the version prefix is free**

Run: `ls supabase/migrations | grep 20260828; git ls-tree origin/main:supabase/migrations --name-only | tail -3`
Expected: no local `20260828000010_*` file; main's tail is `20260826000003_...` (or later — if later than `20260828000010`, bump the prefix above it).

- [ ] **Step 2: Write the SQL test (failing first — file runs against a DB without the column)**

Create `supabase/tests/entitlements/30_ig_trial_strategy.sql` (the runner `scripts/test-entitlements.sh` auto-discovers `[0-9]*.sql`):

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_post bigint; v_s text;
begin
  v_ws := et_make_workspace('pro');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  -- reels + instagram keeps the flag
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, ig_trial_strategy)
    values (v_wf, v_ws, 'P', 'reels', 'instagram', 'auto') returning id into v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s = 'auto', format('flag must survive on reels+instagram, got %s', v_s);

  -- tipo leaves reels => trigger clears it on the SAME update
  update workflow_posts set tipo = 'carrossel' where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear when tipo leaves reels';

  -- reels + both keeps it
  update workflow_posts set tipo = 'reels', platform = 'both', ig_trial_strategy = 'manual'
    where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s = 'manual', 'flag must survive on reels+both';

  -- platform tiktok-only clears it
  update workflow_posts set platform = 'tiktok' where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear on tiktok-only';

  -- insert on a non-reels tipo is cleared at insert
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, ig_trial_strategy)
    values (v_wf, v_ws, 'P2', 'feed', 'auto') returning id into v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear at insert on non-reels tipo';

  raise notice 'PASS 30_ig_trial_strategy';
end $$;
rollback;
```

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260828000010_ig_trial_reels.sql`:

```sql
-- =====================================================================
-- 20260828000010_ig_trial_reels.sql
-- Reel de teste (Instagram Trial Reels).
-- 1) Coluna workflow_posts.ig_trial_strategy (NULL = post normal).
-- 2) Trigger que limpa a flag quando o post deixa de ser reels ou deixa
--    de mirar o Instagram (invariante autoritativa; o self-heal da UI é
--    só cortesia).
-- 3) claim_posts_for_publishing: shape muda (nova coluna no RETURNS
--    TABLE), então DROP + CREATE. Corpo copiado de 20260807000002 com
--    DUAS edições no corpo (ig_trial_strategy no SELECT final e
--    'TRIAL_INELIGIBLE' no NOT IN do retry). Este arquivo passa a ser a
--    definição canônica.
-- =====================================================================

ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS ig_trial_strategy text
  CHECK (ig_trial_strategy IN ('manual', 'auto'));

COMMENT ON COLUMN workflow_posts.ig_trial_strategy IS
  'Reel de teste (Instagram trial reel). NULL = post normal; manual = graduação manual no app do Instagram; auto = SS_PERFORMANCE (Instagram compartilha com todos se performar bem).';

CREATE OR REPLACE FUNCTION workflow_posts_clear_ig_trial()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ig_trial_strategy IS NOT NULL
     AND (NEW.tipo <> 'reels'
          OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram', 'both')) THEN
    NEW.ig_trial_strategy := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_posts_z5_clear_ig_trial ON workflow_posts;
CREATE TRIGGER workflow_posts_z5_clear_ig_trial
  BEFORE INSERT OR UPDATE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION workflow_posts_clear_ig_trial();

DROP FUNCTION IF EXISTS claim_posts_for_publishing(text, integer);
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
  story_segments jsonb,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint,
  ig_trial_strategy text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      wp.platform IN ('instagram','both')
      AND CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND wp.instagram_media_id IS NULL
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NULL)
            OR (wp.tipo = 'stories' AND (
              wp.story_segments IS NULL
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
            ))
          )
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND wp.instagram_media_id IS NULL
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NOT NULL)
            OR (wp.tipo = 'stories'
              AND wp.story_segments IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'media_id' IS NULL
              )
            )
          )
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
          AND wp.instagram_media_id IS NULL
          AND (wp.publish_error_code IS NULL
               OR wp.publish_error_code NOT IN
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED','TRIAL_INELIGIBLE'))
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
    u.story_segments,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    c.id AS client_id,
    u.ig_trial_strategy
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
-- REVOKE FROM PUBLIC also strips service_role; the explicit re-grant is load-bearing.
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;
```

- [ ] **Step 4: Run the SQL suite locally if Docker/colima is available; otherwise rely on CI**

Run: `colima status && supabase start && bash scripts/test-entitlements.sh` (from repo root).
Expected: `PASS 30_ig_trial_strategy` among the passes. If colima/Docker is unavailable, note it and continue — the `entitlement-tests` CI job runs this suite either way. (Parallel worktrees fight over Supabase's default ports; see memory note before `supabase start`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828000010_ig_trial_reels.sql supabase/tests/entitlements/30_ig_trial_strategy.sql
git commit -m "feat(migrations): coluna ig_trial_strategy, trigger de invariante e claim RPC com trial"
```

---

### Task 2: `TRIAL_INELIGIBLE` error code — edge + CRM mirrors

**Files:**
- Modify: `supabase/functions/_shared/publish-error-codes.ts`
- Modify: `apps/crm/src/pages/entregas/publishErrorCopy.ts`
- Test: `supabase/functions/__tests__/publish-error-codes_test.ts` (extend)
- Test: `apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts` (extend)

**Interfaces:**
- Produces: `TRIAL_MEDIA_SHAPE_ERROR` exported from `publish-error-codes.ts` (Task 3 imports it into `instagram-publish-utils.ts`); `"TRIAL_INELIGIBLE"` in `PublishErrorCode` (both files), in `NON_RETRYABLE_CODES`, and classified from the media-shape message.
- The classifier lowercases messages: the match pattern is lowercase.

- [ ] **Step 1: Write the failing Deno test**

Append to `supabase/functions/__tests__/publish-error-codes_test.ts` (follow the file's existing import of `classifyPublishError` / `NON_RETRYABLE_CODES`):

```ts
Deno.test("classifyPublishError: media-shape trial error → TRIAL_INELIGIBLE", () => {
  const code = classifyPublishError(
    new Error("Reel de teste exige exatamente um vídeo. Ajuste a mídia ou desligue o Reel de teste."),
  );
  assertEquals(code, "TRIAL_INELIGIBLE");
});

Deno.test("TRIAL_INELIGIBLE is non-retryable and has copy", () => {
  assert(NON_RETRYABLE_CODES.includes("TRIAL_INELIGIBLE"));
  assert(PUBLISH_ERROR_COPY.TRIAL_INELIGIBLE.titulo.length > 0);
});
```

(If the file does not already import `NON_RETRYABLE_CODES`/`PUBLISH_ERROR_COPY`, add them to its import from `../_shared/publish-error-codes.ts`.)

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all supabase/functions/__tests__/publish-error-codes_test.ts && git checkout -- deno.lock`
Expected: FAIL (TRIAL_INELIGIBLE not defined / classified UNKNOWN).

- [ ] **Step 3: Implement the edge side**

In `supabase/functions/_shared/publish-error-codes.ts`:

1. Add to the `PublishErrorCode` union, after `"MEDIA_UNSUPPORTED"`:
```ts
  | "TRIAL_INELIGIBLE"
```
2. Add `"TRIAL_INELIGIBLE",` to `NON_RETRYABLE_CODES` (after `"MEDIA_UNSUPPORTED",`).
3. Export the canonical media-shape message (Task 3's guard throws it; keeping message and classifier in one module guarantees they stay in sync):
```ts
/** Lançada pelos guards de publicação quando um post com Reel de teste não é
 * exatamente um vídeo com tipo reels. O classificador abaixo casa com ela —
 * não reformular sem atualizar o padrão. */
export const TRIAL_MEDIA_SHAPE_ERROR =
  "Reel de teste exige exatamente um vídeo. Ajuste a mídia ou desligue o Reel de teste.";
```
4. In `classifyPublishError`, after the `MEDIA_UNSUPPORTED` block and before `CONTAINER_EXPIRED`:
```ts
  // Tier 1 (determinístico): nossa própria guarda de formato de mídia.
  // Tier 2 (Meta: conta <1.000 seguidores etc.) só entra quando o erro real
  // for capturado em staging/prod — não inventar regex para wording da Meta;
  // até lá cai em UNKNOWN (comportamento definido no spec).
  if (msg.includes("reel de teste exige exatamente um vídeo")) return "TRIAL_INELIGIBLE";
```
5. Add to `PUBLISH_ERROR_COPY`:
```ts
  TRIAL_INELIGIBLE: {
    titulo: "Reel de teste não aceito",
    explicacao:
      "O post precisa de exatamente um vídeo e a conta precisa ser profissional, pública e ter 1.000+ seguidores. Ajuste o post ou a conta, ou desligue o Reel de teste, e tente novamente.",
  },
```

- [ ] **Step 4: Write the failing CRM test**

In `apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts`, add `'TRIAL_INELIGIBLE'` to the `ALL_CODES` array (the "todo código tem copy completa" test then covers it) and append:

```ts
  it('TRIAL_INELIGIBLE esconde o detalhe cru e oferece retry', () => {
    const d = PUBLISH_ERROR_COPY.TRIAL_INELIGIBLE;
    expect(d.acao).toBe('retry');
    expect(d.mostrarDetalhes).toBe(false);
  });
```

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts`
Expected: FAIL (code missing from the CRM map).

- [ ] **Step 5: Implement the CRM mirror**

In `apps/crm/src/pages/entregas/publishErrorCopy.ts`: add `| 'TRIAL_INELIGIBLE'` to its local `PublishErrorCode` union and the map entry:

```ts
  TRIAL_INELIGIBLE: {
    titulo: 'Reel de teste não aceito',
    explicacao:
      'O post precisa de exatamente um vídeo e a conta precisa ser profissional, pública e ter 1.000+ seguidores. Ajuste o post ou a conta, ou desligue o Reel de teste, e tente novamente.',
    acao: 'retry',
    mostrarDetalhes: false,
  },
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `deno test --allow-all supabase/functions/__tests__/publish-error-codes_test.ts && git checkout -- deno.lock && npx vitest run apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/publish-error-codes.ts apps/crm/src/pages/entregas/publishErrorCopy.ts supabase/functions/__tests__/publish-error-codes_test.ts apps/crm/src/pages/entregas/__tests__/publishErrorCopy.test.ts
git commit -m "feat(publicacao): código TRIAL_INELIGIBLE não-retryable com copy nos dois espelhos"
```

---

### Task 3: Publish utils — validation, container guard, `trial_params`

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts`
- Test: `supabase/functions/__tests__/instagram-publish-container_test.ts` (extend)
- Test: `supabase/functions/__tests__/instagram-publish-validate_test.ts` (extend)
- Test: `supabase/functions/__tests__/instagram-publish-cover_test.ts` (extend)

**Interfaces:**
- Consumes: `TRIAL_MEDIA_SHAPE_ERROR` from `../_shared/publish-error-codes.ts` (Task 2).
- Produces (Task 4 callers rely on these exact signatures):
  - `export type IgTrialStrategy = "manual" | "auto";`
  - `createVideoContainer(igUserId: string, token: string, videoUrl: string, caption: string, coverUrl?: string, trialStrategy?: IgTrialStrategy | null)`
  - `createContainerForPost(db, opts: { igUserId; token; postId; caption; useCover; tipo?; trialStrategy?: string | null })` — throws `TRIAL_MEDIA_SHAPE_ERROR` when `trialStrategy` is set but the post is not (tipo `reels` AND exactly one video).
  - `validateForScheduling` post select now includes `ig_trial_strategy` and pushes `TRIAL_MEDIA_SHAPE_ERROR` for non-qualifying flagged posts.

- [ ] **Step 1: Write the failing container tests**

Append to `supabase/functions/__tests__/instagram-publish-container_test.ts` (uses the file's existing `stubFetch`, `dbWithMedia`, and `base = { igUserId, token, postId, caption }` helpers):

```ts
Deno.test("createContainerForPost: trial 'auto' single video reels → trial_params SS_PERFORMANCE", async () => {
  const f = stubFetch();
  try {
    await createContainerForPost(dbWithMedia([{ kind: "video", r2_key: "v.mp4" }]), {
      ...base, tipo: "reels", trialStrategy: "auto", useCover: false,
    });
    assertEquals(
      f.calls[0].body.trial_params,
      JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }),
    );
  } finally { f.restore(); }
});

Deno.test("createContainerForPost: trial 'manual' → trial_params MANUAL", async () => {
  const f = stubFetch();
  try {
    await createContainerForPost(dbWithMedia([{ kind: "video", r2_key: "v.mp4" }]), {
      ...base, tipo: "reels", trialStrategy: "manual", useCover: false,
    });
    assertEquals(
      f.calls[0].body.trial_params,
      JSON.stringify({ graduation_strategy: "MANUAL" }),
    );
  } finally { f.restore(); }
});

Deno.test("createContainerForPost: sem trial → sem trial_params", async () => {
  const f = stubFetch();
  try {
    await createContainerForPost(dbWithMedia([{ kind: "video", r2_key: "v.mp4" }]), {
      ...base, tipo: "reels", useCover: false,
    });
    assert(!("trial_params" in f.calls[0].body), "trial_params must be absent");
  } finally { f.restore(); }
});

Deno.test("createContainerForPost: trial em carrossel → lança TRIAL_MEDIA_SHAPE_ERROR", async () => {
  const f = stubFetch();
  try {
    let threw = "";
    try {
      await createContainerForPost(
        dbWithMedia([{ kind: "image", r2_key: "a.jpg" }, { kind: "image", r2_key: "b.jpg" }]),
        { ...base, tipo: "reels", trialStrategy: "auto", useCover: false },
      );
    } catch (e) { threw = (e as Error).message; }
    assertEquals(threw, TRIAL_MEDIA_SHAPE_ERROR);
    assertEquals(f.calls.length, 0, "must throw before any Graph call");
  } finally { f.restore(); }
});

Deno.test("createContainerForPost: trial em imagem única → lança", async () => {
  const f = stubFetch();
  try {
    let threw = "";
    try {
      await createContainerForPost(dbWithMedia([{ kind: "image", r2_key: "a.jpg" }]), {
        ...base, tipo: "reels", trialStrategy: "auto", useCover: false,
      });
    } catch (e) { threw = (e as Error).message; }
    assertEquals(threw, TRIAL_MEDIA_SHAPE_ERROR);
  } finally { f.restore(); }
});

Deno.test("createContainerForPost: trial com tipo feed (vídeo único) → lança", async () => {
  const f = stubFetch();
  try {
    let threw = "";
    try {
      await createContainerForPost(dbWithMedia([{ kind: "video", r2_key: "v.mp4" }]), {
        ...base, tipo: "feed", trialStrategy: "auto", useCover: false,
      });
    } catch (e) { threw = (e as Error).message; }
    assertEquals(threw, TRIAL_MEDIA_SHAPE_ERROR);
  } finally { f.restore(); }
});
```

Add to the test file's imports: `TRIAL_MEDIA_SHAPE_ERROR` from `../_shared/publish-error-codes.ts`.

- [ ] **Step 2: Write the failing `createVideoContainer` test**

Append to `supabase/functions/__tests__/instagram-publish-cover_test.ts`:

```ts
Deno.test("createVideoContainer: trialStrategy adiciona trial_params (string JSON)", async () => {
  const f = stubFetch(ok);
  try {
    await createVideoContainer("ig-1", "tok", "https://v/video.mp4", "cap", undefined, "auto");
    assertEquals(
      f.calls[0].body.trial_params,
      JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }),
    );
  } finally { f.restore(); }
});

Deno.test("createVideoContainer: sem trialStrategy → sem trial_params", async () => {
  const f = stubFetch(ok);
  try {
    await createVideoContainer("ig-1", "tok", "https://v/video.mp4", "cap");
    assert(!("trial_params" in f.calls[0].body), "trial_params must be absent");
  } finally { f.restore(); }
});
```

- [ ] **Step 3: Write the failing validation test**

Append to `supabase/functions/__tests__/instagram-publish-validate_test.ts`. Its `seed(db, count, tipo?)` helper queues the post row without the flag, so queue rows inline for these:

```ts
function videoLink(i: number) {
  return {
    sort_order: i,
    files: {
      id: i + 1, kind: "video", mime_type: "video/mp4", size_bytes: 10_000_000,
      width: 1080, height: 1920, duration_seconds: 30, r2_key: `vid/${i}.mp4`,
    },
  };
}

function seedTrial(db: ReturnType<typeof createSupabaseQueryMock>, opts: {
  tipo: string; links: unknown[]; strategy: string | null;
}) {
  db.queue("workflow_posts", "select", {
    data: {
      id: 1, scheduled_at: null, ig_caption: "cap", workflow_id: 9,
      tipo: opts.tipo, ig_trial_strategy: opts.strategy,
    },
    error: null,
  });
  db.queue("post_file_links", "select", { data: opts.links, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 5 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: null, instagram_user_id: "ig",
      token_expires_at: null, authorization_status: "active",
    },
    error: null,
  });
}

Deno.test("validateForScheduling: trial em carrossel → erro de formato", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [link(0), link(1)], strategy: "auto" });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "trial on 2 media must fail");
  assert(res.errors.includes(TRIAL_MEDIA_SHAPE_ERROR), "must carry the trial shape error");
});

Deno.test("validateForScheduling: trial em vídeo único reels → ok", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [videoLink(0)], strategy: "manual" });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.ok, `expected ok, got: ${res.errors.join(" | ")}`);
});

Deno.test("validateForScheduling: sem trial não adiciona o erro", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [link(0), link(1)], strategy: null });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.includes(TRIAL_MEDIA_SHAPE_ERROR), "shape error only when flagged");
});
```

Add `TRIAL_MEDIA_SHAPE_ERROR` to the file's imports from `../_shared/publish-error-codes.ts`.

- [ ] **Step 4: Run all three test files to verify they fail**

Run: `deno test --allow-all supabase/functions/__tests__/instagram-publish-container_test.ts supabase/functions/__tests__/instagram-publish-cover_test.ts supabase/functions/__tests__/instagram-publish-validate_test.ts && git checkout -- deno.lock`
Expected: FAIL (unknown option `trialStrategy`, missing `trial_params`).

- [ ] **Step 5: Implement in `instagram-publish-utils.ts`**

1. Import the constant near the top (the module has no import of publish-error-codes today; adding one creates no cycle — publish-error-codes imports nothing):
```ts
import { TRIAL_MEDIA_SHAPE_ERROR } from "./publish-error-codes.ts";
```
2. Export the strategy type:
```ts
export type IgTrialStrategy = "manual" | "auto";
```
3. `validateForScheduling`: change the post select to
```ts
.select("id, scheduled_at, ig_caption, workflow_id, tipo, ig_trial_strategy")
```
and, immediately after the media-errors block (`for (const e of mediaErrors) errors.push(e.message);` and its enclosing `else`), add:
```ts
  // Reel de teste: formato obrigatório (spec 2026-08-28). Com 0 mídias o
  // erro NO_MEDIA acima já cobre; o check roda só quando há mídia.
  if (post.ig_trial_strategy && mediaFiles.length > 0) {
    const isSingleVideo = mediaFiles.length === 1 && mediaFiles[0].kind === "video";
    if (post.tipo !== "reels" || !isSingleVideo) errors.push(TRIAL_MEDIA_SHAPE_ERROR);
  }
```
4. `createVideoContainer`: add the sixth parameter and body field:
```ts
export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string,
  trialStrategy?: IgTrialStrategy | null,
): Promise<{ id: string }> {
  const body: Record<string, string> = {
    video_url: videoUrl,
    caption,
    media_type: "REELS",
    access_token: token,
  };
  if (coverUrl) body.cover_url = coverUrl;
  if (trialStrategy) {
    body.trial_params = JSON.stringify({
      graduation_strategy: trialStrategy === "auto" ? "SS_PERFORMANCE" : "MANUAL",
    });
  }
  // ... (fetch unchanged)
```
5. `createContainerForPost`: extend opts with `trialStrategy?: string | null`. The function already fetches media before the stories branch (`const media = await fetchPostMedia(db, postId);` on the line after the opts destructure, then `if (tipo === "stories")`). Insert the guard between those two, so it runs for EVERY tipo before any Graph call:
```ts
  // Reel de teste nunca degrada em silêncio para post normal: o cliente
  // aprovou um teste. Fora do formato exato (reels + 1 vídeo), falha alto —
  // a mensagem classifica como TRIAL_INELIGIBLE (não-retryable).
  const trial: IgTrialStrategy | null =
    opts.trialStrategy === "manual" || opts.trialStrategy === "auto" ? opts.trialStrategy : null;
  if (trial && (tipo !== "reels" || media.length !== 1 || media[0].kind !== "video")) {
    throw new Error(TRIAL_MEDIA_SHAPE_ERROR);
  }
```
6. Thread into the single-video call:
```ts
  if (isSingleVideo) {
    const url = await signGetUrl(media[0].r2_key, 7200);
    const thumbKey = useCover ? media[0].thumbnail_r2_key : null;
    const coverUrl = thumbKey ? await signGetUrl(thumbKey, 7200) : undefined;
    const container = await createVideoContainer(igUserId, token, url, caption, coverUrl, trial);
    return { containerId: container.id, coverVideoUrl: coverUrl ? url : undefined };
  }
```

- [ ] **Step 6: Run the three test files to verify they pass**

Run: `deno test --allow-all supabase/functions/__tests__/instagram-publish-container_test.ts supabase/functions/__tests__/instagram-publish-cover_test.ts supabase/functions/__tests__/instagram-publish-validate_test.ts && git checkout -- deno.lock`
Expected: PASS, including all pre-existing tests (no regressions).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-container_test.ts supabase/functions/__tests__/instagram-publish-cover_test.ts supabase/functions/__tests__/instagram-publish-validate_test.ts
git commit -m "feat(instagram-publish): trial_params no container de reels com guarda de formato"
```

---

### Task 4: Edge callers — instagram-publish handler and cron

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts`
- Modify: `supabase/functions/instagram-publish-cron/index.ts`
- Test: `supabase/functions/__tests__/instagram-publish-cover_test.ts` (already covers `createVideoContainer`; this task's risk is call sites, covered by the greps below)

**Test-coverage note (deliberate deviation from the spec's test list):** the spec asks for a test that the publish-now coverless retry preserves `trial_params`. The retry's *mechanism* is covered by Task 3's `createVideoContainer` trial test; the *call site* is one argument in `handler.ts`, verified by Step 4's grep. A handler-level harness test of the full publish-now → poll ERROR → retry flow would need decryptable tokens, four validation queues, and container-status fetch stubbing — the repo deliberately tests the cover retry at the `createVideoContainer` level (`instagram-publish-cover_test.ts`), and this plan follows that pattern. If the reviewer wants the full-flow test anyway, model it on `instagram-publish-gate_test.ts`'s `makeHandler`/`setupPostAndProfile` harness.

**Interfaces:**
- Consumes: `createContainerForPost` `trialStrategy` opt and `createVideoContainer` sixth param (Task 3); `ig_trial_strategy` in the claim RPC result (Task 1).
- Produces: every container-creation call site passes the strategy.

- [ ] **Step 1: Update the handler's post select**

In `supabase/functions/instagram-publish/handler.ts`, the post fetch near the top of the request handling (`.select("id, status, workflow_id, scheduled_at, ig_caption, instagram_container_id, publish_retry_count, tipo")`) becomes:

```ts
      .select("id, status, workflow_id, scheduled_at, ig_caption, instagram_container_id, publish_retry_count, tipo, ig_trial_strategy")
```

- [ ] **Step 2: Pass the strategy at all three handler call sites**

1. **Schedule front-load** (inside `if (action === "schedule")`, the `createContainerForPost` call): add `trialStrategy: post.ig_trial_strategy,` to the opts object.
2. **Publish-now initial container** (inside `if (action === "publish-now")`, the `createContainerForPost` call): add `trialStrategy: post.ig_trial_strategy,` to the opts object.
3. **Publish-now immediate coverless retry** (the `if (containerStatus === "ERROR" && coverVideoUrl)` block). This call bypasses `createContainerForPost`, so trial must be passed explicitly or it is dropped exactly when a cover fails:
```ts
        if (containerStatus === "ERROR" && coverVideoUrl) {
          const trial = post.ig_trial_strategy === "manual" || post.ig_trial_strategy === "auto"
            ? post.ig_trial_strategy
            : null;
          const retry = await createVideoContainer(
            igUserId, token, coverVideoUrl, post.ig_caption, undefined, trial,
          );
```
(keep the rest of the block unchanged).

- [ ] **Step 3: Update the cron**

In `supabase/functions/instagram-publish-cron/index.ts`:
1. Add to the `ClaimedPost` interface (after `story_segments`):
```ts
  ig_trial_strategy: string | null;
```
2. In `processContainerCreation`, add `trialStrategy: post.ig_trial_strategy,` to the `createContainerForPost` opts. (The cron's deferred coverless retry is this same function on a later cycle with `useCover:false`, so this one edit covers it.)

- [ ] **Step 4: Verify no call site was missed**

Run: `grep -rn "createContainerForPost(\|createVideoContainer(" supabase/functions --include="*.ts" | grep -v __tests__ | grep -v "_shared/instagram-publish-utils.ts"`
Expected: every listed call passes a trial argument (handler x3 via opts/param, cron x1). Any other hit is a missed site — fix it the same way.

- [ ] **Step 5: Run the full Deno suite**

Run: `npm run test:functions && git checkout -- deno.lock`
Expected: PASS (existing cron/handler tests unaffected; TypeScript in tests catches a missing `ig_trial_strategy` on `ClaimedPost` literals if any test builds one — update such fixtures with `ig_trial_strategy: null`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts supabase/functions/instagram-publish-cron/index.ts
git commit -m "feat(instagram-publish): propagar ig_trial_strategy no handler e no cron"
```

---

### Task 5: CRM store and types

**Files:**
- Modify: `apps/crm/src/store/posts.ts`

**Interfaces:**
- Produces: `WorkflowPost['ig_trial_strategy']?: 'manual' | 'auto' | null` (Tasks 6-7 read it; `onFieldChange` is typed `keyof WorkflowPost`, so the drawer toggle compiles only after this); `ScheduledPost`/`ActivePost.ig_trial_strategy: 'manual' | 'auto' | null`.
- `getWorkflowPosts` uses `select('*')`, so the drawer receives the column automatically; only the type and the explicit `POST_CONTEXT_COLUMNS` surfaces need edits.

- [ ] **Step 1: Contract sweep (house rule)**

Run: `grep -rn "POST_CONTEXT_COLUMNS\|tiktok_post_url, instagram_media_id" apps/crm/src/__tests__ apps/crm/src/pages/entregas --include="*.test.*"`
Expected: note any test asserting the select-string shape; update them in Step 2 alongside the change (none existed at plan time).

- [ ] **Step 2: Implement**

In `apps/crm/src/store/posts.ts`:
1. In `WorkflowPost` (after `is_express`):
```ts
  /** Reel de teste (Instagram trial reel). NULL/undefined = post normal.
   * 'auto' = SS_PERFORMANCE (graduação automática), 'manual' = graduação no
   * app. Só válido em tipo 'reels' mirando Instagram; o trigger
   * workflow_posts_z5_clear_ig_trial limpa fora disso. */
  ig_trial_strategy?: 'manual' | 'auto' | null;
```
2. In `ScheduledPost` (after `instagram_media_id`):
```ts
  ig_trial_strategy: 'manual' | 'auto' | null;
```
3. Append `, ig_trial_strategy` to `POST_CONTEXT_COLUMNS`.
4. In `mapPostContextRow`, after `instagram_media_id`:
```ts
    ig_trial_strategy: row.ig_trial_strategy ?? null,
```
5. `ClientePost` feeds `CalendarPostDetailPanel` (its `post` prop is typed `ClientePost`), so the calendar badge (Task 7) needs the field here too. In `ClientePost` (after `platform`):
```ts
  ig_trial_strategy?: 'manual' | 'auto' | null;
```
6. In `getClientePosts`: add `ig_trial_strategy` to the select string (after `platform`) and to the row mapper:
```ts
    ig_trial_strategy: row.ig_trial_strategy ?? null,
```

- [ ] **Step 3: Typecheck + run store tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/__tests__/store.core.test.ts apps/crm/src/__tests__/store.crud-writes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/posts.ts
git commit -m "feat(crm): ig_trial_strategy nos tipos e selects de posts"
```

---

### Task 6: TrialReelPanel + WorkflowDrawer wiring

**Files:**
- Create: `apps/crm/src/pages/entregas/components/TrialReelPanel.tsx`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/TrialReelPanel.test.tsx`

**Interfaces:**
- Consumes: `WorkflowPost.ig_trial_strategy` (Task 5); drawer locals `post`, `postMedia`, `isScheduleLocked`, `hasInstagramAccount`, `onFieldChange` (all already in scope where `TikTokSettingsPanel` mounts).
- Produces: `<TrialReelPanel post media disabled onFieldChange />`, self-hiding on non-reels/TikTok-only posts.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/TrialReelPanel.test.tsx` (mirror `PlatformSelector.test.tsx`'s render/setup conventions — same imports of `render`/`screen` and any shared test setup used there):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrialReelPanel } from '../TrialReelPanel';
import type { PostMedia, WorkflowPost } from '../../../../store';

function makePost(over: Partial<WorkflowPost> = {}): WorkflowPost {
  return {
    workflow_id: 1,
    titulo: 'P',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'reels',
    ordem: 0,
    status: 'rascunho',
    platform: 'instagram',
    ig_trial_strategy: null,
    ...over,
  } as WorkflowPost;
}

const videoMedia = [{ id: 1, post_id: 1, kind: 'video' }] as unknown as PostMedia[];
const imageMedia = [{ id: 1, post_id: 1, kind: 'image' }] as unknown as PostMedia[];

describe('TrialReelPanel', () => {
  it('renderiza o switch em post reels/instagram', () => {
    render(
      <TrialReelPanel post={makePost()} media={videoMedia} disabled={false} onFieldChange={vi.fn()} />,
    );
    expect(screen.getByText('Reel de teste')).toBeTruthy();
  });

  it('não renderiza fora de reels', () => {
    const { container } = render(
      <TrialReelPanel post={makePost({ tipo: 'feed' })} media={videoMedia} disabled={false} onFieldChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('não renderiza em post só-TikTok', () => {
    const { container } = render(
      <TrialReelPanel post={makePost({ platform: 'tiktok' })} media={videoMedia} disabled={false} onFieldChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('ligar o switch grava auto por padrão', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel post={makePost()} media={videoMedia} disabled={false} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', 'auto');
  });

  it('desligar o switch grava null', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel post={makePost({ ig_trial_strategy: 'auto' })} media={videoMedia} disabled={false} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', null);
  });

  it('escolha de graduação grava manual', () => {
    const onFieldChange = vi.fn();
    render(
      <TrialReelPanel post={makePost({ ig_trial_strategy: 'auto' })} media={videoMedia} disabled={false} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByText('Eu decido manualmente no app do Instagram'));
    expect(onFieldChange).toHaveBeenCalledWith('ig_trial_strategy', 'manual');
  });

  it('desabilita tudo enquanto agendado', () => {
    render(
      <TrialReelPanel post={makePost({ ig_trial_strategy: 'auto' })} media={videoMedia} disabled onFieldChange={vi.fn()} />,
    );
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cancelar agendamento para editar')).toBeTruthy();
  });

  it('mostra o aviso quando a mídia não qualifica', () => {
    render(
      <TrialReelPanel post={makePost({ ig_trial_strategy: 'auto' })} media={imageMedia} disabled={false} onFieldChange={vi.fn()} />,
    );
    expect(screen.getByText('Reel de teste exige exatamente um vídeo no post.')).toBeTruthy();
  });
});
```

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TrialReelPanel.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 2: Implement the component**

Create `apps/crm/src/pages/entregas/components/TrialReelPanel.tsx`:

```tsx
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PostMedia, WorkflowPost } from '../../../store';

interface TrialReelPanelProps {
  post: WorkflowPost;
  media: PostMedia[];
  /** isScheduleLocked do drawer: o cron cria o container até 1h antes do
   * horário, então a estratégia trava junto com data e legenda. */
  disabled: boolean;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
}

/**
 * Reel de teste (Instagram Trial Reel): visível só para não-seguidores até a
 * "graduação". Renderiza apenas em posts reels mirando Instagram; o trigger
 * workflow_posts_z5_clear_ig_trial garante a invariante no banco.
 */
export function TrialReelPanel({ post, media, disabled, onFieldChange }: TrialReelPanelProps) {
  if (post.tipo !== 'reels' || (post.platform ?? 'instagram') === 'tiktok') return null;

  const strategy = post.ig_trial_strategy ?? null;
  const enabled = strategy !== null;
  const mediaQualifies = media.length === 1 && media[0]?.kind === 'video';

  return (
    <div className="drawer-post-field drawer-post-field--trial">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="trial-reel-switch">Reel de teste</label>
        <Switch
          id="trial-reel-switch"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(on) => onFieldChange('ig_trial_strategy', on ? 'auto' : null)}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-light)' }}>
        Publica como teste, visível só para quem não segue a conta.
      </p>
      {enabled && (
        <>
          <ToggleGroup
            type="single"
            value={strategy}
            disabled={disabled}
            className="mt-2 flex-col items-stretch gap-1"
            onValueChange={(v) => {
              if (v === 'auto' || v === 'manual') onFieldChange('ig_trial_strategy', v);
            }}
          >
            <ToggleGroupItem value="auto" className="justify-start text-left">
              Compartilhar com todos automaticamente se performar bem
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className="justify-start text-left">
              Eu decido manualmente no app do Instagram
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-light)' }}>
            Exige conta profissional pública com pelo menos 1.000 seguidores. Não funciona com
            colaboradores no post.
          </p>
          {!mediaQualifies && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger-text)' }}>
              Reel de teste exige exatamente um vídeo no post.
            </p>
          )}
          {disabled && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-light)' }}>
              Cancelar agendamento para editar
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TrialReelPanel.test.tsx`
Expected: PASS.

- [ ] **Step 4: Wire into WorkflowDrawer**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`:
1. Import: `import { TrialReelPanel } from './TrialReelPanel';` (next to the `TikTokSettingsPanel` import).
2. Mount directly ABOVE the `{(post.platform === 'tiktok' || post.platform === 'both') && (<TikTokSettingsPanel ...>)}` block:
```tsx
          {hasInstagramAccount && (
            <TrialReelPanel
              post={post}
              media={postMedia}
              disabled={isScheduleLocked}
              onFieldChange={onFieldChange}
            />
          )}
```
3. UI self-heal (courtesy sync; the DB trigger is the authority and clears on the same UPDATE — this second write only keeps local state honest). Change the tipo `<select>`'s `onChange`:
```tsx
                onChange={(e) => {
                  const v = e.target.value as WorkflowPost['tipo'];
                  onFieldChange('tipo', v);
                  if (v !== 'reels' && post.ig_trial_strategy) {
                    onFieldChange('ig_trial_strategy', null);
                  }
                }}
```
and the `PlatformSelector`'s `onChange`:
```tsx
              onChange={(platform) => {
                onFieldChange('platform', platform);
                if (platform === 'tiktok' && post.ig_trial_strategy) {
                  onFieldChange('ig_trial_strategy', null);
                }
              }}
```
(If a concurrent branch has already restructured these handlers — a separate session is locking tipo/platform while agendado — anchor on the `value={post.tipo}` select and the `PlatformSelector` mount, not on line numbers, and merge the behaviors.)

- [ ] **Step 5: Typecheck + drawer-adjacent tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/entregas/components/__tests__/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/TrialReelPanel.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/TrialReelPanel.test.tsx
git commit -m "feat(crm): painel Reel de teste no editor de post com trava de agendamento"
```

---

### Task 7: CRM "Teste" badges (list + calendar detail)

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/PostsListView.tsx`
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx`
- Modify: `apps/crm/src/style.css`
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx` (extend)
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `ActivePost/ScheduledPost.ig_trial_strategy` (Task 5).
- Produces: `.post-tipo-badge--trial` CSS modifier; a "Teste" span next to the tipo badge in both surfaces.

- [ ] **Step 1: Write the failing tests**

`PostsListView.test.tsx` already has `makePost(overrides: Partial<ActivePost>)` and renders via `<PostsListView {...baseProps} posts={...} />`. Append:

```tsx
  it('mostra o selo Teste em reels de teste', () => {
    render(
      <PostsListView
        {...baseProps}
        posts={[makePost({ tipo: 'reels', ig_trial_strategy: 'auto' })]}
      />,
    );
    expect(screen.getByText('Teste')).toBeTruthy();
  });

  it('não mostra o selo em post normal', () => {
    render(<PostsListView {...baseProps} posts={[makePost({ ig_trial_strategy: null })]} />);
    expect(screen.queryByText('Teste')).toBeNull();
  });
```

`CalendarPostDetailPanel.test.tsx` builds a module-level `const post: ClientePost = {...}` fixture. Append two cases rendering the panel with `post={{ ...post, tipo: 'reels', ig_trial_strategy: 'auto' }}` (assert `screen.getByText('Teste')`) and with the unmodified `post` (assert `screen.queryByText('Teste')` is null), reusing the file's existing panel props.

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx`
Expected: the new cases FAIL.

- [ ] **Step 2: Implement**

1. `PostsListView.tsx` — after the `<span className="post-tipo-badge">{TIPO_LABELS[p.tipo]}</span>`:
```tsx
                  {p.ig_trial_strategy && (
                    <span className="post-tipo-badge post-tipo-badge--trial">Teste</span>
                  )}
```
2. `CalendarPostDetailPanel.tsx` — after its `<span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>`:
```tsx
          {post.ig_trial_strategy && (
            <span className="post-tipo-badge post-tipo-badge--trial">Teste</span>
          )}
```
(The panel's `post` prop is `ClientePost`, which carries the field after Task 5.)
3. `apps/crm/src/style.css` — next to the existing `.post-tipo-badge` rule (search the class name), add the reels color at reduced emphasis (spec: no new tipo color):
```css
.post-tipo-badge--trial {
  background: #e1306c25;
  color: #e1306c;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/views/PostsListView.tsx apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx apps/crm/src/style.css apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx
git commit -m "feat(crm): selo Teste em listas e painel do calendário"
```

---

### Task 8: Hub — payload + chips

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`
- Modify: `apps/hub/src/components/TextPostCard.tsx`
- Test: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx` (extend)
- Test: `apps/hub/src/components/__tests__/TextPostCard.test.tsx` (extend)

**Interfaces:**
- Consumes: DB column (Task 1).
- Produces: `HubPost.ig_trial_strategy?: 'manual' | 'auto' | null`; a "Reel de teste" chip in both approval-card variants. Deliberately NOT added: `PostCalendar`, `HubPostChip`, `PostCard.tsx` (no page mounts PostCard as a card; it only exports helpers).

- [ ] **Step 1: Write the failing Hub tests**

Both files already have `makePost(overrides: Partial<HubPost>): HubPost`. In each, add two cases, rendering the card exactly the way the file's first existing test does (same required props/wrappers), varying only the post:

```tsx
  it('mostra o chip Reel de teste quando ig_trial_strategy está definido', () => {
    // render with post={makePost({ tipo: 'reels', ig_trial_strategy: 'auto' })}
    expect(screen.getByText('Reel de teste')).toBeTruthy();
  });

  it('não mostra o chip em post normal', () => {
    // render with post={makePost()}
    expect(screen.queryByText('Reel de teste')).toBeNull();
  });
```

(For `InstagramPostCard`, `makePost({ media: [makeMedia()], tipo: 'reels', ig_trial_strategy: 'auto' })` if the card needs media to render its header.)

Run: `npx vitest run apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx`
Expected: new cases FAIL.

- [ ] **Step 2: Implement**

1. `supabase/functions/hub-posts/handler.ts` — the posts select string (`"id, titulo, tipo, status, ordem, conteudo, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, tiktok_post_url, published_at, publish_error, platform, media_autocleaned_at, workflow_id, workflows(titulo, created_at)"`): insert `ig_trial_strategy` after `platform`. Rows are spread into the payload (`{ ...post, media, cover_media }`), so no mapper edit is needed.
2. `apps/hub/src/types.ts` — in `HubPost`, after `platform`:
```ts
  /** Reel de teste (Instagram trial reel): publicado só para não-seguidores até
   * a graduação. Absent em payloads antigos em cache — tratar como null. */
  ig_trial_strategy?: 'manual' | 'auto' | null;
```
3. `InstagramPostCard.tsx` — in the mock-IG header, right after `<PlatformBadge platform={post.platform} />`:
```tsx
        {post.ig_trial_strategy && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0"
            style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
          >
            Reel de teste
          </span>
        )}
```
4. `TextPostCard.tsx` — right after the tipo span (`{TIPO_LABEL[post.tipo] ?? post.tipo}`)'s closing `</span>`:
```tsx
            {post.ig_trial_strategy && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
              >
                Reel de teste
              </span>
            )}
```

- [ ] **Step 3: Run tests + Hub typecheck**

Run: `npx vitest run apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts apps/hub/src/types.ts apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx
git commit -m "feat(hub): chip Reel de teste nos cards de aprovação"
```

---

### Task 9: Full verification sweep

**Files:** none new — CI-parity run.

- [ ] **Step 1: Check for Deno-polluted node_modules before trusting local checks**

Run: `ls node_modules/.deno 2>/dev/null && npm ci || echo "clean"`
(Deno runs pollute node_modules; a polluted prettier/tsc gives false results.)

- [ ] **Step 2: Run everything CI runs**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
```
Expected: all PASS. `npm run format` auto-fixes any format:check failure, then re-run.

- [ ] **Step 3: Re-verify the migration prefix against main (memory: struck twice)**

Run: `git fetch origin main && git ls-tree origin/main:supabase/migrations --name-only | tail -3`
Expected: nothing at or above `20260828000010`. If main gained a colliding/higher prefix, renumber the migration file above main's tail and re-commit.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git diff --cached --quiet || git commit -m "chore: ajustes de verificação final (lint/format)"
```

---

## Deployment notes (after merge — operator steps, not plan tasks)

Order is mandatory (code that selects the column fails against the old schema):
1. `npx supabase db push --linked` — confirm `supabase/.temp/project-ref` is PROD (`skjzpekeqefvlojenfsw`) first; link state flips.
2. Edge functions, with `--use-api` (local Docker bundler is broken):
   `npx supabase functions deploy instagram-publish --use-api`,
   `npx supabase functions deploy instagram-publish-cron --no-verify-jwt --use-api`,
   `npx supabase functions deploy hub-posts --no-verify-jwt --use-api`.
3. Vercel frontends (CRM + Hub) via the normal merge-to-main deploy.
4. Staging verification of the wire format: schedule a trial reel on a real connected account; on failure capture the exact Graph `code`/`error_subcode`/`message` for the Tier-2 classifier pattern (spec: Errors). DK TESTE has fake IG tokens — never test live-Graph routes there.
