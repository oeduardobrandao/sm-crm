# Hub "Em produção" + aba "Texto do post" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posts the client has already seen stay visible, read-only, in the Hub while the agency works on them ("Em produção"). Every media post also gets a "Texto do post" tab showing its full text.

**Architecture:** `hub-posts` derives a presentational `em_producao` reason per post from `post_status_events`, reading the latest transition out of a client-visible status. It uses a pure helper. The Hub treats `em_producao` like the existing presentational `publicando` state: `postView.ts` helpers decide visibility, label and colour. The dialog renders a notice and a read-only footer, and adds a third tab. No migration, no CRM change, and no DB status change.

**Tech Stack:** Deno edge function (Supabase), React 19 + Vitest + Testing Library (Hub), i18next JSON locales.

Spec: `docs/superpowers/specs/2026-09-24-hub-em-producao-design.md`. The mockup lives next to it, in `assets/2026-09-24-hub-em-producao-preview.html`.

## Global Constraints

- No em-dashes in user-facing copy. Use a period or a colon.
- Every new user-facing string goes in both `packages/i18n/locales/pt/*.json` and `packages/i18n/locales/en/*.json`, and every `t()` call carries the pt default.
- `em_producao` on `HubPost` is **optional**. Missing or `null` means "not in production".
- Reasons, exactly: `'proxima_aprovacao' | 'correcao' | 'ajuste'`.
- Internal statuses: `rascunho`, `revisao_interna`, `aprovado_interno`. Client-visible statuses: `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`.
- Colour `#8b5cf6`. Label "Em produção" / "In production".
- Server rule: never return raw error details to the client. Log with a `[hub-posts]` prefix.
- Hub styling: `hub-*` classes are hand-written CSS, so Tailwind variants on them do nothing.
- Before pushing, run all of these:
  - `npm run lint`
  - `npm run format:check`
  - the four `tsc` commands (crm, hub, admin, `tsconfig.scripts.json`)
  - `npm run test`
  - `npm run check:functions`
  - `npm run test:functions`
- After any `deno test` run, check `git status` for a dirtied `deno.lock` or `node_modules/.deno`, and revert or run `npm ci` as needed.

---

### Task 1: Pure helper `computeEmProducaoByPost` (server)

**Files:**
- Create: `supabase/functions/hub-posts/em-producao.ts`
- Test: `supabase/functions/__tests__/hub-posts-em-producao_test.ts`

**Interfaces:**
- Produces:
  - `export type EmProducaoReason = "proxima_aprovacao" | "correcao" | "ajuste";`
  - `export const INTERNAL_STATUSES: ReadonlySet<string>`
  - `export interface StatusEventRow { id: number; post_id: number; from_status: string | null; to_status: string; created_at: string }`
  - `export function computeEmProducaoByPost(rows: StatusEventRow[]): Map<number, EmProducaoReason>`: only posts with at least one `to_status = 'enviado_cliente'` row get an entry. The caller guarantees the post is *currently* internal.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/__tests__/hub-posts-em-producao_test.ts
import { assertEquals } from "./assert.ts";
import { computeEmProducaoByPost, type StatusEventRow } from "../hub-posts/em-producao.ts";

