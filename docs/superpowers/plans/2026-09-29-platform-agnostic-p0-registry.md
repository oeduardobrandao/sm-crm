# Platform-agnostic posts — P0: platform registry + neutral format labels

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared platform registry (content formats, platform definitions, limits) imported by the CRM, the Hub and the edge functions. Content-format labels become platform-neutral. No database change.

**Architecture:** The registry is a dependency-free TypeScript module at `supabase/functions/_shared/platform-registry.ts`.
- Deno imports it by relative path.
- The CRM, the Hub and Vitest import it through a new alias, `@mesaas/platforms`.
- The duplicated `'feed' | 'reels' | 'stories' | 'carrossel'` literals across the apps and functions are replaced by the registry's `ContentFormat` type and `CONTENT_FORMATS` tuple.
- Where a post's content format is shown (boards, calendar, Hub cards), the labels come from `CONTENT_FORMAT_LABELS`. Instagram-only surfaces (Post Express, Instagram analytics) keep "Reels"/"Feed".

**Tech Stack:** TypeScript, Vite aliases, Vitest, Deno (`deno check`), react-i18next JSON locales.

**Spec:** `docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md` (sections "Formats", "Shared platform registry").

## Global Constraints

- The branch is `claude/platform-agnostic-config-0e0db5`. Before starting, check it is still level with `origin/main`: run `git fetch origin main && git log --oneline HEAD..origin/main`, and merge main if that prints anything.
- The registry file has **zero imports** and uses no Deno or DOM globals. The type-checkers for Deno and for all three apps each read it.
- The registry uses double quotes and trailing commas, i.e. `deno fmt` style: it lives under `supabase/functions/`, which `prettier`/`eslint` do not cover.
- The `tipo` DB values stay exactly `feed | reels | stories | carrossel`. P0 changes labels only, never stored values.
- **Neutral labels (pt):** feed → `Imagem`, carrossel → `Carrossel`, reels → `Vídeo vertical`, stories → `Stories`.
- **Neutral labels (en):** feed → `Image`, carrossel → `Carousel`, reels → `Vertical video`, stories → `Stories`.
- **Keep Instagram vocabulary** in these files:
  - `pages/post-express/*` and `posts.json` → `postType` (Post Express only publishes to Instagram)
  - `hubHome.json` → `topPosts.tipoLabel` (IG media types)
  - `clients.json:386` (IG analytics)
  - `TopPostsRow.tsx`
  - `TikTokSettingsPanel.tsx`
- No em dashes in new user-facing copy (house rule).
- Before pushing, all of these must pass: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`. After any Deno run, run `ls node_modules/.deno` and, if it exists, `npm ci`: Deno pollutes `node_modules`.

---

### Task 1: Registry module + `@mesaas/platforms` alias

**Files:**
- Create: `supabase/functions/_shared/platform-registry.ts`
- Modify:
  - `apps/crm/vite.config.ts:12-21` (alias block)
  - `apps/hub/vite.config.ts:10-18` (alias block)
  - `vitest.config.ts:8-18` (alias block)
  - `apps/crm/tsconfig.json` (`paths`)
  - `apps/hub/tsconfig.json` (`paths`)
- Test: `apps/crm/src/lib/__tests__/platformRegistry.test.ts`

**Interfaces:**
- Produces (every later task and P1 relies on these exact names):
  - `CONTENT_FORMATS: readonly ["feed", "carrossel", "reels", "stories"]`. This is display order and is also used for `z.enum`.
  - `type ContentFormat`
  - `CONTENT_FORMAT_LABELS: Record<ContentFormat, string>` (pt)
  - `PLATFORM_IDS: readonly ["instagram", "tiktok", "geral"]`
  - `type PlatformId`
  - `interface PlatformDef`
  - `PLATFORM_DEFS: Record<PlatformId, PlatformDef>`
  - `COMING_SOON_PLATFORMS: readonly { id: string; label: string }[]`
  - `supportsFormat(platform: PlatformId, tipo: ContentFormat): boolean`
  - `captionMaxFor(platform: PlatformId, tipo: ContentFormat): number | null`
  - `IG_CAPTION_MAX = 2200`

- [ ] **Step 1: Write the failing test**

`apps/crm/src/lib/__tests__/platformRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABELS,
  PLATFORM_IDS,
  PLATFORM_DEFS,
  COMING_SOON_PLATFORMS,
  IG_CAPTION_MAX,
  supportsFormat,
  captionMaxFor,
} from '@mesaas/platforms';

