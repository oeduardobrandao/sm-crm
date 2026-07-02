# Estúdio — Technical Design (v1)

Status: **draft for approval** · 2026-07-02
Prior gates: task/risk outline approved; visual direction **B — Prancheta** approved; image gen **built-in, Gemini default**; fonts **curated + brand kit**; nav name **Estúdio**.
Evidence base: 9-agent discovery (run `wf_b23a4550-b19`) + 9-agent design workflow incl. a working render spike (run `wf_19284bc4-871`, spike at scratchpad `render-spike/spike.ts`).

---

## 1. Overview

Estúdio is a lightweight, Canva-like post editor inside the CRM. A versioned **design JSON document** is the single source of truth for a post's artwork; it is authored by humans (the editor page) and by Claude (new MCP tools), and flattened server-side into JPEGs that become ordinary post media — so Hub approval, scheduling, and Instagram publishing are untouched.

**WYSIWYG guarantee:** satori is the only layout engine. The editor preview *is* satori's SVG output (satori runs in the browser) with an interaction overlay on top; the published JPEG comes from the same satori version, same font bytes, same emoji assets, in a Deno edge function. Parity is by construction, not by testing.

### v1 scope
- Formats: `feed` (1:1, 4:5), `carrossel` (1:1, 4:5, 1–10 pages), `reel_cover` (9:16). `stories` is **not** supported in v1.
- Layers: text (with styled runs), image, shape (rect/ellipse). No filters, masks, curved text, gradient/outline text, video slides.
- Fonts: 26 curated self-hosted families (50 static variants). No user font upload (v2, plan-gated).
- Image generation: Gemini 3.1 Flash Image behind a provider adapter; flash tier only (pro-tier escalation is a fast-follow).
- Templates: none in v1 (schema is template-ready: a template is just a stored doc).

### Non-goals (v1)
Photoshop/Figma feature depth, real-time multiplayer, stories rendering, custom font upload, AI inpainting/editing of generated images.

---

## 2. The design document (schema v1)

Canonical module: `supabase/functions/_shared/design-doc.ts` (zod v4; see §3 for sharing). JSON is snake_case. All object schemas are `.strict()` — unknown keys are loud errors, never silently dropped.

### 2.1 Conventions (contractual — LLM authors depend on these)
- Coordinates are **canvas pixels** on a 1080-wide base, origin top-left, y-down. `x, y` = top-left of the **unrotated** bounding box.
- `rotation`: degrees, clockwise, about the **box center** (CSS default). Default 0.
- `opacity`: 0–1, default 1. Gradient `at`: 0–1. `angle`: degrees, CSS `linear-gradient` convention.
- Colors: `#rrggbb` or `#rrggbbaa` only (regex-enforced; reject with a "use #rrggbb[aa]" hint). No named colors, no rgb()/hsl().
- `line_height`: unitless multiplier, default 1.2. `letter_spacing`: px, default 0.
- Z-order = array order (satori has no z-index); later layers paint on top.
- Text layers have **no `h`** — text auto-grows vertically; `w` is the fixed wrap width.
- Text may contain `\n` (renderer sets `white-space: pre-wrap`) and the tokens `{{page}}` / `{{pages}}`, resolved at render time (page counters that survive reorder).

### 2.2 Shape

```ts
type DesignDoc = {
  version: 1;
  format: 'feed' | 'carrossel' | 'reel_cover';
  aspect_ratio: '1:1' | '4:5' | '9:16';        // 9:16 only for reel_cover; 1:1|4:5 for feed/carrossel
  canvas: { width: 1080; height: 1080 | 1350 | 1920 };  // NOT accepted on input (authoring schema omits it — supplying it is an unknown-key error);
                                                        // injected at normalization from format+aspect_ratio; always present in stored/returned docs
  pages: Page[];                                // feed/reel_cover: exactly 1; carrossel: 1..10
};

type Page = { id: string; background: Fill; layers: Layer[] };

type Fill =
  | { type: 'solid'; color: Hex }
  | { type: 'linear_gradient'; angle: number; stops: Array<{ color: Hex; at: number }> }  // 2..8 stops
  | { type: 'image'; file_id: number; fit: 'cover' | 'contain';
      overlay?: SolidOrGradient };              // scrim over the bg image (solid OR gradient — bottom-up scrims are table stakes)

type SolidOrGradient = Exclude<Fill, { type: 'image' }>;

type LayerBase = {
  id: string; name?: string;
  x: number; y: number; w: number;
  rotation?: number; opacity?: number; locked?: boolean;
};

type Run = {
  text: string;
  font_weight?: FontWeight;                     // overrides layer default
  font_style?: 'normal' | 'italic';
  color?: Hex;
  highlight?: { color: Hex; padding_x?: number; radius?: number };  // marca-texto: hugs each wrapped line
};

type TextLayer = LayerBase & {
  type: 'text';
  text?: string;                                // simple case; XOR with runs
  runs?: Run[];                                 // mid-sentence bold/color — the dominant BR carousel pattern
  font_key: string;                             // curated-manifest key (e.g. 'playfair-display'), never a raw family name
  font_weight: FontWeight;                      // (font_key, font_weight, font_style) must exist in the manifest — no synthetic bold/italic in satori
  font_style?: 'normal' | 'italic';
  font_size: number;
  line_height?: number; letter_spacing?: number;
  color: Hex; align?: 'left' | 'center' | 'right';
  shadow?: { x: number; y: number; blur: number; color: Hex };
  pill?: { color: Hex; padding_x: number; padding_y: number; radius: number };
  // pill is BLOCK-level (satori has no inline-block/box-decoration-break): one rounded rect around the
  // whole block; the renderer splits on explicit \n into stacked child divs → per-line pills for authored
  // breaks. Per-wrapped-line highlight = runs[].highlight (satori renders span backgrounds per line fragment).
};

type ImageLayer = LayerBase & {
  type: 'image'; h: number;
  file_id: number;                              // files.id, same conta — resolved to data URI (server) / signed URL (browser)
  fit: 'cover' | 'contain';
  radius?: number;
  border?: { width: number; color: Hex };
};

type ShapeLayer = LayerBase & {
  type: 'shape'; h: number;
  shape: 'rect' | 'ellipse';                    // 'line' cut from v1 (thin rect covers it); ellipse = borderRadius 50%
  fill?: SolidOrGradient;                       // gradient rect = freestanding scrim over image layers
  radius?: number;
  stroke?: { width: number; color: Hex };
};

type Layer = TextLayer | ImageLayer | ShapeLayer;
type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;
```

### 2.3 Hard limits (zod-enforced)
`pages` ≤ 10 · `layers` per page ≤ 40 · text ≤ 2000 chars per layer · gradient stops 2–8 · serialized doc ≤ 256 KB · prompt-free (no URLs in the doc; images by `file_id` only, so signed URLs never get baked in).

### 2.4 Validation pipeline (shared by editor saves and MCP writes)
Location: pure functions beside the schema (`_shared/design-doc.ts` + `mcp/design.ts` glue).