let seq = 0;
function ev(post_id: number, from_status: string | null, to_status: string, minute: number): StatusEventRow {
  seq += 1;
  return {
    id: seq,
    post_id,
    from_status,
    to_status,
    created_at: `2026-09-20T10:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

Deno.test("em_producao: re-arm (aprovado_cliente -> rascunho) is proxima_aprovacao", () => {
  const out = computeEmProducaoByPost([
    ev(1, "aprovado_interno", "enviado_cliente", 1),
    ev(1, "enviado_cliente", "aprovado_cliente", 2),
    ev(1, "aprovado_cliente", "rascunho", 3),
  ]);
  assertEquals(out.get(1), "proxima_aprovacao");
});

Deno.test("em_producao: correction rework (correcao_cliente -> revisao_interna) is correcao", () => {
  const out = computeEmProducaoByPost([
    ev(2, "aprovado_interno", "enviado_cliente", 1),
    ev(2, "enviado_cliente", "correcao_cliente", 2),
    ev(2, "correcao_cliente", "revisao_interna", 3),
  ]);
  assertEquals(out.get(2), "correcao");
});

Deno.test("em_producao: approval invalidation (aprovado_cliente -> revisao_interna) is ajuste", () => {
  const out = computeEmProducaoByPost([
    ev(3, "aprovado_interno", "enviado_cliente", 1),
    ev(3, "enviado_cliente", "aprovado_cliente", 2),
    ev(3, "aprovado_cliente", "revisao_interna", 3),
  ]);
  assertEquals(out.get(3), "ajuste");
});

Deno.test("em_producao: a draft never sent to the client has no entry", () => {
  const out = computeEmProducaoByPost([
    ev(4, "rascunho", "revisao_interna", 1),
    ev(4, "revisao_interna", "aprovado_interno", 2),
  ]);
  assertEquals(out.has(4), false);
});

Deno.test("em_producao: the latest exit wins, whatever the input order", () => {
  const rows = [
    ev(5, "aprovado_interno", "enviado_cliente", 1),
    ev(5, "enviado_cliente", "correcao_cliente", 2),
    ev(5, "correcao_cliente", "revisao_interna", 3),
    ev(5, "aprovado_interno", "enviado_cliente", 4),
    ev(5, "enviado_cliente", "aprovado_cliente", 5),
    ev(5, "aprovado_cliente", "rascunho", 6),
  ];
  assertEquals(computeEmProducaoByPost([...rows].reverse()).get(5), "proxima_aprovacao");
});

Deno.test("em_producao: sent but no exit row recorded falls back to ajuste", () => {
  const out = computeEmProducaoByPost([ev(6, "aprovado_interno", "enviado_cliente", 1)]);
  assertEquals(out.get(6), "ajuste");
});

Deno.test("em_producao: internal -> internal moves after the exit do not change the reason", () => {
  const out = computeEmProducaoByPost([
    ev(7, "aprovado_interno", "enviado_cliente", 1),
    ev(7, "enviado_cliente", "aprovado_cliente", 2),
    ev(7, "aprovado_cliente", "rascunho", 3),
    ev(7, "rascunho", "revisao_interna", 4),
  ]);
  assertEquals(out.get(7), "proxima_aprovacao");
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-posts-em-producao_test.ts`
Expected: FAIL, module `../hub-posts/em-producao.ts` not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/hub-posts/em-producao.ts
// "Em produção" (Hub presentational state, never stored): a post the client
// has already seen (some enviado_cliente event) that is back in an internal
// status. The reason is the latest transition OUT of a client-visible status.
// Spec: docs/superpowers/specs/2026-09-24-hub-em-producao-design.md

export type EmProducaoReason = "proxima_aprovacao" | "correcao" | "ajuste";

export const INTERNAL_STATUSES: ReadonlySet<string> = new Set([
  "rascunho",
  "revisao_interna",
  "aprovado_interno",
]);

// Mirrors apps/hub/src/lib/postView.ts VISIBLE_STATUSES.
const CLIENT_VISIBLE_STATUSES: ReadonlySet<string> = new Set([
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "agendado",
  "postado",
  "falha_publicacao",
]);

export interface StatusEventRow {
  id: number;
  post_id: number;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

function reasonOf(exit: StatusEventRow | null): EmProducaoReason {
  if (!exit) return "ajuste";
  if (exit.from_status === "aprovado_cliente" && exit.to_status === "rascunho") {
    return "proxima_aprovacao";
  }
  if (exit.from_status === "correcao_cliente") return "correcao";
  return "ajuste";
}

export function computeEmProducaoByPost(rows: StatusEventRow[]): Map<number, EmProducaoReason> {
  const byPost = new Map<number, StatusEventRow[]>();
  for (const row of rows) {
    const list = byPost.get(row.post_id);
    if (list) list.push(row);
    else byPost.set(row.post_id, [row]);
  }

  const out = new Map<number, EmProducaoReason>();
  for (const [postId, list] of byPost) {
    if (!list.some((r) => r.to_status === "enviado_cliente")) continue;
    const ordered = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    );
    let exit: StatusEventRow | null = null;
    for (const r of ordered) {
      if (
        r.from_status !== null &&
        CLIENT_VISIBLE_STATUSES.has(r.from_status) &&
        INTERNAL_STATUSES.has(r.to_status)
      ) {
        exit = r;
      }
    }
    out.set(postId, reasonOf(exit));
  }
  return out;
}
```

- [ ] **Step 4: Run the test and check it passes**

Run the same command as Step 2. Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/em-producao.ts supabase/functions/__tests__/hub-posts-em-producao_test.ts
git commit -m "feat(hub-posts): helper que deriva o motivo de 'Em produção' dos eventos de status"
```

---

### Task 2: `hub-posts` returns `em_producao`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`. Add the import at the top; add the lookup right after `const postIds = flatPosts.map(...)` (~line 136); add the field in the `postsWithResolvedContent` return object (~line 318).
- Test: `supabase/functions/__tests__/hub-functions_test.ts` (add tests after the existing `hub-posts` GET tests, ~line 420)

**Interfaces:**
- Consumes: `computeEmProducaoByPost`, `INTERNAL_STATUSES`, `EmProducaoReason`, `StatusEventRow` from Task 1.
- Produces: each element of the response's `posts[]` carries `em_producao: "proxima_aprovacao" | "correcao" | "ajuste" | null`.

- [ ] **Step 1: Write the failing tests** (append to `hub-functions_test.ts`)

```ts
function queueHubPostsBase(
  db: ReturnType<typeof createSupabaseQueryMock>,
  posts: Record<string, unknown>[],
) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflow_posts", "select", { data: posts, error: null });
}

function hubPostsHandlerFor(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
    rateLimit: async () => true,
  });
}

const basePost = {
  titulo: "P", tipo: "feed", ordem: 0, conteudo_plain: "x",
  scheduled_at: "2026-09-30T10:00:00.000Z", platform: "instagram",
  workflow_id: 7, workflows: { titulo: "Setembro" },
};

Deno.test("hub-posts flags a re-armed rascunho post as em_producao and leaves the others null", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [
    { ...basePost, id: 1, status: "rascunho" },
    { ...basePost, id: 2, status: "rascunho" },
    { ...basePost, id: 3, status: "enviado_cliente" },
  ]);
  db.queue("post_status_events", "select", {
    data: [
      { id: 1, post_id: 1, from_status: "aprovado_interno", to_status: "enviado_cliente", created_at: "2026-09-20T10:00:00.000Z" },
      { id: 2, post_id: 1, from_status: "aprovado_cliente", to_status: "rascunho", created_at: "2026-09-21T10:00:00.000Z" },
    ],
    error: null,
  });

  const response = await hubPostsHandlerFor(db)(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  const byId = Object.fromEntries(body.posts.map((p: { id: number; em_producao: unknown }) => [p.id, p.em_producao]));
  assertEquals(byId, { 1: "proxima_aprovacao", 2: null, 3: null });

  const call = db.calls.find((c) => c.table === "post_status_events");
  assert(call, "status events must be queried");
  const inPostIds = call!.modifiers.find((m) => m.method === "in" && m.args[0] === "post_id");
  assertEquals(inPostIds?.args[1], [1, 2], "only posts currently in an internal status are looked up");
  assert(
    call!.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"),
    "events are scoped to the token's workspace",
  );
});

Deno.test("hub-posts skips the status-events query when no post is internal", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [{ ...basePost, id: 3, status: "enviado_cliente" }]);

  const response = await hubPostsHandlerFor(db)(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(body.posts[0].em_producao, null);
  assertEquals(db.calls.some((c) => c.table === "post_status_events"), false);
});

Deno.test("hub-posts falls back to em_producao null when the status-events query fails", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [{ ...basePost, id: 1, status: "rascunho" }]);
  db.queue("post_status_events", "select", { data: null, error: { message: "boom" } });

  const response = await hubPostsHandlerFor(db)(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].em_producao, null);
});
```

`db.calls` is the mock's recorded `QueryCall[]` getter (`test/shared/supabaseMock.ts:299`); each call has `.modifiers: { method, args }[]`.

- [ ] **Step 2: Run the tests and check they fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts --filter "em_producao|status-events"`
Expected: FAIL (`em_producao` undefined, and no `post_status_events` call).

- [ ] **Step 3: Implement**

Add the import at the top of `handler.ts`:

```ts
import {
  computeEmProducaoByPost,
  INTERNAL_STATUSES,
  type EmProducaoReason,
  type StatusEventRow,
} from "./em-producao.ts";
```

Right after `const postIds = flatPosts.map((post: { id: number }) => post.id);`:

```ts
    // "Em produção": posts the client already saw that are back with the
    // agency. Only internal-status posts are looked up; on error every post
    // falls back to null (today's behaviour: hidden in the Hub).
    const internalPostIds = flatPosts
      .filter((post: { status: string }) => INTERNAL_STATUSES.has(post.status))
      .map((post: { id: number }) => post.id);
    let emProducaoByPost = new Map<number, EmProducaoReason>();
    if (internalPostIds.length > 0) {
      const { data: statusEvents, error: statusEventsError } = await db
        .from("post_status_events")
        .select("id, post_id, from_status, to_status, created_at")
        .eq("conta_id", hubToken.conta_id)
        .in("post_id", internalPostIds)
        .in("to_status", ["enviado_cliente", ...INTERNAL_STATUSES])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (statusEventsError) {
        console.error("[hub-posts] status events lookup failed:", statusEventsError);
      } else {
        emProducaoByPost = computeEmProducaoByPost((statusEvents ?? []) as StatusEventRow[]);
      }
    }
```

In the `postsWithResolvedContent` return object, add the field:

```ts
      return {
        ...resolvedPost,
        pending_suggestion: resolvedSuggestion,
        suggestion_rejected_at: !resolvedSuggestion ? (rejectedAtByPost[post.id] ?? null) : null,
        em_producao: emProducaoByPost.get(post.id) ?? null,
      };
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts`
Expected: every test passes, including the older hub-posts ones. Then run `npm run check:functions` and expect it to exit 0. Finally run `git status` and revert any `deno.lock` noise.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-posts): devolve em_producao por post"
```

---

### Task 3: Hub contract + `postView` helpers + labels

**Files:**
- Modify: `apps/hub/src/types.ts` (`HubPost`, after `suggestion_rejected_at`)
- Modify: `apps/hub/src/lib/postView.ts`
- Modify: `packages/i18n/locales/pt/hubPostCard.json`, `packages/i18n/locales/en/hubPostCard.json` (`status`)
- Test: `apps/hub/src/lib/__tests__/postView.test.ts`, `apps/hub/src/components/posts/__tests__/StatusTag.test.tsx`

**Interfaces:**
- Produces, in `apps/hub/src/lib/postView.ts`:
  - `export type EmProducaoReason = 'proxima_aprovacao' | 'correcao' | 'ajuste';` (re-exported from `types.ts`)
  - `export const INTERNAL_STATUSES: Set<HubPost['status']>`
  - `export function isInProduction(p: { status: HubPost['status']; em_producao?: EmProducaoReason | null }): boolean`
  - `export function isPostClientVisible(p: { status: HubPost['status']; em_producao?: EmProducaoReason | null }): boolean`
  - `export function clientStatusOf(p: { status: HubPost['status']; em_producao?: EmProducaoReason | null }): string`, which returns `'em_producao'` or `p.status`
  - `getPostPublishState` now also accepts optional `em_producao` and returns `'em_producao'` first
  - `export function hasDistinctPostText(post: HubPost): boolean`
  - `STATUS_COLORS.em_producao = '#8b5cf6'`
  - `CLIENT_STATUS_LABELS.em_producao = 'Em produção'`
  - `getClientStatusLabel(t, 'em_producao')` returns "Em produção"

- [ ] **Step 1: Write the failing tests**

Add `hasDistinctPostText`, `isInProduction`, `isPostClientVisible`, `clientStatusOf` and `STATUS_COLORS` to the existing import list in `postView.test.ts`, then append:

```ts
describe('em produção', () => {
  it('isInProduction needs both an internal status and a reason', () => {
    expect(isInProduction(post({ status: 'rascunho', em_producao: 'proxima_aprovacao' }))).toBe(true);
    expect(isInProduction(post({ status: 'revisao_interna', em_producao: 'correcao' }))).toBe(true);
    expect(isInProduction(post({ status: 'rascunho' }))).toBe(false);
    expect(isInProduction(post({ status: 'rascunho', em_producao: null }))).toBe(false);
    // A stale flag on a client-visible status never wins.
    expect(isInProduction(post({ status: 'enviado_cliente', em_producao: 'ajuste' }))).toBe(false);
  });

  it('isPostClientVisible adds in-production posts to the visible set', () => {
    expect(isPostClientVisible(post({ status: 'rascunho', em_producao: 'ajuste' }))).toBe(true);
    expect(isPostClientVisible(post({ status: 'rascunho' }))).toBe(false);
    expect(isPostClientVisible(post({ status: 'postado' }))).toBe(true);
  });

  it('getPostPublishState and clientStatusOf report em_producao', () => {
    const p = post({ status: 'aprovado_interno', em_producao: 'proxima_aprovacao' });
    expect(getPostPublishState(p)).toBe('em_producao');
    expect(clientStatusOf(p)).toBe('em_producao');
    expect(clientStatusOf(post({ status: 'agendado' }))).toBe('agendado');
    expect(STATUS_COLORS.em_producao).toBe('#8b5cf6');
  });
});

describe('hasDistinctPostText', () => {
  it('is true when the body has more than the caption', () => {
    expect(
      hasDistinctPostText(post({ conteudo_plain: 'Slide 1\nSlide 2', ig_caption: 'Legenda' })),
    ).toBe(true);
  });
  it('is false for an empty body', () => {
    expect(hasDistinctPostText(post({ conteudo_plain: '   ', ig_caption: 'Legenda' }))).toBe(false);
  });
  it('is false when the body is exactly what the Legenda tab already shows', () => {
    expect(hasDistinctPostText(post({ conteudo_plain: 'Só legenda', ig_caption: null }))).toBe(false);
    expect(hasDistinctPostText(post({ conteudo_plain: ' Igual ', ig_caption: 'Igual' }))).toBe(false);
  });
});
```

Append to `StatusTag.test.tsx`, reusing that file's existing render pattern and imports:

```tsx
it('renders the em_producao label in purple', () => {
  render(<StatusTag status="em_producao" />);
  const tag = screen.getByText('Em produção');
  expect(tag).toHaveStyle({ color: '#8b5cf6' });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run apps/hub/src/lib/__tests__/postView.test.ts apps/hub/src/components/posts/__tests__/StatusTag.test.tsx`
Expected: FAIL (the exports are missing and the label is missing).

- [ ] **Step 3: Implement**

`apps/hub/src/types.ts`: above `export interface HubPost`, add:

```ts
/** Why a post the client already saw is back with the agency (Hub-only, never stored). */
export type EmProducaoReason = 'proxima_aprovacao' | 'correcao' | 'ajuste';
```

and inside `HubPost`, after `suggestion_rejected_at`, add:

```ts
  /** Set by hub-posts when the post is back in an internal status after the client
   * saw it. Absent on stale cached payloads and before the function deploy: treat
   * as null (not in production). */
  em_producao?: EmProducaoReason | null;
```

`apps/hub/src/lib/postView.ts`:
- change the import to `import type { EmProducaoReason, HubPost, HubPostMedia } from '../types';`
- add `export type { EmProducaoReason };`
- add after `isClientVisible`:

```ts
/** Statuses the agency works in; hidden from the client unless the post is em produção. */
export const INTERNAL_STATUSES = new Set<HubPost['status']>([
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
]);

type ProductionFields = { status: HubPost['status']; em_producao?: EmProducaoReason | null };

/** The client already saw this post and the agency is working on it again. */
export function isInProduction(p: ProductionFields): boolean {
  return !!p.em_producao && INTERNAL_STATUSES.has(p.status);
}

/** Post-level visibility: the status set plus in-production posts (read-only). */
export function isPostClientVisible(p: ProductionFields): boolean {
  return VISIBLE_STATUSES.has(p.status) || isInProduction(p);
}

/** Status key for labels: 'em_producao' for in-production posts, the DB status otherwise. */
export function clientStatusOf(p: ProductionFields): string {
  return isInProduction(p) ? 'em_producao' : p.status;
}
```

- add `em_producao: 'Em produção',` to `CLIENT_STATUS_LABELS`
- in `getClientStatusLabel`, add `em_producao: t('hubPostCard:status.em_producao', 'Em produção'),`
- add `em_producao: '#8b5cf6',` to `STATUS_COLORS`
- replace `getPostPublishState` with:

```ts
export function getPostPublishState(p: {
  status: HubPost['status'];
  scheduled_at: string | null;
  em_producao?: EmProducaoReason | null;
}): string {
  if (isInProduction(p)) return 'em_producao';
  return p.status === 'agendado' && !!p.scheduled_at && new Date(p.scheduled_at) <= new Date()
    ? 'publicando'
    : p.status;
}
```

- add after `deriveCaption`:

```ts
/**
 * A media post's full text is worth its own tab only when it says more than the caption
 * the Legenda tab already shows.
 */
export function hasDistinctPostText(post: HubPost): boolean {
  const body = (post.conteudo_plain ?? '').trim();
  if (!body) return false;
  return body !== deriveCaption(post, post.ig_caption).trim();
}
```

Locales: add `"em_producao": "Em produção"` to the `status` object in `packages/i18n/locales/pt/hubPostCard.json`, and `"em_producao": "In production"` in the `en` one.

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run apps/hub/src/lib/__tests__/postView.test.ts apps/hub/src/components/posts/__tests__/StatusTag.test.tsx`
Expected: PASS. Then run `npx tsc -p apps/hub/tsconfig.json --noEmit` and expect it to exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/lib/postView.ts apps/hub/src/lib/__tests__/postView.test.ts apps/hub/src/components/posts/__tests__/StatusTag.test.tsx packages/i18n/locales/pt/hubPostCard.json packages/i18n/locales/en/hubPostCard.json
git commit -m "feat(hub): estado 'Em produção' no contrato e nos helpers de postView"
```

---

### Task 4: Visibility sites (Postagens, Home calendar, Mensagens chip, history panel)

**Files:**
- Modify: `apps/hub/src/pages/PostagensPage.tsx:63` and `:130`
- Modify: `apps/hub/src/pages/HomePage.tsx:55`
- Modify: `apps/hub/src/components/PostCalendar.tsx:371`
- Modify: `apps/hub/src/components/HubPostChip.tsx:114`
- Modify: `apps/hub/src/components/PostHistoryPanel.tsx:87` and the composer block (~line 363)
- Modify: `packages/i18n/locales/{pt,en}/hubHome.json` (`calendar.statusLabel.em_producao`)
- Test: `apps/hub/src/pages/__tests__/postagensPage.test.tsx`, `apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx`, `apps/hub/src/components/__tests__/PostCalendar.test.tsx`, `apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `isPostClientVisible`, `isInProduction`, `clientStatusOf` from Task 3.

- [ ] **Step 1: Write the failing tests**

`postagensPage.test.tsx`, inside `describe('PostagensPage')`:

```tsx
  it('shows an em-produção post read-only with the purple tag, and still hides plain drafts', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'Na arte', status: 'rascunho', em_producao: 'proxima_aprovacao' }),
          post({ id: 2, titulo: 'Rascunho puro', status: 'rascunho' }),
        ],
      }),
    );
    expect(await screen.findByText('Na arte')).toBeInTheDocument();
    expect(screen.getByText('Em produção')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho puro')).not.toBeInTheDocument();
  });
