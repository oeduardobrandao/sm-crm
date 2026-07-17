# KB Article Screenshots — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real screenshots to the 5 Tier-1 support articles, hosted on a public `kb-images` bucket so they render permanently for every reader.

**Architecture:** Three independent pieces. (1) A public Supabase Storage bucket `kb-images` mirroring the existing `avatars` bucket. (2) A Playwright `screenshots` project that reuses the existing `crm-auth` storageState to capture the real CRM against prod DK TESTE, behind a network-level safety net that aborts outward-facing calls. (3) A migration re-declaring each article's TipTap JSON with `inlineImage` nodes carrying `r2Key: null` and a permanent public `src`, nested inside each numbered `listItem`.

**Tech Stack:** Playwright 1.61 (`@playwright/test`, already configured), TipTap v3 (`@tiptap/starter-kit` ^3.22.0), Supabase Storage + Postgres migrations, Vitest, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-07-16-kb-article-screenshots-design.md`

## Global Constraints

- **Article content is TipTap/ProseMirror JSON in `kb_articles.content` (`jsonb`).** Not markdown, not HTML. `![]()` renders as literal text. There is no markdown parser and no `dangerouslySetInnerHTML` in the reader path.
- **Every `inlineImage` node MUST set `r2Key: null`.** A non-null `r2Key` routes the node through `sign-r2-urls`, which cannot sign body images and produces a URL that 403s after 3600s. This is the entire point of the design.
- **Author against `20260520000001_expand_kb_help_center.sql`**, never `20260519000002_seed_kb_articles.sql`. The former upserts (`ON CONFLICT (slug) DO UPDATE`) over the latter, which uses `DO NOTHING`.
- **Each migration declares its own prefixed helper set and drops it at the end.** This plan's prefix is `_kb_shot_`.
- **All `alt` text in pt-BR.** It is what screen-reader users get and what shows if the bucket is unavailable.
- **The capture target is prod.** Reversible in-app writes are permitted; outward-facing actions are blocked. Blocked: `invite-user` (email), `instagram-publish` (publishes for real), `billing-checkout`, `billing-portal`, `report-worker` (email). **Scheduling a post counts as outward-facing** — cron fires it later and publishes for real.
- **Never pass secrets as CLI arguments.** Credentials come from gitignored env files only (`.env.e2e.local`, covered by `.gitignore:11`; `e2e/.auth/` by `.gitignore:50`).
- **CI enforces `eslint` + `prettier --check` + coverage** despite CLAUDE.md saying "no linter". Run `npm run format` and `npm run lint` before every commit.
- **Viewport for all captures: 1440×900, `deviceScaleFactor: 2`, light theme.**

## File Structure

| File | Responsibility |
|---|---|
| `apps/crm/src/pages/ajuda/__tests__/inlineImageSchema.test.ts` | Create — guards the load-bearing schema assumption |
| `supabase/migrations/20260717000001_kb_images_bucket.sql` | Create — public bucket, read-only policy |
| `e2e/screenshots/safety.ts` | Create — network safety net, blocked-endpoint list |
| `e2e/screenshots/__tests__/safety.test.ts` | Create — proves the net aborts blocked calls |
| `e2e/screenshots/capture.ts` | Create — shared capture helper (viewport, theme, wait, write) |
| `e2e/screenshots/post-express.spec.ts` | Create — Tier-1 captures |
| `playwright.config.ts` | Modify — add `screenshots` project, excluded from CI |
| `package.json` | Modify — add `screenshots:capture` script |
| `scripts/upload-kb-images.mjs` | Create — uploads PNGs to `kb-images`, prints URL map |
| `supabase/migrations/20260717000002_kb_article_screenshots.sql` | Create — `_kb_shot_*` helpers + re-declared articles |
| `docs/superpowers/plans/2026-07-16-external-shot-list.md` | Create — manual capture instructions |

---

### Task 1: Guard the schema assumption

The whole design rests on `inlineImage` nesting inside a `listItem`. `ListItem` declares `content: "paragraph block*"` (`node_modules/@tiptap/extension-list/dist/item/index.cjs`) and `inlineImage` is `group: 'block'`, so this is legal. But TipTap **silently drops** nodes the schema rejects — this repo has already been bitten (see `docs/.../hub-tiptap-schema`). A silent drop here means shipping articles whose images vanish with no error. Test it before building on it.

**Files:**
- Test: `apps/crm/src/pages/ajuda/__tests__/inlineImageSchema.test.ts`

**Interfaces:**
- Consumes: `createInlineImageExtension` from `apps/crm/src/pages/entregas/components/InlineImageExtension`
- Produces: nothing — a standing regression test

- [ ] **Step 1: Write the failing test**

Use the reader's *exact* extension set from `ArtigoPage.tsx:53-68`, so the test fails if anyone changes it.

```ts
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createInlineImageExtension } from '../../entregas/components/InlineImageExtension';