- **Stage 0 — structural**: zod v4 `.strict()` parse, discriminated unions on `layer.type`/`fill.type`, all scalar bounds in-schema.
- **Stage 1 — business rules, aggregated (never fail-fast — one retry must fix everything)**:
  1. `format` ↔ `workflow_posts.tipo`: feed→feed, carrossel→carrossel, reels→reel_cover; `stories` → `unsupported_post_tipo`. Page count and aspect_ratio valid for the format.
  2. Every `file_id` (image fills + image layers) checked in ONE query: exists, `conta_id` matches, `kind='image'`. Same message for missing vs foreign (never reveal foreign existence): `file_not_found`.
  3. `(font_key, font_weight, font_style)` exists in the manifest — `unknown_font` (carries `allowed` keys once) / `unsupported_font_variant` (carries the family's actual variants).
  4. Page ids and layer ids unique; ids match `^[a-z0-9_-]{1,40}$`. Server mints nanoids for anything missing.
  5. Text containing RTL scripts (Hebrew/Arabic Unicode ranges) → `rtl_unsupported` — satori cannot lay out RTL; an error, not a warning, because a warning would ship broken artwork.
  6. `format` feed/carrossel on a post that has video media → `post_has_video_media` — v1 designs cannot represent video slides, and the render's replace-all media swap (§5.2) would otherwise strand or mis-publish the video.
- **Stage 2 — normalization** (only after 0+1 pass): the `canvas` block is injected from `format` + `aspect_ratio`; defaults materialized explicitly (`rotation: 0`, `opacity: 1`, `line_height: 1.2`, `align: 'left'`…), coords rounded to 2 decimals, gradient stops sorted by `at`, unnamed layers auto-named ("Texto 3"). The **normalized doc is what gets stored and echoed back** — browser satori and edge satori always read identical docs.
- **Warnings (non-fatal)**: `layer_off_canvas`, `empty_text`, `text_overflow` (measured bbox exceeds canvas). Returned alongside the normalized doc.

Structured error shape (the agent self-correction contract — extends the MCP `errorResult` with one branch):

```jsonc
{ "error": "design_invalid", "doc_version": 1,
  "issues": [
    { "path": "pages[0].layers[2].font_key", "code": "unknown_font",
      "message": "Fonte 'Helvetica' não está no catálogo.", "allowed": ["dm-sans", "montserrat", "…"] }
  ],
  "issue_count": 1, "truncated": false }   // issues capped at 20
```

### 2.5 Text measurement (auto-grow heights)
Text heights are emergent from layout. Both sides measure the same way: render the single text layer subtree through satori (≈5 ms/layer) and extract geometry bounds — resvg `getBBox()` server-side (SVG parse only, **no rasterization** — the expensive resvg step never runs for measurement), hidden-DOM bbox client-side — cached per `(content, style, w)`. The server measure pass feeds the `layout` array in MCP responses (agents position "below the headline" from it); the editor uses its cache for hit-testing/handles. Residual 1px-class divergence is preview-only; the authoritative render is always the server pass. **Flagged risk R2 (§14).**

### 2.6 Example document (carrossel, 2 pages, abbreviated)

```jsonc
{
  "version": 1, "format": "carrossel", "aspect_ratio": "4:5",
  "canvas": { "width": 1080, "height": 1350 },
  "pages": [
    { "id": "p1",
      "background": { "type": "image", "file_id": 812, "fit": "cover",
        "overlay": { "type": "linear_gradient", "angle": 0,
          "stops": [ { "color": "#00000000", "at": 0.45 }, { "color": "#000000cc", "at": 1 } ] } },
      "layers": [
        { "id": "eyebrow", "type": "text", "x": 90, "y": 780, "w": 900,
          "text": "PROTETOR SOLAR", "font_key": "montserrat", "font_weight": 600,
          "font_size": 30, "letter_spacing": 6, "color": "#f5c343" },
        { "id": "headline", "type": "text", "x": 90, "y": 830, "w": 900,
          "runs": [
            { "text": "5 mitos que " },
            { "text": "envelhecem", "font_weight": 600, "color": "#f5c343" },
            { "text": " sua pele" } ],
          "font_key": "fraunces", "font_weight": 400, "font_size": 76,
          "line_height": 1.1, "color": "#ffffff" },
        { "id": "counter", "type": "text", "x": 90, "y": 1240, "w": 200,
          "text": "{{page}}/{{pages}}", "font_key": "montserrat", "font_weight": 600,
          "font_size": 26, "color": "#ffffffaa" } ] },
    { "id": "p2",
      "background": { "type": "solid", "color": "#f4efe6" },
      "layers": [ /* … */ ] }
  ]
}
```

---

## 3. Sharing the schema across runtimes (zod 3 vs 4)

Verified: `@modelcontextprotocol/sdk@1.25.3` accepts `zod ^3.25 || ^4.0`; `mcp/tools.ts` imports `npm:zod@3` inline; root package.json resolves zod 4.3.6; `supabase functions deploy --use-api` only bundles files under `supabase/functions/`; Vite/tsc/vitest import out-of-root files fine (precedent: `@mesaas/i18n` alias).

**Decision: single source in `supabase/functions/_shared/design-doc.ts`, aliased into the CRM. No duplication, no zod migration of tools.ts.**

1. `supabase/functions/deno.json` imports: add `"zod": "npm:zod@4.3.6"` (pin the exact root-resolved version). The shared module imports bare `"zod"` — resolved by the map in Deno, by `node_modules` in Vite/vitest/tsc.
2. `apps/crm/vite.config.ts` + `apps/crm/tsconfig.json` paths + `vitest.config.ts`: alias `@mesaas/design-doc` → `supabase/functions/_shared/design-doc.ts`.
3. `mcp/tools.ts` keeps `npm:zod@3` untouched. MCP-level `design` args are `z.record(z.unknown())` (zod3); the zod4 `DesignDocSchema` runs **inside the handler**, where structured `issues[]` are produced anyway. Two zod majors coexist in Deno as separate resolutions.
4. Dual-runtime smoke tests import the same `_shared/design-doc-fixtures.ts` from a Deno test and a vitest test, asserting identical accept/reject + normalization output.

Toolchain notes: `deno test` will touch `deno.lock`/`node_modules` — recover with `git checkout deno.lock && npm ci`. Prettier/eslint globs don't cover `supabase/functions/_shared` — format the shared module manually with the repo config.

---

## 4. Database

Three idempotent migrations (next free versions; never reuse — prod burned by dup `20260625000001`):

- `20260702000001_post_designs.sql`
- `20260702000002_ai_image_generations.sql`
- `20260702000003_plans_estudio_columns.sql` (+ `hub_brand.logo_file_id` rides in 000001)

### 4.1 `post_designs` (1:1 with workflow_posts)

```sql
CREATE TABLE IF NOT EXISTS post_designs (
  id                 bigserial PRIMARY KEY,
  post_id            bigint NOT NULL UNIQUE REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc                jsonb NOT NULL,
  doc_version        int  NOT NULL DEFAULT 1,           -- schema version (mirrors doc->>'version')
  rev                int  NOT NULL DEFAULT 1,           -- author optimistic-concurrency counter
  doc_hash           text NOT NULL DEFAULT '',          -- md5(doc::text), trigger-maintained, never client-supplied
  updated_via        text NOT NULL DEFAULT 'human' CHECK (updated_via IN ('human','agent')),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  render_status      text NOT NULL DEFAULT 'pending'
                     CHECK (render_status IN ('pending','rendering','rendered','failed')),
  render_started_at  timestamptz,                       -- claim lock (publish_processing_at analog)
  render_manifest    jsonb,                             -- in-flight chunk outputs [{page_id, r2_key, bytes, width, height}]
  rendered_at        timestamptz,
  rendered_doc_hash  text,
  render_error       text,                              -- sanitized, tenant-visible
  is_stale           boolean GENERATED ALWAYS AS (doc_hash IS DISTINCT FROM rendered_doc_hash) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_designs_doc_is_object CHECK (jsonb_typeof(doc) = 'object'),
  CONSTRAINT post_designs_doc_version_matches CHECK ((doc->>'version')::int = doc_version),
  CONSTRAINT post_designs_pages_1_to_10 CHECK (
    jsonb_typeof(doc->'pages') = 'array' AND jsonb_array_length(doc->'pages') BETWEEN 1 AND 10)
);
```

Key mechanics (full SQL follows the drafted migration):
- **BEFORE trigger** `set_post_designs_doc_state`: recomputes `doc_hash = md5(doc::text)` (Postgres-only hashing — no cross-runtime hash drift), bumps `updated_at`, and on doc change **bumps `rev = OLD.rev + 1`**, auto-resets `render_status='pending'` + clears `render_error`. No writer can leave a stale `rendered` flag.
- **Single write path — no direct client writes.** Authenticated gets **SELECT only** (RLS member check); INSERT/UPDATE/DELETE on the table are revoked. All writes flow through a SECURITY DEFINER RPC `save_post_design(p_conta_id, p_post_id, p_doc, p_expected_rev, p_via, p_actor)` — EXECUTE granted to **service_role only** — called by `post-design-manage` and the MCP tools *after* zod validation. The RPC atomically: verifies `workflow_posts.conta_id = p_conta_id` (a conta-column RLS check alone would let a client attach a design to a guessed foreign `post_id`), enforces status ∈ EDITABLE_STATUSES, syncs `workflow_posts.tipo` on format change, applies the `expected_rev` guard (`rev` is trigger-maintained; 0-row mismatch → conflict naming the current rev), and diffs `design_asset_refs` (below). A companion `delete_post_design` RPC owns DELETE semantics (§5.2). Rationale: direct PostgREST writes would bypass the feature gate, zod validation, tipo sync, and audit — the grants must make that impossible, not merely unused.
- **`design_asset_refs`** (same migration): `(design_id, file_id, conta_id)` rows maintained by the save RPC from the doc's `file_id` set, carrying the same reference-count trigger as `post_file_links` — a file referenced only by a design doc can no longer be garbage-collected out from under it.
- **Render claim/finalize RPCs** (SECURITY DEFINER, service_role only):
  - `claim_design_render(design_id)` — atomic `pending/failed/rendered → rendering` claim, re-claimable when `render_started_at < now() - interval '3 minutes'` (edge wall-clock ≤150s guarantees a worker older than that is dead).
  - `finalize_design_render(design_id, claimed_hash, pages jsonb)` — **one hash-guarded transaction** doing everything: re-check `doc_hash = claimed_hash` (moved → return `'stale'`, write nothing), create the `files` rows via `file_insert_with_quota`, swap post media per the §5.2 semantics (incl. reel-cover thumbnail application), **DELETE the previous render's `files` rows** (which fires the existing trigger that queues their R2 keys into `file_deletions` — link deletion alone only decrements `reference_count` and leaks R2 objects), and set `rendered`/`rendered_doc_hash`/`rendered_at`. There is no window where stale links are installed before the hash check.
  - `fail_design_render(design_id, error)` — failure path, sanitized `render_error` only.
- `ALTER TABLE post_file_links ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','design'));` — marks Estúdio-rendered links for the media semantics in §5.2 and the read paths (post-media-manage must add `origin` to its response shape — today it omits it).
- `ALTER TABLE hub_brand ADD COLUMN IF NOT EXISTS logo_file_id bigint REFERENCES files(id) ON DELETE SET NULL;` — the brand logo as a real file (the schema is `file_id`-only). Materialization is always an **explicit write** (the `POST /brand-logo` route §5.4, or `generate_image use_brand_logo` — never a read tool). The import fetches tenant-authored free text server-side, so it is SSRF-hardened: https only; reject IP-literal hosts in any notation (normalize IPv4 decimal/octal/hex and IPv6 forms first); DNS-resolve and reject private/link-local/loopback ranges immediately before the fetch; `redirect: 'manual'` with any 3xx rejected (no cross-host redirect following); 10 s timeout; ≤5 MB streamed cap; `image/*` content type + magic-byte sniff. Residual DNS-rebinding risk (resolve-then-fetch TOCTOU) is accepted for v1 given the layered caps and is documented in the module. Result goes through `file_insert_with_quota` (charges tenant storage quota normally).

### 4.2 `ai_image_generations` (quota ledger + forensics)

Lifecycle table — a row is inserted **before** the provider call (spend is never unlogged) and finalized after:

```sql
CREATE TABLE IF NOT EXISTS ai_image_generations (
  id            bigserial PRIMARY KEY,
  conta_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id    bigint REFERENCES clientes(id) ON DELETE SET NULL,
  post_id       bigint,
  file_id       bigint REFERENCES files(id) ON DELETE SET NULL,  -- SET NULL: deleting the file never refunds quota
  source        text NOT NULL CHECK (source IN ('crm','mcp')),
  mcp_key_id    uuid,
  provider      text NOT NULL,             -- 'gemini'
  model         text NOT NULL,             -- e.g. 'gemini-3.1-flash-image'
  aspect_ratio  text NOT NULL,
  image_size    text NOT NULL,             -- '1K' | '2K'
  prompt        text NOT NULL,             -- stored (tenant content class, RLS-scoped); NEVER copied to audit_log
  reference_count int NOT NULL DEFAULT 0,
  idempotency_key text,                    -- partial-unique per conta; safe retries never double-spend
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','succeeded','safety_refused','provider_timeout','provider_error','failed_storage','failed_storage_quota')),
  provider_latency_ms int, tokens_out int, cost_usd_estimate numeric(8,4),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_via   text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human','agent')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_image_generations_conta_month_idx
  ON ai_image_generations (conta_id, created_at DESC);
```

- Add `idempotency_key text` + partial unique index `(conta_id, idempotency_key) WHERE idempotency_key IS NOT NULL`: CRM/MCP retries of the same submission return the existing generation instead of paying twice.
- **Quota counting: pending rows are reservations.** The trigger predicate counts `status = 'succeeded' OR (status = 'pending' AND created_at > now() - interval '10 minutes')` — counting only `succeeded` would let N concurrent requests each see the same under-limit count and all reserve provider spend (the advisory lock serializes inserts but doesn't make invisible work visible). Failed transitions leave the reserved set automatically (users never lose quota to our failures), and the 10-minute window self-heals reservations stranded by crashed workers. `cost_usd_estimate` is logged on every row for internal cost accounting.
- Enforcement is two-layer: call-time pre-check with the same predicate (friendly 403 before paying Gemini) + the `enforce_plan_count_limit` BEFORE-INSERT trigger backstop. Month boundary is UTC — documented, not fought.
- The core validates ownership of **every** caller-supplied id: `client_id` (verifyClient), `post_id` (tenant-scoped fetch), `reference_file_ids` (batched conta+kind check).
- RLS: members read own workspace's rows (usage panel later); all writes via service role only.
- Retention lever (if privacy pressure appears): prune prompt text on rows older than 12 months; rows themselves stay (they are the ledger).

### 4.3 Plan columns + entitlements wiring

```sql
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_estudio          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_ai_images        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_ai_images_per_month int;
UPDATE plans SET rate_ai_images_per_month = 0 WHERE rate_ai_images_per_month IS NULL;  -- NULL = UNLIMITED in effective_plan_limit; never leave it by accident
-- Seeds are PLACEHOLDERS pending product decision (§14): e.g.
-- UPDATE plans SET feature_estudio = true WHERE id IN ('pro','max','lifetime');
-- UPDATE plans SET feature_ai_images = true, rate_ai_images_per_month = 100 WHERE id IN ('max','lifetime');
-- 'lifetime' (out-of-catalog comp plan) MUST be included — it was missed by the feature_mcp rollout once.
```

Naming follows the repo convention: `rate_*_per_month` lands in the admin "Rate Limits" group automatically. Two flags, not one — AI images have marginal cost and will tier independently of the editor (exact analog of `feature_instagram` / `feature_instagram_ai`).

**Single source** `supabase/functions/_shared/entitlements.ts`: append `rate_ai_images_per_month` to `RATE_COLUMNS`, `feature_estudio` + `feature_ai_images` to `FEATURE_COLUMNS`. Mirror edits (the PR #178 drift list — all must land in the same PR):
1. `apps/admin/src/lib/api.ts` — `Plan` interface + `FEATURE_FLAG_KEYS/LABELS` + `RATE_LIMIT_KEYS/LABELS`.
2. `apps/admin/src/pages/__tests__/plan-form.test.ts` — `makePlan` fixture.
3. `supabase/functions/__tests__/platform-admin-plan-mutations_test.ts` — not-silently-dropped assertions for the three columns.
4. `apps/crm/src/hooks/useWorkspaceLimits.ts` — `ResourceLimits`/`FeatureFlags` interfaces (**note: `feature_mcp`/`max_mcp_keys` are already missing there — fix in the same pass**).
5. `apps/crm/src/components/layout/nav-data.ts` — `NAV_FEATURE`: `estudio: 'feature_estudio'`.
6. `apps/crm/src/lib/entitlement-errors.ts` — PT labels for the new feature/limit keys.

### 4.4 Rollout procedure (db push is broken in BOTH envs)
Apply via SQL editor in file order, then record versions:
`insert into supabase_migrations.schema_migrations (version) values ('20260702000001'),('20260702000002'),('20260702000003') on conflict do nothing;`
Prod (`skjzpekeqefvlojenfsw`): blocked by dup `20260625000001`. Staging (`wlyzhyfondykzpsiqsce`): blocked by orphaned backdated backfill. All migrations are written idempotent for this reason. Verify with `npx supabase migration list --linked` + a plans smoke query (confirm `lifetime` got flags).

---

## 5. Render pipeline (`design-render` edge function)

### 5.1 Spike results (the numbers this design rests on)
Warm medians, Deno 2.7.12, Apple Silicon (edge hardware is 2–4× slower for wasm):

| Stage | 1080×1350 | 1080×1920 |
|---|---|---|
| satori (tree→SVG) | 4.8 ms | 5.2 ms |
| resvg (SVG→RGBA) | 343 ms | 759 ms |
| mozjpeg encode q85 | 168 ms | 234 ms |
| **Total** | **516 ms** | **998 ms** |

Wasm init 291 ms one-time per worker; memory ≈56 MB heap+external (256 MB cap is a non-issue — **CPU is the constraint**); JPEG output ~200 KB/page. 10 pages sequential = 5.6 s local → 10–20 s edge ⇒ **one page per invocation, chained**. Embedded photos are ~½ the resvg cost — pre-sizing R2 images near target dimensions is the biggest lever (fast-follow).

Verified working pipeline (exact specifiers): `npm:satori@0.26.0` (object trees, no JSX) → `npm:@resvg/resvg-wasm@2.6.2` → `npm:@jsquash/jpeg@1.6.0/encode.js` (mozjpeg, **`.js` suffix required in Deno**); `rendered.pixels → mozjpeg` directly, no PNG intermediate (saves 50–70 ms + 2 MB/page). satori happily reads Fontsource WOFF/TTF.

### 5.2 Function contract
- **Shared render core**: the wasm stack (satori/resvg/mozjpeg init, font + emoji byte caches) lives in `supabase/functions/_shared/design-render-core.ts` — consumers: `design-render` (full pages), the `mcp` function (measure pass §2.5 + `preview_design` §9), and tests. The **pure doc→satori-tree builder is a separate runtime-neutral module** `_shared/design-render-tree.ts` (no wasm/Deno imports; includes the Twemoji callback config and font-entry assembly), aliased into the CRM as `@mesaas/design-render-tree` — browser and edge build byte-identical trees from one implementation, which is what makes parity-by-construction real.
- **Auth**: internal-only. Deployed `--no-verify-jwt`; verifies `x-cron-secret` (cron convention). Callers are server-side: the MCP design tools, `post-design-manage` (the editor's save function, §5.4), the pre-schedule hook, and a sweep cron. The CRM never calls it directly.
- **Request**: `{ design_id, rev, page_index? }`.
- **Flow**:
  1. `page_index` absent → orchestration start: `claim_design_render(design_id)` (0 rows → 409 "render em andamento"); stale `rev` vs current row → 204 no-op (a newer write superseded this render).
  2. Chunked calls (`page_index > 0`) re-read the design row and abort (204) if `rev` changed or `render_status ≠ 'rendering'` — a mid-chain doc write kills the chain cleanly. **Abort paths queue this render's already-uploaded R2 keys into `file_deletions`** (no `files` rows exist yet for them — see step 4 — so nothing else will ever clean them).
  3. Render page `page_index ?? 0`: resolve `file_id`s → R2 `getObject` bytes → data URIs (resvg-wasm cannot fetch URLs); satori tree per §2 render contract; resvg → pixels → mozjpeg q85 JPEG.
  4. Write the JPEG to R2 `contas/{conta_id}/designs/{design_id}/{rev}/{page_id}.jpg` and append `{page_id, r2_key, bytes, width, height}` to the row's `render_manifest` jsonb. **No `files` rows are created per chunk** — interrupted chains must not leave quota-charged rows behind.
  5. More pages → self-invoke `POST design-render { design_id, rev, page_index+1 }` via `EdgeRuntime.waitUntil()` and return; else:
  6. `finalize_design_render(design_id, claimed_hash, manifest)` — the single transaction of §4.1: hash re-check (`'stale'` → caller queues the manifest keys into `file_deletions` and stops), `file_insert_with_quota` per page, media swap per the semantics below, previous render's `files` rows deleted (queues their R2 cleanup), rendered state set. Failures at any step → `fail_design_render(design_id, sanitized_error)`; raw satori errors go to internal logs only.
- **Media semantics (the authoritative "active media" rules)** — the publish pipeline, Hub, and CRM all consume `post_file_links` unfiltered (verified: `fetchPostMedia`/`validateForScheduling` read every link, and `media.length > 1` triggers the carousel path), so the rules make the raw link set correct rather than adding a projection:
  - **feed/carrossel**: finalize **replaces ALL image links** (manual and previous-design) with the rendered pages (`origin='design'`, `sort_order` = page index). Manual link rows are deleted (their `files` rows are NOT — user uploads stay in Arquivos); old design `files` rows ARE deleted. Design creation on a feed/carrossel post that has video media is a validation error (`post_has_video_media`) — v1 designs cannot represent video slides, and leaving the video linked would publish a mixed carousel.
  - **reel_cover**: **no `post_file_links` row at all.** A second link would make `media.length > 1` and silently turn the Reel into a carousel; the publish path sources the cover from the video file's `thumbnail_r2_key` (verified: `useCover ? media[0].thumbnail_r2_key : null`). Finalize instead sets the rendered JPEG as the linked video's `thumbnail_r2_key` (the post-media-manage PATCH-thumbnail precedent: update the `files` row, queue the old thumbnail for deletion). Requires exactly one video link with `reference_count = 1` — otherwise the render fails with a sanitized message ("adicione o vídeo do reel antes de gerar a capa" / shared-file case), and the §5.3 gate keeps the post unschedulable.
  - **DELETE design** (`delete_post_design` RPC): feed/carrossel → removes `origin='design'` links and their `files` rows (queues R2 cleanup), removes `design_asset_refs`; the post is left without media (the user re-uploads manually — pre-design manual links were consumed by the first render and are not restorable). reels → the design row and refs go; the video keeps its last rendered thumbnail (replaceable via the existing thumbnail picker). Documented in the editor's delete confirmation.
- **Fire-and-forget contract**: every fire-and-forget in the system — chunk self-invocation, the render triggers from `post-design-manage`/MCP writes, the §5.3 stale re-trigger — is wrapped in `EdgeRuntime.waitUntil(promise.catch(log))`. Supabase terminates work that outlives the response unless it is registered this way (the repo's existing fire-and-forget precedents don't do this; ours must). Injectable in tests.
- **Editor asset uploads are not post media**: images inserted as design layers upload via the existing presigned pipeline but finalize **without `post_id`** — layer assets are referenced by `file_id` inside the doc (and pinned by `design_asset_refs`), never linked as post media. Only rendered outputs get `post_file_links` rows (always `origin='design'`).
- **Render contract details** (per satori-compat findings): `white-space: pre-wrap` + `word-break: break-word` on every text block; background image = first full-bleed `<img objectFit>` child (objectPosition defaults to center — correct cover-crop) with explicit intrinsic width/height; overlay opacity baked into `rgba()`; page root `overflow: hidden`; runs → nested spans; pill split on `\n` into stacked divs; `{{page}}/{{pages}}` substituted before satori.
- **Fonts**: collect `(font_key, weight, style)` set from the doc → R2 `getObject` latin + latin-ext TTFs (shared prefix `assets/fonts/v1/…`, module-scope byte-capped LRU cache ~32 MB) → satori `fonts` entries; `inter` 400 latin always appended as last-resort fallback.
- **Emoji**: `loadAdditionalAsset` → Twemoji **pinned 17.0.3** (`cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/{codes}.svg`, standard FE0F-stripping rule), same module-scope cache; a 404 degrades to skipping the grapheme (logged), never fails the render. Identical callback code runs in the browser preview — WYSIWYG parity for emoji too.
- **Sweep cron**: re-fires rows stuck `pending`/`rendering` older than 2 min (fire-and-forget fetches are droppable; the claim RPC's 3-min stale-lock makes this safe). Uses the existing cron-secret + failure-alert conventions.

### 5.3 Publish-safety invariant
A post that has a `post_designs` row must satisfy `render_status='rendered' AND is_stale=false` before entering `agendado`: enforced in the scheduling validation path (`validateForScheduling`) and defensively re-checked by the publish cron's container phase. Renders are also triggered automatically on MCP writes and editor saves (debounced), so this gate rarely bites in practice.

### 5.4 `post-design-manage` (the editor's save path — slice 1)
User-facing edge function (JWT verification ON, `buildCorsHeaders`, profile→`conta_id` per the file-upload-finalize pattern). It is the only design write path for the CRM. After validating auth + the doc, it calls the service-role `save_post_design` RPC (§4.1) with the verified `conta_id` — clients cannot write `post_designs` directly at all, so every invariant (ownership, status, rev, tipo sync) is enforced in one transaction regardless of caller.

| Route | Behavior |
|---|---|
| `GET ?post_id=` | Get-or-create: verifies post tenancy; no `post_designs` row → creates one with a starter doc derived from `tipo` (+ existing cover image as background when present — the lazy path for pre-Estúdio posts, §6.5). Returns `{design, rev, render: {status, pages}}` |
| `PUT` `{post_id, doc, expected_rev}` | Feature gate `feature_estudio` → post status ∈ EDITABLE_STATUSES → shared validation §2.4 → syncs `workflow_posts.tipo` when `doc.format` changed (feed↔carrossel↔reels mapping — the only writer, so format switching in the editor can't validate-fail against a stale tipo) → guarded update `.eq('rev', expected_rev)` → fire-and-forget `design-render` trigger → `{design (normalized), rev, warnings}` (no `layout` here — measured bboxes are an MCP-agent concern; the editor keeps its own measurement cache, and this keeps the wasm stack out of the save path) |
| `POST /brand-logo` `{cliente_id}` | Lazy logo materialization (§4.1): idempotent on `hub_brand.logo_file_id`; otherwise SSRF-hardened import of `logo_url` → R2 → `file_insert_with_quota` → sets `logo_file_id`. Returns `{logo_file_id}` or `{logo_file_id: null, reason}` |
| `DELETE ?post_id=` | Removes the design row (releases media ownership §6.7; rendered links with `origin='design'` are deleted, files hit the orphan queue) |

Errors: `design_invalid` + `issues[]` (§2.4 shape), `rev_conflict` + `{current_rev}` (409 — drives the editor's conflict banner §6.2), `feature_disabled` (403). Audited like other user-facing writes.

---

## 6. Editor architecture (`apps/crm/src/pages/estudio/`)

Verified constraints: `workflow_posts.workflow_id` is NOT NULL (no workflow-less posts); no canvas libs or global state manager exist; nav icons are Phosphor (`ph-*`), in-page icons lucide; `AppLayout` pads `<main>` — Estúdio breaks out with an internal full-bleed container (no route-group change).

### 6.1 Files (summary — full tree in the implementation plan)
```
pages/estudio/
  EstudioPage.tsx            # route entry: /estudio (picker) + /estudio/:postId (editor)
  types.ts                   # re-exports from @mesaas/design-doc
  hooks/                     # useDesignDocState (reducer + undo), useAutosaveDesign, usePostDesignQuery,
                             # useEstudioEntryFlow, useSatoriRenderer, useFontManifest,
                             # useCanvasTransform, useSelection, useSnapping
  components/
    PostPicker/              # client → workflow → post cascade, or "Criar novo"
    Toolbar/                 # TopToolbar (save pill, undo/redo, zoom, Gerar arte) + ContextualToolbar (per layer type)
    Dock/                    # LeftToolDock (add text/image/shape/AI/brand) + BrandPanel
    Canvas/                  # CanvasStage (+ toggleable IG safe-zone guides), SatoriPreview (SVG), InteractionOverlay, LayerHandles, TextEditOverlay
    SlideStrip/              # dnd-kit page reorder, add/duplicate/delete (carrossel)
    Layers/                  # optional LayerListPanel (z-order, lock)
    shared/                  # ColorPicker (brand swatches pinned), FontPicker (Marca + 4 vibe groups)
  lib/                       # satoriEngine (docToSatoriTree), layerGeometry, snapMath, designDocOps (pure),
                             # imageResolution, validation (client-side warnings)
  __tests__/
```
Route/nav wiring: lazy route in `App.tsx`; `nav-data.ts` item in `gestao` (icon `ph-magic-wand`) + `NAV_FEATURE['estudio'] = 'feature_estudio'`; "Abrir no Estúdio" button in `WorkflowDrawer` next to the media gallery.

### 6.2 State
- Single `useReducer` atom: `{ doc, past[], future[], selection, activePage }`, ops as pure functions in `designDocOps.ts` (undo stack capped at 50). **Commit boundaries**: drag/resize/rotate buffer transient deltas in the overlay and dispatch once on pointer-up (one undo step per gesture); text edits commit on blur/Enter (one step per session).
- **Autosave**: 800 ms-debounced TanStack mutation → `post-design-manage` PUT. **Concurrency protocol**: at most one in-flight save; each save snapshots a local generation counter; while a save is in flight, further edits set a queued-dirty flag that re-arms the debounce on completion; a response is applied (normalized doc + rev adopted) only if no newer local generation exists — otherwise only the `rev` is adopted and the local doc stands. Save states: `saved | saving | dirty | conflict`. Flush-on-unmount is best-effort only, so a React Router navigation blocker holds departure while dirty, and the current doc is stashed to `localStorage` before any unload.
- **Conflict UX** (Claude edits the same design via MCP): `expected_rev` mismatch → autosave pauses, non-blocking banner "Este design foi alterado por outra fonte — Recarregar"; before discarding local state, the pre-conflict doc is stashed in `localStorage` keyed by postId (recovery path — addresses risk of silently losing 10 minutes of work).

### 6.3 satori in the browser
- `useSatoriRenderer` dynamic-imports **`satori/standalone`** and initializes it with satori's own packaged **`satori/yoga.wasm`** binary (satori 0.26.0 depends on `yoga-layout@^3.2.1`; the package exports are `.`, `./standalone`, `./jsx`, `./yoga.wasm` — there is no `satori/wasm` entrypoint and `yoga-wasm-web` is not a dependency). Loaded inside the route chunk (zero main-bundle cost; Vite serves the wasm via `new URL(..., import.meta.url)`).
- **Pinned parity**: the same satori version in `apps/crm/package.json` and the edge `npm:satori@0.26.0` import; byte-identical font binaries (§7); same Twemoji pin. Same layouter + same inputs ⇒ identical geometry.
- Render loop: satori re-renders on commit (pointer-up, text commit, toolbar action), debounced ~150 ms — **never per-mousemove**; during gestures the overlay moves a CSS-transformed ghost at 60 fps. satori cost is ~5 ms/page — comfortable.
- Hit-testing: inverse-transform math in `layerGeometry.ts` (screen → canvas coords → per-layer center-rotation inverse); text heights from the measurement cache (§2.5).

### 6.4 Text editing overlay (runs-aware)
`TextEditOverlay` is a **minimal TipTap instance** (already in the stack): single paragraph + hard-break + bold/italic/color/highlight marks, mapped 1:1 to `runs` on commit (plain text when unstyled). Positioned over the satori-rendered block: same wrap width (`w × scale`), same font binary (§7 single-format serving means the exact TTF satori used), `white-space: pre-wrap`, rotated with the layer. Commit on blur/`Enter` (Shift+Enter = `\n`), Escape cancels. Browser-vs-satori line-break divergence is minimized (fixed width + identical fonts) and self-corrects on commit when satori re-renders; documented as preview-only.

### 6.5 Entry flows
- **Existing post**: `/estudio/:postId` (from picker or "Abrir no Estúdio"). No `post_designs` row yet → lazily create one with a starter doc derived from `tipo` (+ existing cover image as background when present).
- **Create from scratch** (the Post Express precedent, verbatim pattern): pick client → `addWorkflow("Estúdio - {cliente} - {data}")` → single synthetic completed etapa → `addWorkflowPost(status: 'rascunho', tipo: 'feed')` → `createPostDesign(starter doc)` → navigate. Abandonment cleanup on unmount if the doc never got a layer (cascade delete).
- Format/AR switching in-editor updates `tipo` on the post (feed ↔ carrossel ↔ reels cover) within the editable statuses.

### 6.6 IG safe-zone guides
Toggleable overlay guides (editor-only, never in the doc): feed/carousel 4:5 — top ~150 px (username chip) and bottom ~250 px (caption/CTA) danger zones plus the carousel-dots strip; `reel_cover` — the center 3:4 (1080×1440) grid-crop box, so titles must live in the center square. On by default for new users; state persisted per user.

### 6.7 Media ownership rule
When a post has a design: the design **owns** the post's image media — `PostMediaGallery` in Entregas shows a "Gerenciado pelo Estúdio" banner with manual image upload disabled. Carve-out: `reel_cover` designs own only the `is_cover` link; the reel video stays manual. Deleting the design releases ownership (links remain as ordinary media).

---

## 7. Fonts pipeline

Verified: satori reads TTF/OTF/WOFF only (no WOFF2, no variable fonts, no synthetic bold/italic); Fontsource CDN serves pre-instanced static TTFs per subset/weight (pinned versions verified); pt-BR is fully covered by the `latin` subset (`latin-ext` shipped as hardening); all 26 shortlist families exist on Fontsource under OFL-1.1.

- **Curation**: 26 families / 50 variants, four PT vibe groups — Elegante (Playfair Display, Fraunces, DM Serif Display, Cormorant Garamond, Libre Caslon Text, Instrument Serif, Marcellus), Moderna (Montserrat, Poppins, Plus Jakarta Sans, Outfit, DM Sans, Inter, Sora, Bricolage Grotesque), Impacto (Bebas Neue, Oswald, Anton, Archivo Black, Barlow Condensed), Manuscrita (Dancing Script, Great Vibes, Pacifico, Caveat, Sacramento, Lobster). Frugal weights (mostly 400 + one bold); serif italics kept, sans italics cut. Total ≈ **3.5 MB** canonical.
- **Manifest**: hand-edited input `scripts/fonts/families.json` → build generates `supabase/functions/_shared/fonts/manifest.json` (pure JSON — sidesteps zod versions entirely; consumed by edge via JSON import, by CRM via the i18n-style cross-boundary import + alias) + `keys.ts` (generated const arrays for zod enums) + import-free `types.ts` + `ATTRIBUTION.md`. Docs reference fonts by `{font_key, font_weight, font_style}` — never raw family names.
- **Build script** `scripts/fonts/build.mjs` (Node, `fonts:build`): Fontsource API metadata + drift gate (fails loudly if a curated weight disappears) → download pinned static TTFs (latin + latin-ext per variant) → emit browser files to root `public/fonts/estudio/` (CRM publicDir) → picker preview strips via `subset-font@2.5.0` (~3 KB woff2 name-strips) → generate `fonts.css` (`@font-face` with `unicode-range`, lazy by spec) → `--upload` puts canonical TTFs to R2 `assets/fonts/v1/…` (shared prefix, **outside** tenant keyspace so quota/orphan tooling never touches it; idempotent sha-compare).
- **Single-format serving**: the browser fetches the **same public TTF URLs** for both browser-satori ArrayBuffers and the TipTap overlay `@font-face` — one download per variant, shared via HTTP cache (Vercel brotli closes the woff2 gap). Load-on-demand: only variants present in the open doc + picker selections; previews virtualized via IntersectionObserver. Immutable cache headers + `?v={manifest.version}` busting.
- **Brand matching** (`_shared/fonts/match.ts`, pure/import-free, one implementation for editor + MCP): normalize → exact key/name/alias → unique prefix → unique Levenshtein ≤ 2; ambiguity returns null (never guess). Editor picker pins "Marca" section first; unmatched brand fonts show "não incluída no Estúdio" — no silent substitution. Defaults when unmatched: template fonts, else `playfair-display`/`inter`.
- **Slice-1 verification item**: confirm satori's per-glyph fallback across two same-name font entries (latin file first, latin-ext second) behaves correctly. If unreliable, drop latin-ext entirely — the latin subset alone covers pt-BR (§0 facts), latin-ext is hardening only.

---

## 8. Image generation (`generate-image` + provider adapter)

Verified against ai.google.dev (2026-07-02): use classic `generateContent` (`POST /v1/models/gemini-3.1-flash-image:generateContent`, header `x-goog-api-key`) with `generationConfig.responseModalities: ["IMAGE"]` and `responseFormat.image.{aspectRatio, imageSize}`; response = base64 PNG in `candidates[0].content.parts[].inlineData`. All four ARs supported. Output dims @1K: 1024², 928×1152 (4:5), 768×1376 (9:16); @2K: doubled. Cost: **$0.045 @0.5K / $0.067 @1K / $0.101 @2K** (flash). A tracked js-genai bug reports `imageSize` being ignored on preview builds — **always parse the returned PNG IHDR and store actual dimensions**.

- **Quality default is placement-keyed**: `2K` for full-bleed backgrounds (1K's 928-wide 4:5 would upscale ~16% into a 1080 canvas), `1K` for inset/element images; overridable via `quality`.
- **Adapter**: `_shared/image-gen/{provider.ts, gemini.ts, core.ts}` — `ImageGenProvider.generate(req, signal) → { bytes, mime, width, height, model, outputTokens, costEstimateUsd }`; typed errors `ProviderSafetyError / ProviderTimeoutError / ProviderError` (raw detail logged, never returned). Per-attempt timeout 60 s, one retry on 429/5xx only, `thinkingLevel` default. Env: `GEMINI_API_KEY` — REQUIRED, throw if missing (document in CLAUDE.md). Store the PNG as returned — **no JPEG transcode here** (Instagram's JPEG requirement is satisfied by the design-render flatten; `files` already allows `image/png`).
- **Topology**: one shared core, two thin entrypoints — `supabase/functions/generate-image/` (CRM path: JWT ON, `buildCorsHeaders`, profile→conta) and the MCP tool `generate_image` (scope `images:generate`). Both run: feature gate `feature_ai_images` → burst limit (`check_rate_limit`: conta 20/h; MCP key 10/10 min — the rate table auto-purges >1 h, so windows must stay ≤3600 s) → monthly quota (succeeded-count vs `effective_plan_limit('rate_ai_images_per_month')`) → **insert ledger row `pending`** → provider → R2 `putObject` (new primitive in `_shared/r2.ts`; precedent exists in the thumbnail backfill fn) at `contas/{conta_id}/files/{uuid}.png` → `file_insert_with_quota` (storage quota; on quota rejection after spend: delete R2 object, mark `failed_storage_quota`) → ledger `succeeded` (+latency/tokens/cost; a supplied `post_id` is recorded on the ledger row ONLY — generated images are design assets, never `post_file_links` rows, per §5.2) → audit (`estudio.generate_image` / `mcp.generate_image`; metadata has model/AR/cost/file_id — **never the prompt**).
- **Failure envelope** `{ error: { code, message, retryable, retry_after? } }`, generic PT messages, provider internals logged only:

| Condition | code | retryable | counts quota? |
|---|---|---|---|
| plan lacks feature | `feature_disabled` | no | — |
| monthly quota exhausted | `quota_exhausted` | no (`retry_after` = next month) | — |
| burst limit | `rate_limited` | yes | — |
| provider timeout/5xx after retry | `provider_timeout` / `provider_error` | yes | **no** |
| safety refusal (no image part / block reason) | `safety_refusal` | no ("tente outro prompt") | **no** |
| storage quota | `storage_quota_exceeded` | no | no |
| R2/files failure after spend | `storage_error` | yes | no (cost logged) |

- **Plan quota placeholders** (product decision, §14): free 10/mo, starter 50, professional 200, agency 500 (≈$0.09 avg/image at a 2K-heavy mix); never NULL/unlimited while cost is linear. Google-side billing alert at ~2× the sum of plan caps.
- SynthID: present in the generated source PNG but effectively lost in the flattened export (fresh raster) — provenance is recorded in the ledger + files metadata, not promised via watermark.

---

## 9. MCP tools

Six new tools via the existing `register()` pattern (scope gate → run → audit → `jsonResult`). MCP arg shapes stay zod3; the DesignDoc arg is `z.record(z.unknown())` validated by the shared zod4 schema inside the handler (§3). The measure pass and `preview_design` mean the `mcp` function bundles the shared render core (§5.2) — satori + resvg + fonts/emoji caches — alongside its existing code. Registrar notes: `jsonResult` wraps everything as a text block, so `preview_design` needs an `imageResult` sibling returning a raw image content block; `insertAuditLog` swallows its own failures by design (verified), so a failed audit can never fail a paid call — and `auditArgs` gains an `(args, result)` form so spend audits carry `file_id`/cost without the prompt.

**Scopes** (added to `MCP_ALLOWED_SCOPES` + `apps/crm/src/lib/mcp-scopes.ts` labels + consent/keys tests): reads ride on `posts:read`; **`designs:write`** for design docs; **`images:generate`** for spend — an owner can grant design editing without granting money. `MCP_AGENT_PRESET` stays read-only.

| Tool | Scope | Shape (essentials) |
|---|---|---|
| `get_design` | posts:read | `{post_id}` → `{design (normalized), rev, render: {status, pages: [{page_id, file_id, preview_url (signed 1h), w, h}]}, post: {tipo, status}}`; no design → `{design: null, hint}` (not an error) |
| `create_design` | designs:write | `{post_id, design}` → gates `feature_estudio`; post status ∈ EDITABLE_STATUSES; **existing design → structured error "este post já tem um design — use update_design"** (never a raw unique-constraint error); validation §2.4 → insert rev 1, `updated_via='agent'`; `correcao_cliente` auto-moves to `revisao_interna` (a design change is a content edit); fires render → returns normalized doc + `layout` (measured bboxes §2.5) + `warnings` + `render: {status:'queued', rev}` |
| `update_design` | designs:write | `{post_id, design, expected_rev?}` — **full-doc replace** (docs ≤256 KB; total re-validation; patch ops rejected for v1: id/index drift breaks one-retry self-correction. v2 escape hatch: page-level replace). Guarded update on `rev`; mismatch → error naming current rev ("releia com get_design"). Omitted `expected_rev` = last-writer-wins (documented). Same `correcao_cliente` auto-move as create (a design change is a content edit) |
| `preview_design` | posts:read | `{post_id, page_id?, width?=512}` → renders **one** reduced page per call synchronously via the shared render core and returns an MCP **image content block** — Claude is multimodal; seeing the render collapses blind iterations. Cost honesty: embedded-photo decode dominates resvg and does **not** shrink with output size — a photo-heavy page at 512 is ~2× cheaper (not 8×), text-only pages much more; capped at one page/call to stay inside the CPU budget, and the 512 profile is part of the R1 load test |
| `generate_image` | images:generate | `{prompt (≤2000), aspect_ratio (4 values incl. 16:9), placement? ('background'\|'element' — keys the 2K/1K default), quality?, client_id?, reference_file_ids?, use_brand_logo?, post_id?, idempotency_key?}` → §8 pipeline (every supplied id tenant-verified; `post_id` recorded on the ledger only) → `{file_id, preview_url, width, height, quota: {used, limit, resets_at}}` |
| `get_design_capabilities` | posts:read | `{client_id?}` → formats/canvas presets + `post_tipo_mapping` (stories → null), font manifest (keys/weights/styles/groups), limits (§2.3), image-gen enabled + quota remaining, feature booleans (agent discovers gating instead of tripping on it), and per-client `brand`: hex colors, `logo_file_id` **when already materialized, else null** (a read tool never writes — materialization happens only via the `/brand-logo` route or `generate_image use_brand_logo`), `font_primary/secondary` as `{raw, resolved_key, fallback_key}` via the shared matcher. New tool, NOT an extension of `get_brand_profile` (that shape is a published contract consumed by the DK skills) |

Render trigger from create/update: fire-and-forget `fetch` to `design-render` with `x-cron-secret` (the analytics report-worker precedent), `.catch` logged; the row's `pending` status is the job, the sweep cron is the safety net. Audit metadata: `{post_id, format, page_count, layer_count, doc_bytes, rev}` — never doc contents (client copy lives in text layers).

Test plan mirrors `__tests__/mcp-writes_test.ts` (recording fake DB + `queueRpc`): tenancy scoping, status guards, aggregated validation issues, rev-guarded updates, correcao auto-move, render-trigger recording (rejection doesn't fail the tool), quota paths (provider not called when gated), audit redaction (secret text/prompt never in metadata), scope denials, plus dual-runtime schema fixture suites and a `design-render` worker suite (cron-secret rejection, stale-rev no-op, chunk self-invocation, claim/finish semantics, `post_file_links` rewrite incl. `is_cover`).

---

## 10. Security & tenancy summary

- Every table RLS'd with the member-check pattern + service-role bypass; every edge path re-verifies `conta_id` ownership of posts/files/designs before acting.
- Render-state and `doc_hash` columns are unwritable by clients (column grants); render artifacts charged through `file_insert_with_quota`.
- Signed URLs never enter design docs (file_id only); previews signed on read (1 h).
- No raw provider/satori errors reach clients; prompts stored only in the RLS'd ledger, never in audit logs; MCP image spend requires a dedicated scope.
- `GEMINI_API_KEY`, `CRON_SECRET` per existing conventions; design-render is cron-secret-only.

## 11. Testing strategy

- **Pure logic** (vitest): designDocOps, layerGeometry, snapMath, brand matcher, schema fixtures (shared with Deno suite).
- **Edge** (deno test): mcp-designs suite, design-render worker suite, generate-image core (fake provider), schema fixtures.
- **Editor** (RTL): picker flow, reducer/undo, autosave + conflict banner, smoke render.
- **Parity fixture**: one golden doc rendered by browser-satori (test env) and edge-satori must produce byte-identical SVG strings — the cheapest possible drift alarm for satori/font/emoji version skew.
- CI gates before every push: `npm run format && npm run lint && npm run build && npm run test && npm run test:functions` (build = tsc typecheck per CLAUDE.md; `test:functions` carries the required Deno permission flags — never the bare `deno test`).
- `deno.lock` discipline: PRs that **intentionally** add Deno dependencies (zod mapping, satori/resvg/jpeg imports) commit the updated lockfile; `git checkout deno.lock && npm ci` is only the recovery for *incidental* pollution from local runs.

## 12. Rollout

Per environment, strictly ordered (staging first, then prod with the identical sequence):

1. Migrations 000001–000003 via SQL editor (§4.4 procedure) + record versions. **000004 (cron schedule) NOT yet.**
2. Fonts build + R2 upload (`fonts:build --upload`); commit generated manifest + public assets.
3. `supabase/config.toml`: add `[functions.design-render]` / `[functions.design-render-sweep-cron]` with `verify_jwt = false` (+ update the config-audit test — the repo has `__tests__/config-audit_test.ts` guarding these entries).
4. Edge deploys (`--use-api`; `--no-verify-jwt` only for `design-render` + sweep cron): `design-render`, `design-render-sweep-cron`, `post-design-manage`, `generate-image`, `mcp`, plus `workspace-limits`/`platform-admin` (entitlements embed). The very first `design-render` deploy doubles as the **bundle smoke test**: `--use-api` deployments don't support static files and functions cap at 20 MB — our wasm loads from CDN/R2 at runtime, but this must be proven on real infra in PR 1.4, not assumed.
5. **Only now** apply + record migration 000004 — scheduling the cron before its function exists produces silent pg_cron-layer failures (known project gotcha).
6. Vercel (CRM + admin mirrors) last. Feature stays dark behind `feature_estudio` until enabled per plan.
7. Staging soak before prod: R1 load test on real edge hardware (spike numbers are laptop-local), seeded-doc → Hub DoD, then repeat 1–6 on prod.

## 13. Implementation slices (unchanged from approved outline, now concrete)

1. **Foundations**: migrations + shared schema module + fixtures + fonts build (incl. the latin-ext fallback check §7) + shared render core + `design-render` (single page, then chaining) + `post-design-manage` (§5.4) — DoD: seeded doc saved through the API → JPEGs → visible in Hub; edge load test incl. 9:16 and 512-preview profiles (R1).
2. **Editor MVP**: route/nav/picker/create-flow + canvas (satori preview, selection, drag/resize, snapping, IG safe-zone guides §6.6) + TipTap text overlay + image insert (upload/paste/dnd/Arquivos) + slide strip + undo/autosave + zoom.
3. **Brand kit + fonts in editor**: BrandPanel, FontPicker, brand matcher, logo_file_id materialization, ColorPicker with brand swatches.
4. **Lifecycle**: render-on-save, media ownership rules, schedule gating, "Abrir no Estúdio", stale-design guard in publish cron.
5. **MCP tools** (all six incl. preview_design + capabilities) + agent guidance doc.
6. **In-editor AI generation**: Gerar imagem panel + quota meter (uses the same core as slice 5's tool).
7. **Polish**: rotation handles, alignment/distribute, keyboard shortcuts, layer panel refinements, template groundwork.

## 14. Risks & open product decisions

| # | Risk | Mitigation |
|---|---|---|
| R1 | Edge CPU: 1080×1920 ≈ 1 s local → 2–4 s edge, may bust 2 s cap per page | Load-test on staging edge first thing in slice 1 (profiles: 4:5, 9:16, and the 512 preview); levers: pre-sized images (biggest, fast-follow), q80 JPEG, 546-fallback to Cloudflare Browser Rendering (documented escape hatch) |
| R2 | Text measurement (auto-grow heights) via satori+bbox on both sides is the largest unproven mechanism | Spike in slice 2 week 1 (it's ~30 lines); fallback: advisory measured heights persisted at normalization time |
| R3 | Interaction polish (drag/rotate/snap math) is bespoke and deceptively hard | Own the math in pure, heavily-tested modules; rotation handles deferred to slice 7 |
| R4 | satori ceiling: no kerning/ligatures, block-level pills, CSS subset | Accepted + documented; preview = render so users never see a mismatch; don't compare against Figma mocks |
| R5 | Conflict UX (human editor vs MCP writes) | rev locks + banner + localStorage stash; collision frequency is low |
| R6 | Image-gen spend | Two-layer quota + burst caps + succeeded-only counting + Google billing alert |
| R7 | Provider churn | Adapter interface; model ids pinned in one map |

**Open product decisions** (needed before slice 1 merges, none block starting):
(a) plan-tier assignment + quota seeds for `feature_estudio`/`feature_ai_images`/`rate_ai_images_per_month` (placeholders in §4.3/§8);
(b) whether Estúdio launches gated to specific plans or free-during-beta;
(c) prompt retention window (default: keep 12 months, then prune text).

## 15. Deferred (v2+)

Stories format · custom font upload (OTS sanitize + attestation + plan gate) · pro-tier image model (`gemini-3-pro-image`, style refs, 2-unit quota cost) · template library + sticker/arrow asset pack · pre-sized image variants for render speed · page-level replace op for MCP · gradient/outlined text · image crop/focal point · Twemoji R2 mirror · multi-select group transforms.