```

`aprovacoesPage.test.tsx`, inside `describe('AprovacoesPage')` (the file already has `renderPage`, `response`, `post` and `BASE`):

```tsx
  it('never lists an em-produção post among pending approvals', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'Pendente' }),
          post({ id: 2, titulo: 'Na arte', status: 'rascunho', em_producao: 'proxima_aprovacao' }),
        ],
      }),
    );
    expect(await screen.findByText('Pendente')).toBeInTheDocument();
    expect(screen.queryByText('Na arte')).not.toBeInTheDocument();
  });
```

`PostCalendar.test.tsx`: add a case using that file's existing render and fixture pattern. Render a post `{ status: 'revisao_interna', em_producao: 'correcao' }` on the selected day, then `expect(screen.getByText('Em produção')).toBeInTheDocument()` and `expect(screen.queryByText('Revisão interna')).not.toBeInTheDocument()`.

`PostHistoryPanel.test.tsx`, next to the "renders nothing for a post in an internal status" test:

```tsx
  it('shows history for an em-produção post but no comment composer', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    render(
      <PostHistoryPanel
        post={makePost({ status: 'rascunho', em_producao: 'correcao' })}
        token="tok"
        approvals={[]}
        embedded
      />,
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByPlaceholderText('Escreva um comentário sobre este post'),
    ).not.toBeInTheDocument();
  });