const dummyUpload = async () => ({ r2Key: '', src: '', width: 0, height: 0 });

function imgNode(src: string) {
  return {
    type: 'inlineImage',
    attrs: { r2Key: null, src, alt: 'Tela de exemplo', width: 1440, height: 900 },
  };
}

describe('inlineImage in article schema', () => {
  it('survives a round-trip nested inside an ordered listItem', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Acesse Post Express' }] },
                imgNode('https://example.test/a.png'),
              ],
            },
          ],
        },
      ],
    };

    const editor = new Editor({
      extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), createInlineImageExtension(dummyUpload)],
      content: doc,
    });

    const out = JSON.stringify(editor.getJSON());
    expect(out).toContain('inlineImage');
    expect(out).toContain('https://example.test/a.png');
    editor.destroy();
  });

  it('preserves r2Key null so the node never routes through sign-r2-urls', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), createInlineImageExtension(dummyUpload)],
      content: { type: 'doc', content: [imgNode('https://example.test/b.png')] },
    });

    const json = editor.getJSON() as any;
    expect(json.content[0].attrs.r2Key).toBeNull();
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run it and confirm it passes**

Run: `npm run test -- inlineImageSchema`
Expected: 2 passed.

If the first test FAILS (no `inlineImage` in output), the node is being stripped — **stop and report**. The design's image placement must move from inside `listItem` to a sibling after the `orderedList`, and this plan needs revision before Task 6.

- [ ] **Step 3: Commit**

```bash
npm run format && npm run lint
git add apps/crm/src/pages/ajuda/__tests__/inlineImageSchema.test.ts
git commit -m "test(ajuda): guard inlineImage nesting inside article listItem"
```

---

### Task 2: Public `kb-images` bucket

**Files:**
- Create: `supabase/migrations/20260717000001_kb_images_bucket.sql`

**Interfaces:**
- Produces: bucket id `kb-images`; public URL shape `<SUPABASE_URL>/storage/v1/object/public/kb-images/<slug>/<NN>-<name>.png`

- [ ] **Step 1: Write the migration**

Mirrors `20260319_avatars_bucket.sql` with one deliberate deviation, documented inline.

```sql
-- Public bucket for Knowledge Base article screenshots.
--
-- These are app assets (like the logo), not tenant content: they are captured
-- from a demo workspace and shown identically to every reader. Serving them
-- public and permanent is what makes them immune to the body-image expiry bug
-- (sign-r2-urls only re-signs kb_articles.cover_image_url, never images inside
-- the content JSONB, so a signed body image 403s once its 3600s URL expires).
insert into storage.buckets (id, name, public)
values ('kb-images', 'kb-images', true)
on conflict (id) do nothing;

-- Public read. No write policy: uploads run with the service role key, which
-- bypasses RLS entirely.
--
-- NOTE: deliberately narrower than the avatars bucket. avatars_service_write is
-- `for insert with check (bucket_id = 'avatars')` with no role restriction --
-- its comment claims "service role" but as written any authenticated user can
-- insert. That policy is both unnecessary (service role bypasses RLS) and too
-- permissive. Not replicated here.
drop policy if exists "kb_images_public_read" on storage.objects;
create policy "kb_images_public_read"
  on storage.objects for select
  using (bucket_id = 'kb-images');
```

- [ ] **Step 2: Confirm which project is linked before pushing**

Run: `cat supabase/.temp/project-ref`
Expected: prints a project ref. **The repo defaults to PROD.** Confirm this is the intended target with the user before any `--linked` command — this repo has an incident on record from applying migrations to prod by accident.

- [ ] **Step 3: Apply and verify**

```bash
npx supabase db push --linked
```

Verify in the SQL editor:
```sql
select id, public from storage.buckets where id = 'kb-images';
```
Expected: one row, `public = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260717000001_kb_images_bucket.sql
git commit -m "feat(kb): add public kb-images bucket for article screenshots"
```

---

### Task 3: Capture harness + network safety net