describe('platform registry', () => {
  it('keeps the four stored tipo values, in display order', () => {
    expect(CONTENT_FORMATS).toEqual(['feed', 'carrossel', 'reels', 'stories']);
  });

  it('labels content formats neutrally', () => {
    expect(CONTENT_FORMAT_LABELS).toEqual({
      feed: 'Imagem',
      carrossel: 'Carrossel',
      reels: 'Vídeo vertical',
      stories: 'Stories',
    });
  });

  it('lists instagram, tiktok and geral as selectable platforms', () => {
    expect(PLATFORM_IDS).toEqual(['instagram', 'tiktok', 'geral']);
    expect(COMING_SOON_PLATFORMS.map((p) => p.id)).toEqual(['youtube']);
  });

  it('only geral skips auto-publishing', () => {
    expect(PLATFORM_IDS.filter((p) => !PLATFORM_DEFS[p].autoPublish)).toEqual(['geral']);
  });

  it('gates tiktok behind feature_tiktok', () => {
    expect(PLATFORM_DEFS.tiktok.planFeature).toBe('feature_tiktok');
    expect(PLATFORM_DEFS.instagram.planFeature).toBeNull();
    expect(PLATFORM_DEFS.geral.planFeature).toBeNull();
  });

  it('tiktok has no stories; instagram and geral take every format', () => {
    expect(supportsFormat('tiktok', 'stories')).toBe(false);
    for (const f of CONTENT_FORMATS) {
      expect(supportsFormat('instagram', f)).toBe(true);
      expect(supportsFormat('geral', f)).toBe(true);
    }
  });

  it('caption limits per platform and format', () => {
    expect(IG_CAPTION_MAX).toBe(2200);
    expect(captionMaxFor('instagram', 'reels')).toBe(2200);
    expect(captionMaxFor('tiktok', 'reels')).toBe(2200);
    expect(captionMaxFor('tiktok', 'carrossel')).toBe(4000);
    expect(captionMaxFor('tiktok', 'stories')).toBeNull();
    expect(captionMaxFor('geral', 'feed')).toBeNull();
    expect(PLATFORM_DEFS.tiktok.titleMax).toBe(90);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/platformRegistry.test.ts`
Expected: FAIL. The failure reads `Failed to resolve import "@mesaas/platforms"`.

- [ ] **Step 3: Create the registry**

`supabase/functions/_shared/platform-registry.ts`:

```ts
// Registro de plataformas: fonte única para CRM, Hub e edge functions.
// Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
//
// ZERO imports e nenhum global de Deno/DOM: este arquivo é lido pelo deno check
// e pelos tsc do CRM e do Hub (alias @mesaas/platforms). Estilo deno fmt.
//
// Os valores de ContentFormat são os de workflow_posts.tipo e NÃO mudam aqui;
// só os rótulos são neutros. Plataforma nova = entrada em PLATFORM_IDS +
// PLATFORM_DEFS + CHECK das colunas plataformas/post_targets.platform.

export const CONTENT_FORMATS = ["feed", "carrossel", "reels", "stories"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  feed: "Imagem",
  carrossel: "Carrossel",
  reels: "Vídeo vertical",
  stories: "Stories",
};

export const PLATFORM_IDS = ["instagram", "tiktok", "geral"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface NativeFormatDef {
  /** Rótulo do formato nativo na plataforma ("Reels", "Vídeo TikTok"). */
  label: string;
  /** Limite de legenda em unidades UTF-16 (String.length); null = sem limite. */
  captionMax: number | null;
}

export interface PlatformDef {
  id: PlatformId;
  label: string;
  /** false = não publica sozinho (Geral: o conteúdo fica para download). */
  autoPublish: boolean;
  /** Flag de plano que libera a plataforma; null = sempre liberada. */
  planFeature: "feature_tiktok" | null;
  /** Limite do campo título; null = a plataforma não tem título. */
  titleMax: number | null;
  /** Formato de conteúdo → formato nativo. Formato ausente = não suportado. */
  nativeFormats: Partial<Record<ContentFormat, NativeFormatDef>>;
}

export const IG_CAPTION_MAX = 2200;

export const PLATFORM_DEFS: Record<PlatformId, PlatformDef> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    autoPublish: true,
    planFeature: null,
    titleMax: null,
    nativeFormats: {
      feed: { label: "Post", captionMax: IG_CAPTION_MAX },
      carrossel: { label: "Carrossel", captionMax: IG_CAPTION_MAX },
      reels: { label: "Reels", captionMax: IG_CAPTION_MAX },
      stories: { label: "Stories", captionMax: IG_CAPTION_MAX },
    },
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    autoPublish: true,
    planFeature: "feature_tiktok",
    titleMax: 90,
    // Espelha tiktok-publish-utils.ts: reels → vídeo; feed/carrossel → foto; sem stories.
    nativeFormats: {
      feed: { label: "Foto", captionMax: 4000 },
      carrossel: { label: "Carrossel de fotos", captionMax: 4000 },
      reels: { label: "Vídeo TikTok", captionMax: 2200 },
    },
  },
  geral: {
    id: "geral",
    label: "Geral",
    autoPublish: false,
    planFeature: null,
    titleMax: null,
    nativeFormats: {
      feed: { label: "Imagem", captionMax: null },
      carrossel: { label: "Carrossel", captionMax: null },
      reels: { label: "Vídeo vertical", captionMax: null },
      stories: { label: "Stories", captionMax: null },
    },
  },
};

/** Plataformas anunciadas na UI como "em breve" (não selecionáveis). */
export const COMING_SOON_PLATFORMS: readonly { id: string; label: string }[] = [
  { id: "youtube", label: "YouTube" },
];

export function supportsFormat(platform: PlatformId, tipo: ContentFormat): boolean {
  return PLATFORM_DEFS[platform].nativeFormats[tipo] !== undefined;
}

export function captionMaxFor(platform: PlatformId, tipo: ContentFormat): number | null {
  return PLATFORM_DEFS[platform].nativeFormats[tipo]?.captionMax ?? null;
}
```

- [ ] **Step 4: Wire the alias**

In each Vite/Vitest alias block, add one line next to `@mesaas/text-diff`:

- `apps/crm/vite.config.ts` and `apps/hub/vite.config.ts`:

```ts
        '@mesaas/platforms': path.resolve(__dirname, '../../supabase/functions/_shared/platform-registry.ts'),
```

- `vitest.config.ts`:

```ts
      '@mesaas/platforms': path.resolve(__dirname, 'supabase/functions/_shared/platform-registry.ts'),
```

In `apps/crm/tsconfig.json` and `apps/hub/tsconfig.json`, add one line after the `@mesaas/text-diff` entry in `paths`:

```json
      "@mesaas/platforms": ["../../supabase/functions/_shared/platform-registry.ts"]
```

The admin app does not import the registry, so its tsconfig is left alone.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/platformRegistry.test.ts`
Expected: PASS (7 tests).

Run: `deno check --node-modules-dir=auto supabase/functions/_shared/platform-registry.ts`
Expected: no output, exit 0.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/platform-registry.ts apps/crm/vite.config.ts apps/hub/vite.config.ts vitest.config.ts apps/crm/tsconfig.json apps/hub/tsconfig.json apps/crm/src/lib/__tests__/platformRegistry.test.ts
git commit -m "feat(platforms): registro compartilhado de plataformas e formatos (@mesaas/platforms)"
```

---

### Task 2: CRM reads formats and limits from the registry

**Files:**
- Modify:
  - `apps/crm/src/pages/entregas/postLabels.ts:4-24` (`TIPO_LABELS`, `TIPO_ORDER`)
  - `apps/crm/src/store/posts.ts:60` (`tipo` type)
  - `apps/crm/src/store/mensagens.ts:100`
  - `apps/crm/src/services/dataImport.ts:55`
  - `apps/crm/src/pages/importar/buildCommitRows.ts:41`
  - `apps/crm/src/pages/entregas/components/NewAvulsoDialog.tsx:47`
  - `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:377`
  - `apps/crm/src/pages/entregas/components/useCaptionDraft.ts:12`
  - `apps/crm/src/pages/entregas/components/PostEditor.tsx:525`
- Test: `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts`, plus every test that asserts on the old label text (list in Step 5)

**Interfaces:**
- Consumes: `CONTENT_FORMATS`, `ContentFormat`, `CONTENT_FORMAT_LABELS`, `IG_CAPTION_MAX` from Task 1.
- Produces: `TIPO_LABELS` (same export name, now neutral labels) and `TIPO_ORDER === CONTENT_FORMATS`. The keys of `TIPO_COLORS` are unchanged.

- [ ] **Step 1: Update the label test first**

In `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts`, add inside `describe('tipo palette', …)`:

```ts
  it('labels tipos neutrally, from the platform registry', () => {
    expect(TIPO_LABELS).toEqual({
      feed: 'Imagem',
      carrossel: 'Carrossel',
      reels: 'Vídeo vertical',
      stories: 'Stories',
    });
  });
```

Then run `npx vitest run apps/crm/src/pages/entregas/__tests__/postLabels.test.ts`.
Expected: FAIL. The new test shows `feed: 'Feed'` where `'Imagem'` was expected.

- [ ] **Step 2: Point `postLabels.ts` at the registry**

Replace `TIPO_LABELS` and `TIPO_ORDER` in `apps/crm/src/pages/entregas/postLabels.ts`:

```ts
import { CONTENT_FORMATS, CONTENT_FORMAT_LABELS } from '@mesaas/platforms';

/** Rótulos neutros de formato (registro de plataformas). O valor gravado continua sendo o tipo. */
export const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = CONTENT_FORMAT_LABELS;
```

```ts
/** Fixed render order for tipo dots/swatches, so a day looks identical across refetches. */
export const TIPO_ORDER = CONTENT_FORMATS satisfies readonly WorkflowPost['tipo'][];
```

Put the import next to the existing imports at the top of the file. Leave `TIPO_COLORS` unchanged.

- [ ] **Step 3: Replace the duplicated tipo literals with the registry type**

In each file below, add `import type { ContentFormat } from '@mesaas/platforms';` (or `import { CONTENT_FORMATS } …` where a value is needed) and make the change shown:

- `apps/crm/src/store/posts.ts:60`: `tipo: ContentFormat;`
- `apps/crm/src/store/mensagens.ts:100`: `tipo: ContentFormat;`
- `apps/crm/src/services/dataImport.ts:55`: `tipo: ContentFormat;`
- `apps/crm/src/pages/importar/buildCommitRows.ts:41`: `type PostTipo = ContentFormat;`
- `apps/crm/src/pages/entregas/components/NewAvulsoDialog.tsx:47`: `tipo: z.enum(CONTENT_FORMATS),`
- `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:377`:
  - `{(['feed', 'reels', 'stories', 'carrossel'] as const).map((t) => (` becomes `{TIPO_ORDER.map((t) => (`.
  - Add `TIPO_ORDER` to the existing `../postLabels` import.
  - The option order becomes Imagem, Carrossel, Vídeo vertical, Stories, matching every other tipo list.
- `apps/crm/src/pages/entregas/components/useCaptionDraft.ts:12`: `export const MAX_CAPTION_CHARS = IG_CAPTION_MAX;` (import `IG_CAPTION_MAX`).
- `apps/crm/src/pages/entregas/components/PostEditor.tsx:525`: replace the literal `2200` with `{MAX_CAPTION_CHARS}`, imported from `./useCaptionDraft`.

Leave `ExpressPostPage.tsx` alone: its `MAX_CAPTION` and `detectPostType` are Instagram-only by design.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run the suite and update label assertions**

Run: `npm run test -- --reporter=dot`.

These tests hard-code the old labels:
- `components/ui/__tests__/date-time-picker.test.tsx`
- `pages/mensagens/components/__tests__/ConversationThread.test.tsx`
- `pages/dashboard/__tests__/todayAgenda.test.ts`
- `pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx`
- `pages/entregas/components/__tests__/WorkflowDrawer.test.tsx`
- `pages/entregas/views/__tests__/PostsListView.test.tsx`
- `pages/entregas/__tests__/semProcesso.test.ts`
- `pages/entregas/views/__tests__/MinhaFilaView.test.tsx`
- `__tests__/store.ideias.test.ts`

In each failure, change the expected **tipo label** text only:
- `'Feed'` → `'Imagem'`
- `'Reels'` → `'Vídeo vertical'`
- `'Carrossel'` and `'Stories'` stay as they are.

Do **not** touch assertions about Instagram-specific copy such as "Legenda do Instagram" or "Publicar no Instagram". Also leave any assertion whose `'Reels'` comes from Post Express or analytics. Re-run until green.

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/crm/src
git commit -m "refactor(crm): formatos e limite de legenda vêm do registro; rótulos neutros"
```

---

### Task 3: Hub reads format labels from the registry

**Files:**
- Modify:
  - `apps/hub/src/types.ts:64`
  - `apps/hub/src/lib/postView.ts:63-68,88-95`
  - `apps/hub/src/components/PostCalendar.tsx:34-39`
  - `packages/i18n/locales/pt/hubPostCard.json:2-7`
  - `packages/i18n/locales/en/hubPostCard.json:2-7`
  - `packages/i18n/locales/pt/hubHome.json:48-53`
  - `packages/i18n/locales/en/hubHome.json:48-53`
- Test: `apps/hub/src/lib/__tests__/postView.test.ts` (create it if it does not exist; otherwise add to it)

**Interfaces:**
- Consumes: `ContentFormat`, `CONTENT_FORMAT_LABELS` from Task 1.
- Produces: `TIPO_LABELS` (Hub, same export name) = `CONTENT_FORMAT_LABELS`, and `getTipoLabel(t, tipo)`, whose pt fallback strings now come from the registry.

- [ ] **Step 1: Write the failing test**

Check whether `apps/hub/src/lib/__tests__/postView.test.ts` exists (`ls apps/hub/src/lib/__tests__/`). Add:

```ts
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { TIPO_LABELS, getTipoLabel } from '../postView';

describe('hub tipo labels', () => {
  it('are neutral', () => {
    expect(TIPO_LABELS).toEqual({
      feed: 'Imagem',
      carrossel: 'Carrossel',
      reels: 'Vídeo vertical',
      stories: 'Stories',
    });
  });

  it('getTipoLabel falls back to the neutral pt label', () => {
    const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
    expect(getTipoLabel(t, 'reels')).toBe('Vídeo vertical');
    expect(getTipoLabel(t, 'feed')).toBe('Imagem');
  });
});
```

Run: `npx vitest run apps/hub/src/lib/__tests__/postView.test.ts`
Expected: FAIL (`'Feed'` where `'Imagem'` was expected).

- [ ] **Step 2: Implement**

`apps/hub/src/types.ts:64`: `tipo: ContentFormat;` (add `import type { ContentFormat } from '@mesaas/platforms';`).

`apps/hub/src/lib/postView.ts`: import `CONTENT_FORMAT_LABELS` and use it for both exports:

```ts
export const TIPO_LABELS: Record<HubPost['tipo'], string> = CONTENT_FORMAT_LABELS;
```

```ts
export function getTipoLabel(t: TFunction, tipo: string): string {
  const labels: Record<string, string> = {
    feed: t('hubPostCard:tipo.feed', CONTENT_FORMAT_LABELS.feed),
    reels: t('hubPostCard:tipo.reels', CONTENT_FORMAT_LABELS.reels),
    stories: t('hubPostCard:tipo.stories', CONTENT_FORMAT_LABELS.stories),
    carrossel: t('hubPostCard:tipo.carrossel', CONTENT_FORMAT_LABELS.carrossel),
  };
  return labels[tipo] ?? tipo;
}
```

`apps/hub/src/components/PostCalendar.tsx`: delete the local `TIPO_LABEL_PT` map. At line 73, use `CONTENT_FORMAT_LABELS[tipo as ContentFormat] ?? tipo` as the fallback.

Locales. Change only the `tipo` / `calendar.tipoLabel` blocks named in **Files**, and leave `topPosts.tipoLabel` alone:
- pt `hubPostCard.json`: `"feed": "Imagem"`, `"reels": "Vídeo vertical"`.
- pt `hubHome.json` → `calendar.tipoLabel`: the same two changes.
- en `hubPostCard.json`: `"feed": "Image"`, `"reels": "Vertical video"`.
- en `hubHome.json` → `calendar.tipoLabel`: the same two changes.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run apps/hub` and `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS and exit 0. If a Hub test asserts the old `'Feed'`/`'Reels'` tipo label (for example `pages/__tests__/mensagensPage.test.tsx`), update it with the same mapping as Task 2 Step 5.

- [ ] **Step 4: Commit**

```bash
git add -A apps/hub packages/i18n
git commit -m "refactor(hub): rótulos neutros de formato a partir do registro"
```

---

### Task 4: Edge functions use the registry (no behaviour change)

**Files:**
- Modify:
  - `supabase/functions/mcp/tools.ts:88,189,191,205,207`
  - `supabase/functions/data-import/types.ts:40`
- Test: existing `supabase/functions/__tests__/mcp*` suites

**Interfaces:**
- Consumes: `CONTENT_FORMATS`, `ContentFormat`, `IG_CAPTION_MAX` via the relative import `../_shared/platform-registry.ts`.

- [ ] **Step 1: Implement**

`supabase/functions/mcp/tools.ts`: add `import { CONTENT_FORMATS, IG_CAPTION_MAX } from "../_shared/platform-registry.ts";`, then change:

- line 88: `const FORMATO = z.enum(CONTENT_FORMATS);`
- lines 189 and 205: `tipo: FORMATO.optional(),`
- lines 191 and 207: `ig_caption: z.string().max(IG_CAPTION_MAX).optional(),`

`supabase/functions/data-import/types.ts:40`: add `import type { ContentFormat } from "../_shared/platform-registry.ts";` and set `tipo: ContentFormat;`. That file's header forbids imports from `packages/` only; `_shared` is allowed (check its lines 1-10 to confirm).

- [ ] **Step 2: Type-check and test**

Run: `npm run check:functions`
Expected: exit 0.

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/ --filter mcp`
Expected: PASS. `--filter` matches test *names*; if nothing matches, run the full `npm run test:functions`.

Then run `ls node_modules/.deno 2>/dev/null && npm ci`, and `git checkout deno.lock` if it changed.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/mcp/tools.ts supabase/functions/data-import/types.ts
git commit -m "refactor(functions): mcp e data-import leem formatos do registro"
```

---

### Task 5: Full gate + browser check + PR

- [ ] **Step 1: Run every CI gate** listed in Global Constraints. All must pass.
- [ ] **Step 2: Browser check.** Run `preview_start` with the CRM dev server (`npm run dev:env`). Open Entregas and check that:
  - a post's Tipo select lists Imagem, Carrossel, Vídeo vertical, Stories;
  - calendar legend dots and kanban badges show the new labels;
  - Post Express still says "Reels".

  Take a screenshot.
- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/platform-agnostic-config-0e0db5
gh pr create --title "feat(platforms): P0 registro de plataformas + rótulos neutros de formato" --body "$(cat <<'EOF'
Fase P0 da spec docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md.

- `supabase/functions/_shared/platform-registry.ts`: formatos, plataformas (Instagram, TikTok, Geral; YouTube em breve), limites de legenda/título, formato nativo por plataforma. Importado pelo CRM/Hub via alias `@mesaas/platforms` e pelas functions por caminho relativo.
- Rótulos de formato neutros onde o post é conteúdo (quadros, calendário, Hub): Imagem, Carrossel, Vídeo vertical, Stories. Post Express e analytics continuam falando Instagram.
- Sem mudança de banco nem de comportamento. Deploy de functions opcional (mcp/data-import só trocaram literais pelo registro).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Codex reviews every PR on its own. Verify its findings before acting on them.