```

(Import `waitFor` from `@testing-library/react` if the file doesn't already.)

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run apps/hub/src/pages/__tests__/postagensPage.test.tsx apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/components/__tests__/PostCalendar.test.tsx apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`
Expected: the new Postagens, calendar and history tests fail. The Aprovações one may already pass; that's fine, it's a regression guard.

- [ ] **Step 3: Implement**

`PostagensPage.tsx`: import `isPostClientVisible` from `../lib/postView` (drop `VISIBLE_STATUSES` from the import if it becomes unused). Then:
- line 63: `.filter((p) => VISIBLE_STATUSES.has(p.status))` becomes `.filter(isPostClientVisible)`
- line 130: `VISIBLE_STATUSES.has(p.status) && isFeedSelectable(p) && selectedIds.has(p.id)` becomes `isPostClientVisible(p) && isFeedSelectable(p) && selectedIds.has(p.id)`

`HomePage.tsx`: import `isInProduction` from `../lib/postView`. Line 55 becomes:

```ts
  const posts = allPosts.filter((p) => CALENDAR_STATUSES.has(p.status) || isInProduction(p));
```

`PostCalendar.tsx`: import `clientStatusOf` from `../lib/postView`, add `em_producao: 'Em produção',` to `STATUS_LABEL_PT`, and change line 371 to `{statusLabel(clientStatusOf(p))}`.