The safety net is defense in depth. Control 1 is never clicking the button; control 2 is aborting the request at the network layer so a misclick, a stray Enter, or a re-render cannot fire a real publish or email.

**Files:**
- Create: `e2e/screenshots/safety.ts`
- Create: `e2e/screenshots/__tests__/safety.test.ts`
- Create: `e2e/screenshots/capture.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `BLOCKED_FUNCTIONS: readonly string[]`
  - `isBlockedUrl(url: string): boolean`
  - `installSafetyNet(page: Page): Promise<string[]>` — returns a live violations array
  - `assertNoViolations(violations: string[]): void`
  - `shoot(page: Page, slug: string, index: number, name: string): Promise<void>`
  - `SHOT_DIR: string`

- [ ] **Step 1: Write the failing test for the URL matcher**

```ts
import { describe, it, expect } from 'vitest';
import { isBlockedUrl, BLOCKED_FUNCTIONS, assertNoViolations } from '../safety';

const FN = 'https://xyz.supabase.co/functions/v1';

describe('capture safety net', () => {
  it('blocks outward-facing edge functions', () => {
    expect(isBlockedUrl(`${FN}/instagram-publish`)).toBe(true);
    expect(isBlockedUrl(`${FN}/invite-user`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-checkout`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-portal`)).toBe(true);
    expect(isBlockedUrl(`${FN}/report-worker`)).toBe(true);
  });

  it('allows read paths needed for screenshots', () => {
    expect(isBlockedUrl(`${FN}/sign-r2-urls`)).toBe(false);
    expect(isBlockedUrl(`${FN}/hub-dashboard`)).toBe(false);
    expect(isBlockedUrl('https://xyz.supabase.co/rest/v1/clientes?select=*')).toBe(false);
  });

  it('does not blocklist by loose substring', () => {
    // instagram-publish-cron is cron-only and never called from the browser,
    // but a substring matcher would also catch e.g. a future
    // "instagram-publish-preview" read endpoint. Match the segment exactly.
    expect(isBlockedUrl(`${FN}/instagram-published-posts`)).toBe(false);
  });

  it('exposes the blocked list for documentation', () => {
    expect(BLOCKED_FUNCTIONS).toContain('instagram-publish');
  });

  it('assertNoViolations throws when a blocked call was attempted', () => {
    expect(() => assertNoViolations([`${FN}/instagram-publish`])).toThrow(/instagram-publish/);
  });

  it('assertNoViolations passes on a clean run', () => {
    expect(() => assertNoViolations([])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- safety`
Expected: FAIL — cannot resolve `../safety`.

- [ ] **Step 3: Implement `e2e/screenshots/safety.ts`**

```ts
import type { Page } from '@playwright/test';

/**
 * Edge functions that act outside the system. Captures run against PROD, so a
 * misclick here sends a real email or publishes to a real Instagram account.
 *
 * Scheduling is deliberately treated as outward-facing: the button looks
 * harmless at click time, but instagram-publish-cron fires it later and
 * publishes for real.
 */
export const BLOCKED_FUNCTIONS = [
  'instagram-publish', // publishes to a real IG account
  'invite-user', // sends a real invite email (Resend)
  'report-worker', // sends report emails (Resend)
  'billing-checkout', // Stripe; prod and staging share one account
  'billing-portal',
] as const;

const FN_SEGMENT = /\/functions\/v1\/([^/?#]+)/;

export function isBlockedUrl(url: string): boolean {
  const match = FN_SEGMENT.exec(url);
  if (!match) return false;
  return (BLOCKED_FUNCTIONS as readonly string[]).includes(match[1]);
}

/**
 * Aborts blocked calls at the network layer.
 *
 * Returns a live array that accumulates any blocked URL. The caller MUST pass
 * it to assertNoViolations() at the end of the test: throwing from inside a
 * route handler does NOT fail the test -- it surfaces as an unhandled
 * rejection, so the run would abort the call but still report green. A silent
 * pass is the one outcome a safety net must never have.
 */
export async function installSafetyNet(page: Page): Promise<string[]> {
  const violations: string[] = [];

  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    if (isBlockedUrl(url)) {
      violations.push(url);
      // eslint-disable-next-line no-console
      console.error(`[safety] BLOCKED outward-facing call: ${url}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  return violations;
}

/** Fails the test if the capture attempted any outward-facing call. */
export function assertNoViolations(violations: string[]): void {
  if (violations.length > 0) {
    throw new Error(
      `Capture attempted ${violations.length} blocked outward-facing call(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- safety`
Expected: 6 passed.

- [ ] **Step 5: Implement `e2e/screenshots/capture.ts`**

```ts
import type { Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Gitignored staging dir; PNGs are reviewed here before upload. */
export const SHOT_DIR = path.join(__dirname, '..', '.shots');

export async function shoot(page: Page, slug: string, index: number, name: string): Promise<void> {
  const dir = path.join(SHOT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
}
```

- [ ] **Step 6: Gitignore the staging dir**

Append to `.gitignore`:
```
e2e/.shots/
```

- [ ] **Step 7: Add the `screenshots` Playwright project**

In `playwright.config.ts`, add to the `projects` array after the existing `crm` project. It reuses `crm-auth` for login and pins the capture viewport.

```ts
    {
      name: 'screenshots',
      testDir: './e2e/screenshots',
      dependencies: ['crm-auth'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CRM_BASE_URL,
        storageState: authFile,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
      },
    },
```

Then exclude it from the default `test:e2e` run — it targets prod and needs credentials. The existing `crm` project uses `testDir: './e2e/crm'`, and `hub` uses `'./e2e/hub'`, so `./e2e/screenshots` is already outside both. Confirm in Step 9.

- [ ] **Step 8: Add the npm script**

In `package.json` `scripts`:
```json
"screenshots:capture": "playwright test --project=screenshots",
```

- [ ] **Step 9: Verify the default e2e run does not pick up screenshots**

Run: `npx playwright test --list 2>&1 | grep -c screenshots`
Expected: `0` — no screenshot specs in the default run.

- [ ] **Step 10: Commit**

```bash
npm run format && npm run lint
git add e2e/screenshots/safety.ts e2e/screenshots/capture.ts e2e/screenshots/__tests__/safety.test.ts playwright.config.ts package.json .gitignore
git commit -m "feat(e2e): add screenshots capture harness with outward-action safety net"
```

---

### Task 4: Capture the Post Express article

Post Express is the proving ground: fully in-app, six numbered steps, no external screens. Its final step is `'Confira o preview e publique'` — capture the preview with the publish button visible and **never click it**.

**Files:**
- Create: `e2e/screenshots/post-express.spec.ts`

**Interfaces:**
- Consumes: `installSafetyNet`, `assertNoViolations`, `shoot`, `SHOT_DIR` from Task 3
- Produces: PNGs at `e2e/.shots/como-usar-o-post-express/01..06-*.png`

- [ ] **Step 1: Prerequisite — the user must supply credentials**

`.env.e2e.local` must exist with the DK TESTE login. If absent, copy the template and **ask the user to fill it in** — do not attempt to source credentials any other way:

```bash
test -f .env.e2e.local || cp .env.e2e.local.example .env.e2e.local
```

Required keys: `E2E_CRM_EMAIL`, `E2E_CRM_PASSWORD`.

- [ ] **Step 2: Audit DK TESTE for real client data before capturing anything**

Log in and inspect the workspace switcher, the client list, and the sidebar. The real agency is DK Marketing Médico; a test workspace may still surface real doctors' names. **Report anything real to the user before capturing.** Once published to all customers, a leak is permanent.

- [ ] **Step 3: Determine how scheduling is implemented**

The safety net blocks edge functions. If scheduling is a direct PostgREST write (`posts.scheduled_at`) rather than a call to `instagram-publish`, the net will not catch it and "never click" is the only control.

Run: `grep -rn "scheduled_at" apps/crm/src/store.ts apps/crm/src/services/ | head`

Record the finding in a comment at the top of the spec. If it is a direct write, note explicitly that the schedule control must not be touched.

- [ ] **Step 4: Write the capture spec**

Selectors below are illustrative of intent — resolve each against the live DOM as you go, preferring role/text selectors over CSS. The `shoot` index MUST match the step number in the article's `ol`.

```ts
import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-usar-o-post-express';

// Scheduling implementation: see Task 4 Step 3 finding.
// The publish control is NEVER clicked. installSafetyNet aborts
// instagram-publish at the network layer as a backstop.

test.describe.configure({ mode: 'serial' });

test('post express walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Step 1 — 'Acesse Post Express'
  await page.goto('/post-express');
  await page.getByRole('heading', { name: /post express/i }).waitFor();
  await shoot(page, SLUG, 1, 'acessar-post-express');

  // Step 2 — 'Selecione o cliente'
  await page.getByRole('combobox').first().click();
  await shoot(page, SLUG, 2, 'selecionar-cliente');
  await page.getByRole('option').first().click();

  // Step 3 — 'Envie a mídia ou mídias do post'
  await shoot(page, SLUG, 3, 'enviar-midia');

  // Step 4 — 'Revise o tipo detectado: feed, reels ou carrossel'
  await shoot(page, SLUG, 4, 'tipo-detectado');

  // Step 5 — 'Escreva a legenda com até 2.200 caracteres'
  await page.getByRole('textbox').first().fill('Exemplo de legenda para o artigo de ajuda.');
  await shoot(page, SLUG, 5, 'escrever-legenda');

  // Step 6 — 'Confira o preview e publique'
  // Capture the pre-click state only. Do NOT click publish.
  await shoot(page, SLUG, 6, 'preview-e-publicar');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
```

- [ ] **Step 5: Run the capture**

Run: `npm run screenshots:capture`
Expected: PASS, and 6 PNGs in `e2e/.shots/como-usar-o-post-express/`.

Verify: `ls -1 e2e/.shots/como-usar-o-post-express/ | wc -l` → `6`

- [ ] **Step 6: Review every PNG for real data**

Open each. Check for real client names, emails, revenue figures, and `mesaas_sk_…` keys. **Do not proceed to upload until this passes.** Report anything found.

- [ ] **Step 7: Commit the spec (not the PNGs — `.shots/` is gitignored)**

```bash
npm run format && npm run lint
git add e2e/screenshots/post-express.spec.ts
git commit -m "feat(e2e): capture Post Express walkthrough screenshots"
```

---

### Task 5: Upload script

**Files:**
- Create: `scripts/upload-kb-images.mjs`

**Interfaces:**
- Consumes: `SHOT_DIR` layout from Task 3 (`<slug>/<NN>-<name>.png`)
- Produces: a printed slug→URL map; objects in `kb-images` at `<slug>/<NN>-<name>.png`

- [ ] **Step 1: Write the script**

Takes the service-role key from the environment via a gitignored env file — never a CLI argument.

```js
// Uploads reviewed KB screenshots to the public kb-images bucket and prints the
// public URL for each, ready to paste into the article migration.
//
// Usage:
//   node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs
//
// .env.kb-upload.local (gitignored via .env.*.local) must define:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BUCKET = 'kb-images';
const SHOT_DIR = path.join(process.cwd(), 'e2e', '.shots');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Use --env-file.');
  process.exit(1);
}
if (!existsSync(SHOT_DIR)) {
  console.error(`No screenshots at ${SHOT_DIR}. Run: npm run screenshots:capture`);
  process.exit(1);
}

const supabase = createClient(url, key);

for (const slug of readdirSync(SHOT_DIR)) {
  const dir = path.join(SHOT_DIR, slug);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  console.log(`\n-- ${slug}`);
  for (const file of files) {
    const objectPath = `${slug}/${file}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, readFileSync(path.join(dir, file)), {
        contentType: 'image/png',
        upsert: true,
      });
    if (error) {
      console.error(`FAILED ${objectPath}: ${error.message}`);
      process.exit(1);
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    console.log(`${file} -> ${data.publicUrl}`);
  }
}
```

- [ ] **Step 2: Create the gitignored env file**

```bash
test -f .env.kb-upload.local || printf 'SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=\n' > .env.kb-upload.local
```

Ask the user to fill it in. Confirm it is ignored: `git check-ignore .env.kb-upload.local` → prints the path.

- [ ] **Step 3: Run the upload**

Run: `node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs`
Expected: 6 lines of `NN-name.png -> https://<ref>.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/NN-name.png`

- [ ] **Step 4: Verify a URL is publicly readable with no auth**

```bash
curl -s -o /dev/null -w '%{http_code}\n' '<paste one printed URL>'
```
Expected: `200`. This is the assertion the old signed path fails.

- [ ] **Step 5: Commit**

```bash
npm run format
git add scripts/upload-kb-images.mjs
git commit -m "feat(kb): add upload script for public KB article screenshots"
```

---

### Task 6: Author Post Express with images — end-to-end proof

This task proves the whole design. After it, one real article renders real screenshots permanently.

**Files:**
- Create: `supabase/migrations/20260717000002_kb_article_screenshots.sql`

**Interfaces:**
- Consumes: public URLs from Task 5
- Produces: `_kb_shot_img`, `_kb_shot_ol_shots`, and the `_kb_shot_*` helper set for Tasks 7-10

- [ ] **Step 1: Write the migration**

The content below is `20260520000001_expand_kb_help_center.sql:443-477` re-declared verbatim except for the `ol`, which becomes `_kb_shot_ol_shots`. Replace each `REPLACE_ME_NN` with the matching URL printed in Task 5. Width/height are the capture viewport (1440×900) — `deviceScaleFactor: 2` affects pixel density, not the CSS dimensions TipTap lays out with.

```sql
-- Add screenshots to Tier-1 procedural KB articles.
--
-- Images are inlineImage nodes with r2Key = NULL and a permanent public URL
-- from the kb-images bucket. r2Key MUST stay NULL: a non-null value routes the
-- node through sign-r2-urls, which only re-signs kb_articles.cover_image_url
-- and never images inside the content JSONB -- so the node would keep its
-- 3600s presigned src and 403 an hour after authoring.
--
-- Articles are re-declared in full (not patched) because
-- _kb_shot_upsert_article takes the whole doc, matching the pattern used by
-- 20260625000002. Source of truth for the prose is
-- 20260520000001_expand_kb_help_center.sql, which upserts over the original
-- 20260519000002 seed.

CREATE OR REPLACE FUNCTION _kb_shot_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_shot_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_shot_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_shot_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_shot_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

-- An inlineImage node. r2Key is always NULL -- see header comment.
CREATE OR REPLACE FUNCTION _kb_shot_img(src text, alt text, w int, h int) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object(
    'r2Key', NULL,
    'src', src,
    'alt', alt,
    'width', w,
    'height', h,
    'blurSrc', NULL,
    'displayWidth', NULL,
    'loading', false
  ));
$$ LANGUAGE sql IMMUTABLE;

-- An orderedList where step i carries an optional screenshot beneath its text.
-- listItem content spec is "paragraph block*" and inlineImage is group 'block',
-- so [paragraph, inlineImage] is schema-valid (guarded by the vitest in
-- apps/crm/src/pages/ajuda/__tests__/inlineImageSchema.test.ts).
-- images[i] may be NULL for steps without a capture.
CREATE OR REPLACE FUNCTION _kb_shot_ol_shots(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_shot_p(items[i]))
             ELSE jsonb_build_array(_kb_shot_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

-- inlineImage nodes carry no 'text', so they are naturally skipped.
CREATE OR REPLACE FUNCTION _kb_shot_plain(doc jsonb) RETURNS text AS $$
  WITH RECURSIVE nodes AS (
    SELECT doc AS node
    UNION ALL
    SELECT jsonb_array_elements(node->'content') AS node
    FROM nodes
    WHERE node->'content' IS NOT NULL AND jsonb_typeof(node->'content') = 'array'
  )
  SELECT coalesce(string_agg(node->>'text', ' '), '')
  FROM nodes
  WHERE node->>'type' = 'text';
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_upsert_article(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_shot_plain(p_content), p_category, p_tags, 'published', p_display_order)
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    content = EXCLUDED.content,
    content_plain = EXCLUDED.content_plain,
    category = EXCLUDED.category,
    tags = EXCLUDED.tags,
    status = EXCLUDED.status,
    display_order = EXCLUDED.display_order;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Como usar o Post Express
-- ============================================================
SELECT _kb_shot_upsert_article(
  'aaaaaaaa-000b-4000-a000-00000000000b',
  'Como usar o Post Express',
  'como-usar-o-post-express',
  'Publique rapidamente no Instagram sem montar uma entrega completa.',
  _kb_shot_doc(
    _kb_shot_h(2, 'O que é o Post Express?'),
    _kb_shot_p('O Post Express publica conteúdo direto no Instagram de um cliente conectado. Ele é indicado para conteúdos rápidos, urgentes ou pontuais, quando você não precisa montar um fluxo completo de produção.'),
    _kb_shot_h(2, 'Quem aparece na seleção'),
    _kb_shot_p('A lista mostra clientes com conta de Instagram conectada. Se um cliente não aparece, revise a conexão, o status da autorização e as permissões de publicação.'),
    _kb_shot_h(2, 'Como publicar'),
    _kb_shot_ol_shots(
      ARRAY[
        'Acesse Post Express',
        'Selecione o cliente',
        'Envie a mídia ou mídias do post',
        'Revise o tipo detectado: feed, reels ou carrossel',
        'Escreva a legenda com até 2.200 caracteres',
        'Confira o preview e publique'
      ],
      ARRAY[
        _kb_shot_img('REPLACE_ME_01', 'Tela do Post Express aberta, com a lista de clientes disponível.', 1440, 900),
        _kb_shot_img('REPLACE_ME_02', 'Seletor de cliente aberto, mostrando as contas com Instagram conectado.', 1440, 900),
        _kb_shot_img('REPLACE_ME_03', 'Área de envio de mídia do Post Express.', 1440, 900),
        _kb_shot_img('REPLACE_ME_04', 'Tipo do post detectado automaticamente a partir da mídia enviada.', 1440, 900),
        _kb_shot_img('REPLACE_ME_05', 'Campo de legenda preenchido, com o contador de caracteres visível.', 1440, 900),
        _kb_shot_img('REPLACE_ME_06', 'Preview final do post ao lado do botão de publicar.', 1440, 900)
      ]
    ),
    _kb_shot_callout('💡', 'blue', 'O tipo é detectado pela mídia: várias imagens viram carrossel, vídeo tende a Reels e imagem única vira Feed. Vídeos podem exigir thumbnail para publicação.'),
    _kb_shot_h(2, 'O que acontece nos bastidores'),
    _kb_shot_p('O CRM cria um registro operacional para manter histórico da publicação. Se você abandonar um rascunho vazio, ele pode ser limpo automaticamente. Quando a publicação termina, o post fica registrado como concluído ou com erro para acompanhamento.'),
    _kb_shot_h(2, 'Erros comuns'),
    _kb_shot_ul(ARRAY[
      'Token expirado ou revogado',
      'Permissão de publicação ausente',
      'Legenda vazia ou acima do limite',
      'Vídeo sem thumbnail quando exigido',
      'Conta do cliente desconectada'
    ])
  ),
  'post-express',
  ARRAY['post-express', 'publicacao', 'instagram', 'rapido', 'thumbnail', 'permissoes'],
  60
);

-- ============================================================
-- Cleanup helper functions (matches the pattern in prior kb migrations)
-- ============================================================
DROP FUNCTION IF EXISTS _kb_shot_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_shot_ol_shots(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot_img(text, text, int, int);
DROP FUNCTION IF EXISTS _kb_shot_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_shot_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_shot_ul(text[]);
DROP FUNCTION IF EXISTS _kb_shot_h(int, text);
DROP FUNCTION IF EXISTS _kb_shot_p(text);
DROP FUNCTION IF EXISTS _kb_shot_text(text);
```

**Note for Tasks 7-10:** those tasks reuse this helper set, so they must be authored in **this same migration file**, above the cleanup block. The `DROP` statements stay last.

- [ ] **Step 2: Paste the real URLs**

Replace all six `REPLACE_ME_NN` with the URLs printed in Task 5. Verify none remain:

Run: `grep -c REPLACE_ME supabase/migrations/20260717000002_kb_article_screenshots.sql`
Expected: `0`

- [ ] **Step 3: Confirm the linked project, then apply**

```bash
cat supabase/.temp/project-ref
npx supabase db push --linked
```

- [ ] **Step 4: Verify the JSON landed with `r2Key` null**

```sql
select jsonb_path_query_first(content, '$.**.attrs.r2Key') as r2key,
       jsonb_path_query_first(content, '$.**.attrs.src')   as src
from kb_articles where slug = 'como-usar-o-post-express';
```
Expected: `r2key` is `null`; `src` is a `.../storage/v1/object/public/kb-images/...` URL.

- [ ] **Step 5: The proof — verify as a real reader**

Open `/ajuda/como-usar-o-post-express` in the CRM, logged in as a user **in a different conta than the uploader**. Confirm all six screenshots render beneath their numbered steps.

Then confirm the network tab shows **no `sign-r2-urls` request for these images** — that absence is what makes them permanent. This is the exact assertion the current body-image path fails.

- [ ] **Step 6: Confirm search still works**

`content_plain` must contain the prose and no image noise:
```sql
select left(content_plain, 120) from kb_articles where slug = 'como-usar-o-post-express';
```
Expected: prose beginning "O que é o Post Express?…" with no URLs.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260717000002_kb_article_screenshots.sql
git commit -m "feat(kb): add screenshots to Post Express article"
```

---

### Tasks 7-10: Remaining Tier-1 articles

Each follows Task 6 exactly: capture spec (Task 4 pattern) → review PNGs → upload (Task 5) → append a `_kb_shot_upsert_article` call to `20260717000002_kb_article_screenshots.sql` above the `DROP` block → verify as a cross-conta reader.

The pattern is identical; only the content differs. Per-article specifics:

**Fixture cleanup (required before Task 7 creates anything on prod).** Any entity a capture creates must be named with the literal prefix `ZZ-AJUDA-DEMO` so it is unambiguous in the UI and trivially greppable. Cleanup runs in a `beforeAll` **and** an `afterAll` — before, because a previous run may have crashed mid-way and left litter that would otherwise accumulate on prod indefinitely; after, for the normal path. Add to `e2e/screenshots/capture.ts`:

```ts
export const FIXTURE_PREFIX = 'ZZ-AJUDA-DEMO';
```

Deletion goes through the same UI/API path a user would use — never a raw service-role delete from a capture run. Post Express needs no cleanup: it creates only a draft record, which `express-post-cleanup-cron` reaps automatically ("Se você abandonar um rascunho vazio, ele pode ser limpo automaticamente").

| Task | Article | Source | Route | Steps | Safety |
|---|---|---|---|---|---|
| 7 | `como-criar-e-gerenciar-fluxos` | `20260520000001:280-312` | `/entregas` | 6-step `ol` + 5 view modes (Kanban/Gráfico/Calendário/Lista/Concluídas) — capture each view | Creating a fluxo is a safe reversible write; name it `ZZ-AJUDA-DEMO` and clean up before/after |
| 8 | `como-configurar-o-hub-do-cliente` | `20260520000001:345-377` | `/clientes/:id` | 5-step `ol`; the Ativar/Visualizar/Copiar-link cluster | Do not send the link to a client |
| 9 | `como-conectar-o-instagram` | `20260520000001:379-414` | `/clientes/:id` | 5-step `ol`; steps 1-2 in-app, **steps 3-5 are Facebook** → Task 11 | `instagram-publish` blocked; never complete a real OAuth re-auth |
| 10 | `como-conectar-o-claude-mcp` | `20260624000002:113-153` | `/configuracao/mcp` | two 3-step `ol`s; Mesaas side only, **Claude connector UI** → Task 11 | Never expose a real `mesaas_sk_…` key — redact or use a scratch key |

For steps whose capture comes from Task 11, pass `NULL` in the `images` array position until the manual PNG is supplied — `_kb_shot_ol_shots` handles `NULL` per-step.

---

### Task 11: External shot list

**Files:**
- Create: `docs/superpowers/plans/2026-07-16-external-shot-list.md`

Claude's connector UI and Facebook's OAuth consent cannot be reached by Playwright against localhost. The user captures these.

- [ ] **Step 1: Write the shot list**

For each shot: the exact screen, the required state, the target filename (`<slug>/<NN>-<name>.png` under `e2e/.shots/`), and what to redact.

**`como-conectar-o-claude-mcp`** — steps 3-5 of the first `ol`:
- Claude → Configurações → Conectores (list view)
- "Adicionar conector personalizado" dialog, MCP URL pasted, **OAuth fields visibly empty** — this is the counterintuitive instruction the article can't convey in text
- Mesaas authorization screen with workspace selector and permission scopes

**`como-conectar-o-instagram`** — steps 3-5:
- Facebook authorization screen
- Linked-page selector showing multiple pages
- Permission confirmation screen

**Redact in every shot:** account email, unrelated workspace names, any `mesaas_sk_…` key, real client/doctor names.

- [ ] **Step 2: Deliver to the user and wait**

Drop PNGs into `e2e/.shots/<slug>/` using the listed filenames, then re-run Task 5's upload and fill the `NULL` slots in the migration.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-16-external-shot-list.md
git commit -m "docs(kb): add external screen shot list for MCP and Instagram articles"
```

---

## Out of scope — file separately

- **`/configuracao/mcp` context links are dead.** `ContextHelpLinks.tsx:9` collapses the pathname to its first segment and `store/kb.ts:53` does an exact `.eq('route_pattern', route)`, so the three MCP articles seeded at `20260624000002:244-246` can never surface in-context. The article enriched in Task 10 is the highest-value one in this plan and users cannot reach it from the page it documents.
- **`platform_admins` has no `conta_id`**, so a platform admin who is not also a CRM user gets 403 on every admin image upload. This plan bypasses that path (service-role upload), leaving the trap armed for admin-editor users.
- **The admin editor has no image toolbar button** — paste/drop only (`InlineImageExtension.tsx:281-307`).