`hubHome.json`: add `"em_producao": "Em produção"` (pt) and `"em_producao": "In production"` (en) to `calendar.statusLabel`.

`HubPostChip.tsx`: import `clientStatusOf` and change line 114 to `{getClientStatusLabel(t, clientStatusOf(post))}`.

`PostHistoryPanel.tsx`:
- import `isInProduction, isPostClientVisible` from `../lib/postView`, and drop `VISIBLE_STATUSES` if it becomes unused
- line 87:

```ts
  const visible = isPostClientVisible(post);
  // Em produção is read-only: hub-approve rejects comments on internal statuses.
  const canComment = !isInProduction(post);
```

- wrap the composer `<div className="space-y-1.5">…</div>` (the textarea, the send error and the Enviar button) in `{canComment && ( … )}`

- [ ] **Step 4: Run the tests and check they pass**

Run the Step 2 command, then `npx vitest run apps/hub`. Expected: all PASS. Existing tests with a bare `status: 'rascunho'` stay hidden because they carry no `em_producao`.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/HomePage.tsx apps/hub/src/components/PostCalendar.tsx apps/hub/src/components/HubPostChip.tsx apps/hub/src/components/PostHistoryPanel.tsx packages/i18n/locales/pt/hubHome.json packages/i18n/locales/en/hubHome.json apps/hub/src/pages/__tests__ apps/hub/src/components/__tests__
git commit -m "feat(hub): posts em produção aparecem em Postagens, Início e histórico (só leitura)"
```

---

### Task 5: Dialog notice + read-only footer for in-production posts

**Files:**
- Create: `apps/hub/src/components/posts/InProductionNotice.tsx`
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx`:
  - imports (~lines 11-33)
  - the reading view (~line 690, just before `{readingBody}`)
  - the footer condition (line 698) and branch (~line 749)
- Modify: `packages/i18n/locales/{pt,en}/hubPosts.json` (new `production` object)
- Test: `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`

**Interfaces:**
- Consumes: `isInProduction`, `EmProducaoReason` from Task 3.
- Produces: `export function InProductionNotice({ post }: { post: HubPost }): JSX.Element | null`

Confirmed already, so don't re-guard: `useEditSuggestion` sets `isEditable = post.status === 'enviado_cliente'` (`hooks/useEditSuggestion.ts:48`), and every dialog action hangs off `isPending = post.status === 'enviado_cliente'`. So an in-production post has no approve, correct, edit or autosave path. This task only adds the notice and the footer line.

- [ ] **Step 1: Write the failing tests** (append inside `describe('PostDetailDialog')`)

```tsx
  describe('em produção (read-only)', () => {
    const prodPosts = [
      post({ id: 11, titulo: 'Feed na arte', status: 'rascunho', em_producao: 'proxima_aprovacao', tipo: 'feed' }),
      post({ id: 12, titulo: 'Reel no vídeo', status: 'rascunho', em_producao: 'proxima_aprovacao', tipo: 'reels' }),
      post({ id: 13, titulo: 'Story', status: 'rascunho', em_producao: 'proxima_aprovacao', tipo: 'stories' }),
      post({ id: 14, titulo: 'Corrigindo', status: 'revisao_interna', em_producao: 'correcao' }),
      post({ id: 15, titulo: 'Ajustando', status: 'revisao_interna', em_producao: 'ajuste' }),
    ];

    it('shows the purple tag, the arte notice and a read-only footer', () => {
      renderDialog(11, { posts: prodPosts });
      expect(screen.getByText('Em produção')).toBeInTheDocument();
      expect(screen.getByText('Você aprovou o texto.')).toBeInTheDocument();
      expect(screen.getByText(/produzindo a arte deste post/)).toBeInTheDocument();
      expect(screen.getByText('Em produção: nada para aprovar agora')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Aprovar/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument();
    });

    it('says vídeo for reels and conteúdo for stories', () => {
      renderDialog(12, { posts: prodPosts });
      expect(screen.getByText(/produzindo o vídeo deste post/)).toBeInTheDocument();
      cleanup();
      renderDialog(13, { posts: prodPosts });
      expect(screen.getByText(/produzindo o conteúdo deste post/)).toBeInTheDocument();
    });

    it('uses the correction and adjustment notices for the other reasons', () => {
      renderDialog(14, { posts: prodPosts });
      expect(screen.getByText('A equipe está fazendo as correções que você pediu.')).toBeInTheDocument();
      cleanup();
      renderDialog(15, { posts: prodPosts });
      expect(screen.getByText('A equipe está ajustando este post.')).toBeInTheDocument();
    });

    it('shows no notice on a normal pending post', () => {
      renderDialog(1);
      expect(screen.queryByText('Em produção: nada para aprovar agora')).not.toBeInTheDocument();
      expect(screen.queryByText('Você aprovou o texto.')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx -t "em produção"`
Expected: FAIL (the notice and footer text are missing).

- [ ] **Step 3: Implement**

Locales. Add a top-level `"production"` object to `packages/i18n/locales/pt/hubPosts.json`:

```json
  "production": {
    "nextApprovalTitle": "Você aprovou o texto.",
    "nextApprovalBody_arte": "A equipe está produzindo a arte deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.",
    "nextApprovalBody_video": "A equipe está produzindo o vídeo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.",
    "nextApprovalBody_conteudo": "A equipe está produzindo o conteúdo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.",
    "correcaoTitle": "A equipe está fazendo as correções que você pediu.",
    "correcaoBody": "O post volta para Aprovações quando estiver pronto.",
    "ajusteTitle": "A equipe está ajustando este post.",
    "ajusteBody": "Ele volta para Aprovações quando estiver pronto.",
    "footer": "Em produção: nada para aprovar agora"
  },
```

and to `packages/i18n/locales/en/hubPosts.json`:

```json
  "production": {
    "nextApprovalTitle": "You approved the text.",
    "nextApprovalBody_arte": "The team is producing the artwork for this post. It returns to Approvals when it's ready for the next approval.",
    "nextApprovalBody_video": "The team is producing the video for this post. It returns to Approvals when it's ready for the next approval.",
    "nextApprovalBody_conteudo": "The team is producing the content for this post. It returns to Approvals when it's ready for the next approval.",
    "correcaoTitle": "The team is making the changes you requested.",
    "correcaoBody": "The post returns to Approvals when it's ready.",
    "ajusteTitle": "The team is adjusting this post.",
    "ajusteBody": "It returns to Approvals when it's ready.",
    "footer": "In production: nothing to approve right now"
  },
```

Create `InProductionNotice.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { HubPost } from '../../types';
import { isInProduction } from '../../lib/postView';

const PURPLE = '#8b5cf6';

/**
 * Read-only explanation for a post the client already saw that is back with the agency.
 * The "próxima aprovação" wording depends on `tipo` ONLY (never on attached media):
 * arte for feed/carrossel, vídeo for reels, conteúdo for stories.
 */
export function InProductionNotice({ post }: { post: HubPost }) {
  const { t } = useTranslation('hubPosts');
  if (!isInProduction(post)) return null;

  let title: string;
  let body: string;
  if (post.em_producao === 'proxima_aprovacao') {
    title = t('production.nextApprovalTitle', 'Você aprovou o texto.');
    body =
      post.tipo === 'reels'
        ? t(
            'production.nextApprovalBody_video',
            'A equipe está produzindo o vídeo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
          )
        : post.tipo === 'stories'
          ? t(
              'production.nextApprovalBody_conteudo',
              'A equipe está produzindo o conteúdo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
            )
          : t(
              'production.nextApprovalBody_arte',
              'A equipe está produzindo a arte deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
            );
  } else if (post.em_producao === 'correcao') {
    title = t('production.correcaoTitle', 'A equipe está fazendo as correções que você pediu.');
    body = t('production.correcaoBody', 'O post volta para Aprovações quando estiver pronto.');
  } else {
    title = t('production.ajusteTitle', 'A equipe está ajustando este post.');
    body = t('production.ajusteBody', 'Ele volta para Aprovações quando estiver pronto.');
  }

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-[1.45] hub-txt"
      style={{ background: `${PURPLE}0f`, border: `1px solid ${PURPLE}30` }}
    >
      <Clock size={16} className="shrink-0 mt-px" style={{ color: PURPLE }} aria-hidden="true" />
      <p>
        <span className="font-semibold">{title}</span> {body}
      </p>
    </div>
  );
}
```

`PostDetailDialog.tsx`:
- add `isInProduction` to the `../../lib/postView` import and `Lock` to the lucide import, then `import { InProductionNotice } from './InProductionNotice';`
- next to `const isPending = ...` (line 235), add `const inProduction = isInProduction(post);`
- in the reading branch, just before `{readingBody}`, insert `<InProductionNotice post={post} />`
- footer condition (line 698):

```tsx
          {(isPending || inProduction || (post.status === 'postado' && post.instagram_permalink)) && (
```

- in the footer's final ternary, replace the trailing `) : null}` of the `postado` branch with an in-production branch:

```tsx
              ) : inProduction ? (
                <p className="flex items-center justify-center gap-1.5 text-[12.5px] hub-tx3">
                  <Lock size={14} aria-hidden="true" />
                  {t('production.footer', 'Em produção: nada para aprovar agora')}
                </p>
              ) : null}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`
Expected: all PASS (new and existing).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/posts/InProductionNotice.tsx apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json
git commit -m "feat(hub): aviso 'Em produção' e rodapé só leitura no post aberto"
```

---

### Task 6: "Texto do post" tab on media posts

**Files:**
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx`:
  - the `tab` state (line 236)
  - the tablist (~lines 628-652)
  - the tab panels (~lines 653-693)
- Modify: `packages/i18n/locales/{pt,en}/hubPosts.json` (`posts.tabPostText`)
- Test: `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`

**Interfaces:**
- Consumes: `hasDistinctPostText` from Task 3; `bodyConteudo`, `bodyPlain`, `textCaption`, `showOriginal` (already in the dialog, ~lines 270-276).

- [ ] **Step 1: Write the failing tests** (append inside `describe('PostDetailDialog')`)

The shared fixture's post 1 is a media post with `conteudo_plain: 'Corpo'` and `ig_caption: 'Legenda um'`, so it qualifies.

```tsx
  describe('Texto do post tab', () => {
    it('shows the full post text on a media post when it differs from the caption', () => {
      renderDialog(1);
      expect(screen.queryByText('Corpo')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: 'Texto do post' }));
      expect(screen.getByRole('tab', { name: 'Texto do post' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Corpo')).toBeVisible();
      expect(screen.getByText('Legenda do Instagram')).toBeInTheDocument();
    });

    it('is absent when the body equals the caption', () => {
      renderDialog(1, {
        posts: [post({ id: 1, conteudo_plain: 'Legenda um', ig_caption: 'Legenda um' })],
      });
      expect(screen.queryByRole('tab', { name: 'Texto do post' })).not.toBeInTheDocument();
    });

    it('is absent on a text post (the Texto tab already shows everything)', () => {
      renderDialog(3);
      expect(screen.queryByRole('tab', { name: 'Texto do post' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Texto' })).toBeInTheDocument();
    });

    it('Corrigir from the Texto do post tab switches back to the content tab', () => {
      renderDialog(1);
      fireEvent.click(screen.getByRole('tab', { name: 'Texto do post' }));
      fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
      expect(screen.getByRole('tab', { name: 'Legenda' })).toHaveAttribute('aria-selected', 'true');
    });
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx -t "Texto do post"`
Expected: FAIL (no such tab).

- [ ] **Step 3: Implement**

Locales: add `"tabPostText": "Texto do post"` to the `posts` object in pt `hubPosts.json` (next to `tabText`), and `"tabPostText": "Post text"` in en.

`PostDetailDialog.tsx`:
- import `hasDistinctPostText` from `../../lib/postView`
- line 236: `const [tab, setTab] = useState<'content' | 'postText' | 'history'>('content');`
- after `const kind = ...`, add:

```ts
  // Media layouts show only the caption; the full text gets its own read-only tab.
  const showPostTextTab = kind !== 'text' && hasDistinctPostText(post);
  const tabKeys = showPostTextTab
    ? (['content', 'postText', 'history'] as const)
    : (['content', 'history'] as const);
```

- tablist: change `(['content', 'history'] as const).map((key) => (` to `tabKeys.map((key) => (`. Make the row scroll rather than wrap on phones. Add `overflow-x-auto` to the tablist `div` className, and `whitespace-nowrap shrink-0` to each tab button className. Label:

```tsx
                  {key === 'history'
                    ? t('posts.tabHistory', 'Histórico e comentários')
                    : key === 'postText'
                      ? t('posts.tabPostText', 'Texto do post')
                      : kind === 'text'
                        ? t('posts.tabText', 'Texto')
                        : t('posts.tabCaption', 'Legenda')}
```

- panels: change the content wrapper `<div hidden={tab === 'history'}>` to `<div hidden={tab !== 'content'}>`, and add a sibling panel right after it:

```tsx
              {showPostTextTab && (
                <div hidden={tab !== 'postText'} className="space-y-4">
                  {bodyConteudo ? (
                    <RichTextContent
                      key={showOriginal ? 'original-posttext' : 'suggestion-posttext'}
                      content={bodyConteudo}
                      className="font-display text-[16px] leading-[1.55] hub-txt"
                      editable={false}
                      fallbackText={bodyPlain}
                    />
                  ) : (
                    <p className="font-display text-[16px] leading-[1.55] hub-txt whitespace-pre-wrap">
                      {bodyPlain}
                    </p>
                  )}
                  {textCaption && (
                    <div className="border-t hub-border pt-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3 mb-1">
                        {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
                      </p>
                      <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">
                        {textCaption}
                      </p>
                    </div>
                  )}
                </div>
              )}
```

The Corrigir button already calls `setTab('content')`, so it covers the new tab.

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`
Expected: all PASS. If an older test now fails because `'Corpo'` appears twice (for example a `getByText('Corpo')` that used to be unique), scope that assertion to the visible panel. Don't change the behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json
git commit -m "feat(hub): aba 'Texto do post' em posts com mídia"
```

---

### Task 7: Full gates + browser verification

**Files:** none new. Fix only what the gates or the browser find.

- [ ] **Step 1: Run the CI gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```

Expected: all exit 0. If `format:check` fails, run `npm run format` and commit. Afterwards, run `git status` and revert any `deno.lock` noise; if `ls node_modules/.deno` exists, run `npm ci`.

- [ ] **Step 2: Browser verification (Hub, Browser pane)**

Run the Hub with `npm run dev:hub` via `preview_start` (add a `.claude/launch.json` entry if missing). The function isn't deployed yet, so follow the "Hub repro via patched fetch" approach from memory: in the Browser pane, patch `window.fetch` so the `hub-posts` response gains posts with `status: 'rascunho'` and each `em_producao` reason. Include one media carrossel with a long `conteudo_plain`. Check:

- Postagens grid: purple "Em produção" tile, for both a text-only post and a media post.
- Opened post: the notice (arte / vídeo / conteúdo / correção / ajuste), no Aprovar/Corrigir, the footer line, Histórico with no composer.
- A media post shows three tabs, and "Texto do post" renders the full text.
- At **375px** width (`resize_window` preset mobile), the three tabs fit or scroll horizontally, and the page itself doesn't scroll sideways.
- Dark mode: the notice is readable.

Take screenshots for the PR. Reset the viewport to desktop afterwards.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A apps/hub packages/i18n supabase/functions
git commit -m "fix(hub): ajustes da verificação no navegador"
```

(Skip if nothing changed.)

---

### Task 8: Deploy + PR (needs user go-ahead before each outward action)

- [ ] **Step 1:** Rebase on fresh `origin/main` (`git fetch && git rebase origin/main`), then rerun `npm run test` and `npm run test:functions`.
- [ ] **Step 2 (ask the user first):** deploy `hub-posts` to staging and prod **before** merging, from this branch after checking `git diff origin/main -- supabase/functions/hub-posts` shows only this work:

```bash
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

- [ ] **Step 3 (ask the user first):** push the branch and open the PR, with the screenshots and a short note that no migration is involved. End the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
