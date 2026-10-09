# TikTok Audit Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mesaas TikTok composer and publish paths meet every TikTok Content Sharing Guideline, and fix the flow bugs a TikTok reviewer would hit, so the app can be submitted for TikTok's app review and Content Posting audit.

**Spec:** `docs/superpowers/specs/2026-10-08-tiktok-audit-readiness-design.md` (A0-A10, B1-B6, C1-C4). Section ids below refer to it.

**Architecture:**
- **Two independent lanes**, which run in parallel in two worktrees (see "Execution order"):
  - **Backend (Deno edge functions):** Tasks 1-7. Task 1 runs in the main worktree; Tasks 2-7 run in the backend worktree.
  - **Frontend (CRM, React):** Tasks 8-14, in the main worktree.
- **The lanes share one runtime-neutral module,** `supabase/functions/_shared/tiktok-messages.ts`, created in Task 1. The CRM imports it through the `@mesaas/tiktok-messages` alias. Both lanes start after Task 1 is committed.
- **Composer rules live in one pure, tested module,** `tiktokComposerRules.ts`. `TikTokSettingsPanel` only renders what that module decides.
- **The server pre-init check is split in two:**
  - a pure evaluator (`evaluateTikTokPrecheck`)
  - two thin fetchers: the creator_info call and the media query
- **Both init paths use the precheck:** the cron and publish-now.

**Tech stack:** React 19, TypeScript, Vitest + Testing Library, shadcn/ui (Radix), Deno edge functions, `deno test` with `test/shared/supabaseMock.ts`.

## Execution order

1. **Task 1** in the main worktree (`/Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe`, branch `feat/tiktok-audit-readiness`). Commit it.
2. **Create the backend worktree** from that commit, so the backend lane's `deno test` runs never touch the main worktree's `node_modules`:

   ```bash
   git -C /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe worktree add \
     -b feat/tiktok-audit-readiness-backend \
     /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend \
     feat/tiktok-audit-readiness
   ```

   Deno creates its own `node_modules` there (`--node-modules-dir=auto`). Never run `npm install`/`npm ci` in the backend worktree.
3. **In parallel:** Tasks 2-7 in the backend worktree (every command there is prefixed with `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend &&`), Tasks 8-14 in the main worktree. The two lanes touch disjoint files.
4. **Before Task 15**, in the main worktree:

   ```bash
   git merge --no-ff feat/tiktok-audit-readiness-backend
   git worktree remove /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend
   git branch -d feat/tiktok-audit-readiness-backend
   npm ci
   ```

5. **Task 15.**

## Global Constraints

- All user-facing copy is pt-BR, sentence case, **no em dashes** (use a period or a colon).
- Copy strings are verbatim: strings the spec writes are exactly as the spec writes them; strings this plan introduces (loading/placeholder sentences, the `both` toast, labels) are exactly as this plan writes them. Do not paraphrase either.
- **Deno test command.** Every per-file Deno run in this plan is written out in full with the same flags as `npm run test:functions` (`package.json:33`): `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <files> [--filter "<test name>"]`. Without `--allow-env` the test files' top-level `Deno.env.set` throws NotCapable; without `--node-modules-dir=auto` the `npm:` imports resolve differently. `--filter` matches TEST NAMES (substring), never file names. Runs in Tasks 2-7 are prefixed with `cd` into the backend worktree so their `node_modules` writes never land in the main worktree; Task 1's two runs are in the main worktree on purpose (the backend worktree does not exist yet) and Task 1 Step 8 restores `node_modules` with `npm ci`.
- Edge functions never return raw error details. When a message is persisted to `tiktok_publish_error`, it is one of the pt-BR sentences from `tiktok-messages.ts`, or the existing generic text.
- `tiktok-messages.ts` has **no imports at all**: no Deno APIs, no `npm:` and no relative imports. Vite, Vitest, tsc and Deno all load it.
- **No migrations** in this plan.
- Icons come from `lucide-react` only.
- Do not use `useBlocker`.
- Gate order (see the memory gotcha): `npm ci`, then frontend gates, then the Deno gates **last**, then `npm ci` again. Any `deno test` run pollutes the `node_modules` of the worktree it runs in, which is why Tasks 2-7 run in their own worktree.
- Frontend gates:
  - `npx tsc -p apps/crm/tsconfig.json --noEmit`
  - `npx tsc -p apps/hub/tsconfig.json --noEmit`
  - `npx tsc -p apps/admin/tsconfig.json --noEmit`
  - `npx tsc -p tsconfig.scripts.json`
  - `npm run lint`
  - `npm run format:check`
  - `npm run test`
- Backend gates: `npm run check:functions` and `npm run test:functions`.
- Commit after each task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `supabase/functions/_shared/tiktok-messages.ts` (new) | pt-BR messages, can't-post codes, error-code → message map | 1 |
| `supabase/functions/_shared/tiktok-precheck.ts` (new) | `fetchCreatorCheck`, `fetchPrecheckMedia`, pure `evaluateTikTokPrecheck` | 4 |
| `supabase/functions/_shared/tiktok-publish-utils.ts` | branded+SELF_ONLY rule, lost-media rule, `markTikTokPublishFailed` `nonRetryable`, `buildTikTokPostUrl`, `tipo` on confirm | 3, 4, 6 |
| `supabase/functions/tiktok-publish/handler.ts` | creator-info `can_post`/`app_audited`; publish-now precheck, messages, URL | 2, 5, 6 |
| `supabase/functions/tiktok-publish-cron/core.ts` | init precheck once per account, init catch `failReason`, pass `tipo` | 4, 6 |
| `supabase/functions/tiktok-webhook/handler.ts` | `tipo` in the lookup, photo URL | 6 |
| `supabase/functions/_shared/tiktok.ts` | drop `video.upload` | 7 |
| `supabase/functions/tiktok-integration/handlers.ts` | `?tt_connected=1` | 7 |
| `apps/crm/vite.config.ts`, `apps/crm/tsconfig.json`, `vitest.config.ts` | `@mesaas/tiktok-messages` alias | 1 |
| `apps/crm/src/pages/entregas/tiktokComposerRules.ts` (new) | pure composer decisions (A0-A7) | 8 |
| `apps/crm/src/pages/entregas/components/TikTokPostingDeclaration.tsx` (new) | A3 statement | 9 |
| `apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx` | renders the rules, preview, notices | 10 |
| `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` | media, mediaError and readiness wiring | 10 |
| `apps/crm/src/services/tiktok.ts` | `TikTokCreatorInfo` fields, B2 auth URL errors | 10, 13 |
| `apps/crm/src/pages/entregas/components/ScheduleButton.tsx` | reason, declarations, B3, A8 | 11 |
| `AutoSchedulePromptDialog.tsx`, `AutoScheduleBatchDialog.tsx`, their callers | declaration | 12 |
| `ClienteDetalheIndexRedirect.tsx`, `RedesSociaisTab.tsx`, i18n `clients.json` | B1 | 13 |
| `apps/crm/src/components/layout/nav-data.ts` + test + i18n `common.json` | B4 | 14 |

---

## Backend lane

### Task 1: Shared pt-BR message module and CRM alias

**Files:**
- Create: `supabase/functions/_shared/tiktok-messages.ts`
- Create: `supabase/functions/__tests__/tiktok-messages_test.ts`
- Create: `apps/crm/src/lib/__tests__/tiktokMessagesAlias.test.ts`
- Modify: `apps/crm/vite.config.ts` (alias block, next to `@mesaas/platforms`)
- Modify: `apps/crm/tsconfig.json` (`paths`)
- Modify: `vitest.config.ts` (alias block)

**Interfaces, produced:**

```ts
export const TIKTOK_CANNOT_POST_CODES: readonly ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap"];
export type TikTokCannotPostCode = typeof TIKTOK_CANNOT_POST_CODES[number];
export function isTikTokCannotPostCode(code: unknown): code is TikTokCannotPostCode;
export function tiktokErrorMessage(code: string | null | undefined): string | null; // mapped codes only
export const TIKTOK_MSG: {
  privacyMissing: string;
  privacyMismatch: string;
  brandedPrivate: string;
  mediaLost: string;
  mediaMissing: string;
  publicAccountInTestMode: string;
  durationExceeded(seconds: number, max: number): string;        // A5 panel and A10 rule 4 (one sentence)
};
```

- [ ] **Step 1: Write the failing Deno test**

```ts
// supabase/functions/__tests__/tiktok-messages_test.ts
import { assertEquals } from "./assert.ts";
import {
  isTikTokCannotPostCode,
  TIKTOK_CANNOT_POST_CODES,
  TIKTOK_MSG,
  tiktokErrorMessage,
} from "../_shared/tiktok-messages.ts";

Deno.test("tiktok-messages: maps every documented code to pt-BR", () => {
  assertEquals(
    tiktokErrorMessage("spam_risk_too_many_posts"),
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  );
  assertEquals(
    tiktokErrorMessage("spam_risk_user_banned_from_posting"),
    "O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok.",
  );
  assertEquals(
    tiktokErrorMessage("reached_active_user_cap"),
    "O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde.",
  );
  assertEquals(
    tiktokErrorMessage("unaudited_client_can_only_post_to_private_accounts"),
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  );
  assertEquals(
    tiktokErrorMessage("privacy_level_option_mismatch"),
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  );
  assertEquals(
    tiktokErrorMessage("url_ownership_unverified"),
    "O TikTok não reconheceu o endereço da mídia. Fale com o suporte.",
  );
  assertEquals(tiktokErrorMessage("something_else"), null);
  assertEquals(tiktokErrorMessage(undefined), null);
});

Deno.test("tiktok-messages: can't-post codes", () => {
  assertEquals(TIKTOK_CANNOT_POST_CODES.length, 3);
  assertEquals(isTikTokCannotPostCode("reached_active_user_cap"), true);
  assertEquals(isTikTokCannotPostCode("access_token_invalid"), false);
});

Deno.test("tiktok-messages: fixed sentences, no em dashes", () => {
  assertEquals(TIKTOK_MSG.privacyMissing, "Configurações do TikTok incompletas. Abra o post e defina a privacidade.");
  assertEquals(TIKTOK_MSG.brandedPrivate, "A visibilidade de conteúdo de marca não pode ser privada.");
  assertEquals(TIKTOK_MSG.mediaLost, "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.");
  assertEquals(TIKTOK_MSG.mediaMissing, "Adicione mídia ao post para publicar no TikTok.");
  assertEquals(
    TIKTOK_MSG.publicAccountInTestMode,
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.",
  );
  assertEquals(TIKTOK_MSG.durationExceeded(750, 600), "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.");
  for (const v of Object.values(TIKTOK_MSG)) {
    const s = typeof v === "function" ? v(1, 2) : v;
    assertEquals(s.includes("—"), false, s);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-messages_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module**

```ts
// supabase/functions/_shared/tiktok-messages.ts
// Runtime-neutral (no imports): loaded by Deno edge functions AND by the CRM through the
// `@mesaas/tiktok-messages` alias (same wiring as `@mesaas/platforms`). Spec
// 2026-10-08-tiktok-audit-readiness A6/A10.

export const TIKTOK_CANNOT_POST_CODES = [
  "spam_risk_too_many_posts",
  "spam_risk_user_banned_from_posting",
  "reached_active_user_cap",
] as const;
export type TikTokCannotPostCode = typeof TIKTOK_CANNOT_POST_CODES[number];

export function isTikTokCannotPostCode(code: unknown): code is TikTokCannotPostCode {
  return typeof code === "string" && (TIKTOK_CANNOT_POST_CODES as readonly string[]).includes(code);
}

const CODE_MESSAGES: Record<string, string> = {
  spam_risk_too_many_posts:
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  spam_risk_user_banned_from_posting:
    "O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok.",
  reached_active_user_cap:
    "O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde.",
  unaudited_client_can_only_post_to_private_accounts:
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  privacy_level_option_mismatch:
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  url_ownership_unverified: "O TikTok não reconheceu o endereço da mídia. Fale com o suporte.",
};

export function tiktokErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return CODE_MESSAGES[code] ?? null;
}

export const TIKTOK_MSG = {
  privacyMissing: "Configurações do TikTok incompletas. Abra o post e defina a privacidade.",
  privacyMismatch: CODE_MESSAGES.privacy_level_option_mismatch,
  brandedPrivate: "A visibilidade de conteúdo de marca não pode ser privada.",
  mediaLost: "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.",
  mediaMissing: "Adicione mídia ao post para publicar no TikTok.",
  publicAccountInTestMode:
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.",
  durationExceeded: (seconds: number, max: number) =>
    `Este vídeo tem ${seconds}s. O máximo permitido para esta conta é ${max}s.`,
};
```

- [ ] **Step 4: Run the Deno test and confirm it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-messages_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the alias in three places**

`apps/crm/vite.config.ts`, after the `'@mesaas/platforms'` entry:

```ts
        '@mesaas/tiktok-messages': path.resolve(
          __dirname,
          '../../supabase/functions/_shared/tiktok-messages.ts',
        ),
```

`apps/crm/tsconfig.json` `paths`, after `@mesaas/platforms`:

```json
      "@mesaas/tiktok-messages": ["../../supabase/functions/_shared/tiktok-messages.ts"]
```

`vitest.config.ts` alias block, after `@mesaas/platforms`:

```ts
      '@mesaas/tiktok-messages': path.resolve(__dirname, 'supabase/functions/_shared/tiktok-messages.ts'),
```

- [ ] **Step 6: Write the alias smoke test**

```ts
// apps/crm/src/lib/__tests__/tiktokMessagesAlias.test.ts
import { describe, expect, it } from 'vitest';
import { TIKTOK_MSG, tiktokErrorMessage } from '@mesaas/tiktok-messages';

describe('@mesaas/tiktok-messages alias', () => {
  it('resolves the shared module from the CRM', () => {
    expect(tiktokErrorMessage('spam_risk_too_many_posts')).toMatch(/limite diário/);
    expect(TIKTOK_MSG.mediaMissing).toBe('Adicione mídia ao post para publicar no TikTok.');
  });
});
```

Run: `npx vitest run apps/crm/src/lib/__tests__/tiktokMessagesAlias.test.ts` (expect PASS), then `npx tsc -p apps/crm/tsconfig.json --noEmit` (expect no errors).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/tiktok-messages.ts supabase/functions/__tests__/tiktok-messages_test.ts apps/crm/vite.config.ts apps/crm/tsconfig.json vitest.config.ts apps/crm/src/lib/__tests__/tiktokMessagesAlias.test.ts
git commit -m "feat(tiktok): shared pt-BR message module + @mesaas/tiktok-messages alias"
```

- [ ] **Step 8: Create the backend worktree** (Execution order, step 2) and run `npm ci` in the main worktree to undo the `node_modules` pollution from Steps 2 and 4.

---

**Tasks 2-7 run in the backend worktree** (`/Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend`, branch `feat/tiktok-audit-readiness-backend`). Every file path below is relative to that worktree; every command runs there. The frontend lane (Tasks 8-14) runs in the main worktree at the same time.

### Task 2: creator-info returns `can_post` and `app_audited` (A6, A7)

**Files:**
- Modify: `supabase/functions/tiktok-publish/handler.ts` (creator-info route, around lines 95-145)
- Test: `supabase/functions/__tests__/tiktok-publish_test.ts`

**Interfaces, produced:** creator-info responds with these HTTP 200 bodies:
- Success: `{ ...TikTok fields, can_post: true, app_audited: boolean }`
- Can't post: `{ can_post: false, cannot_post_reason: <code>, app_audited: boolean }`
- Any other error: 500, unchanged.

- [ ] **Step 1: Update and add tests**

The existing test "creator-info: returns TikTok's fields verbatim with no-store, never cached" asserts `assertEquals(body, creatorInfoPayload)`. Change it to:

```ts
  assertEquals(body, { ...creatorInfoPayload, can_post: true, app_audited: false });
```

`TIKTOK_APP_AUDITED` is unset in tests. Add these tests after it:

```ts
for (const code of ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap"]) {
  Deno.test(`tiktok-publish creator-info: ${code} -> 200 can_post false`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });

    const handler = createPublishHandler(makeDeps(db, {
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: (() => Promise.reject(new TikTokApiError("blocked", code, false))) as never,
    }));
    const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { can_post: false, cannot_post_reason: code, app_audited: false });
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  });
}

Deno.test("tiktok-publish creator-info: app_audited true when TIKTOK_APP_AUDITED=true", async () => {
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });
    const { fn } = stubTiktokFetch({ creatorInfo: { privacy_level_options: ["SELF_ONLY"] } });
    const handler = createPublishHandler(makeDeps(db, {
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: fn,
    }));
    const body = await (await handler(tiktokRequest("creator-info", 5, { method: "GET" }))).json();
    assertEquals(body.app_audited, true);
    assertEquals(body.can_post, true);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("tiktok-publish creator-info: other TikTok errors stay 500 generic", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });
  const handler = createPublishHandler(makeDeps(db, {
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: (() => Promise.reject(new TikTokApiError("boom", "internal_error", false))) as never,
  }));
  const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro ao consultar informações do criador no TikTok." });
});
```

Add `import { TikTokApiError } from "../_shared/tiktok.ts";` at the top of the test file.

- [ ] **Step 2: Run and confirm the new and updated tests fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts --filter "creator-info"`
Expected: FAIL. The bodies are missing `can_post` and `app_audited`, and a can't-post code returns 500.

- [ ] **Step 3: Implement**

In the creator-info route, replace the `try { ... } catch` block with the following. Import `TikTokApiError` from `../_shared/tiktok.ts` and `isTikTokCannotPostCode` from `../_shared/tiktok-messages.ts`.

```ts
    const appAudited = Deno.env.get("TIKTOK_APP_AUDITED") === "true";
    try {
      const { accessToken } = await getFreshToken(svcDb as never, (account as { id: string }).id);
      const data = (await tiktokFetchFn("/post/publish/creator_info/query/", {
        method: "POST",
        accessToken,
        body: JSON.stringify({}),
      })) as Record<string, unknown>;

      return json({
        creator_nickname: data.creator_nickname,
        creator_avatar_url: data.creator_avatar_url,
        privacy_level_options: data.privacy_level_options,
        comment_disabled: data.comment_disabled,
        duet_disabled: data.duet_disabled,
        stitch_disabled: data.stitch_disabled,
        max_video_post_duration_sec: data.max_video_post_duration_sec,
        can_post: true,
        app_audited: appAudited,
      });
    } catch (e) {
      // A6: TikTok answers "can't post right now" with HTTP 200 + a non-ok error.code, which
      // tiktokFetch surfaces as TikTokApiError.code. No `data` comes with it.
      if (e instanceof TikTokApiError && isTikTokCannotPostCode(e.code)) {
        return json({ can_post: false, cannot_post_reason: e.code, app_audited: appAudited });
      }
      console.error("[TIKTOK-PUBLISH] creator-info error:", (e as Error)?.message);
      return json({ error: "Erro ao consultar informações do criador no TikTok." }, 500);
    }
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts --filter "creator-info"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tiktok-publish/handler.ts supabase/functions/__tests__/tiktok-publish_test.ts
git commit -m "feat(tiktok): creator-info reports can_post and app_audited"
```

---

### Task 3: Validator rejects branded + SELF_ONLY and lost media (A2, A10 rule 5)

**Files:**
- Modify: `supabase/functions/_shared/tiktok-publish-utils.ts`:
  - `TikTokMediaFile` (line 40)
  - `validatePrivacyLevel` (around line 175)
  - the media select in `validateForTikTokScheduling` (around line 236)
- Test: `supabase/functions/__tests__/tiktok-publish-utils_test.ts`

**Interfaces, produced:**
- `TikTokMediaFile` gains `media_lost_at: string | null`.
- `validateForTikTokScheduling` errors can now include `TIKTOK_MSG.brandedPrivate` and `TIKTOK_MSG.mediaLost`.

- [ ] **Step 1: Write the failing tests**

`tiktok-publish-utils_test.ts` already has the fixtures these tests need. Do not add new ones:
- `imageLink(i: number, overrides)` (`:22-37`): `overrides` is spread into the `files` object.
- `VALID_SETTINGS` (`:54-65`): a complete `tiktok_settings` with `privacy_level: "SELF_ONLY"` and both brand toggles `false`.
- `seed(db, opts)` (`:86-128`): queues the `workflow_posts`, `post_file_links` and `tiktok_accounts` selects in call order. Its default account has fake token material, so the result also carries "Erro ao decifrar token do TikTok. Reconecte a conta."; the assertions below use `includes`, which is unaffected.

Add, after the "unaudited app + SELF_ONLY passes the unaudited gate" test (`:507`):

```ts
Deno.test("validateForTikTokScheduling: branded content + SELF_ONLY is rejected (spec A2)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "feed",
    tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY", brand_content_toggle: true },
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.includes("A visibilidade de conteúdo de marca não pode ser privada."),
    res.errors.join(" | "),
  );
});

Deno.test("validateForTikTokScheduling: branded content + PUBLIC_TO_EVERYONE passes the A2 rule", async () => {
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    const db = createSupabaseQueryMock();
    seed(db, {
      tipo: "feed",
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "PUBLIC_TO_EVERYONE", brand_content_toggle: true },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assertEquals(res.errors.includes("A visibilidade de conteúdo de marca não pode ser privada."), false);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("validateForTikTokScheduling: media with media_lost_at is rejected (spec A10 rule 5)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "feed", links: [imageLink(0, { media_lost_at: "2026-08-14T00:00:00Z" })] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.includes("Uma das mídias deste post foi perdida. Substitua-a antes de publicar."),
    res.errors.join(" | "),
  );
});

Deno.test("validateForTikTokScheduling: selects media_lost_at from files", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "feed" });
  await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  const linksCall = db.calls.find((c) => c.table === "post_file_links" && c.operation === "select");
  assertEquals(String(linksCall?.selectArgs[0]?.[0]).includes("media_lost_at"), true);
});
```

`db.calls[].selectArgs` is how `test/shared/supabaseMock.ts` (`:14-21`) records the `.select(...)` arguments; there is no `columns` field.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-utils_test.ts --filter "validateForTikTokScheduling"`
Expected: the "branded content + SELF_ONLY", "media_lost_at" and "selects media_lost_at" tests FAIL; the PUBLIC_TO_EVERYONE one already passes.

- [ ] **Step 3: Implement**

1. Add `media_lost_at: string | null;` to `TikTokMediaFile` (the non-exported interface at `:40` that types `TikTokValidationResult.media`; it stays non-exported).
2. In the `post_file_links` select string, add `media_lost_at` inside `files!inner(...)`:
   `"sort_order, files!inner(id, kind, mime_type, size_bytes, width, height, duration_seconds, r2_key, media_lost_at)"`.
3. After `validateMediaForTipo(...)`, add:

   ```ts
   if (mediaFiles.some((f) => f.media_lost_at != null)) errors.push(TIKTOK_MSG.mediaLost);
   ```

4. At the end of `validatePrivacyLevel`, after the unaudited check, add:

   ```ts
   if (settings.brand_content_toggle === true && privacyLevel === "SELF_ONLY") {
     errors.push(TIKTOK_MSG.brandedPrivate);
   }
   ```

   If `TikTokSettings` lacks `brand_content_toggle?: boolean`, add it to that interface.
5. Add `import { TIKTOK_MSG } from "./tiktok-messages.ts";`.

- [ ] **Step 4: Run and confirm it passes, plus the whole file**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-utils_test.ts`
Expected: PASS. Any older fixture whose `files` object lacks `media_lost_at` still passes, because `undefined != null` is false.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tiktok-publish-utils.ts supabase/functions/__tests__/tiktok-publish-utils_test.ts
git commit -m "feat(tiktok): validator rejects branded+SELF_ONLY and lost media"
```

---

### Task 4: Pre-init precheck helper, and wiring it into the cron (A6, A10)

**Files:**
- Create: `supabase/functions/_shared/tiktok-precheck.ts`
- Create: `supabase/functions/__tests__/tiktok-precheck_test.ts`
- Modify: `supabase/functions/_shared/tiktok-publish-utils.ts` (`markTikTokPublishFailed` opts)
- Modify: `supabase/functions/tiktok-publish-cron/core.ts` (`processInitPhase`, lines ~162-245)
- Test: `supabase/functions/__tests__/tiktok-publish-cron_test.ts`

**Interfaces, produced:**

```ts
// tiktok-precheck.ts
export type CreatorCheck =
  | { kind: "ok"; privacyLevelOptions: string[] | null; maxVideoPostDurationSec: number | null }
  | { kind: "cannot_post"; code: TikTokCannotPostCode }
  | { kind: "skip" }; // fail-open: network/5xx/429/unknown
export interface PrecheckMedia { kind: string; duration_seconds: number | null; media_lost_at: string | null }
export async function fetchCreatorCheck(
  tiktokFetch: (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>,
  accessToken: string,
): Promise<CreatorCheck>; // RETHROWS TikTokApiError with code TOKEN_INVALID | REVOKED
export async function fetchPrecheckMedia(svc: any, postId: number): Promise<PrecheckMedia[]>; // throws on DB error
export function evaluateTikTokPrecheck(input: {
  tipo: string;
  settings: { privacy_level?: string } | null | undefined;
  media: PrecheckMedia[];
  creator: CreatorCheck;
}): string | null; // pt-BR failure message, or null = proceed
```

`markTikTokPublishFailed(svc, postId, retryCount, message, opts?: { failReason?: string; nonRetryable?: boolean })`: with `nonRetryable: true`, `retry_count` is set to 3.

**Rule order in `evaluateTikTokPrecheck`.** The first match wins.
1. `!settings?.privacy_level` → `TIKTOK_MSG.privacyMissing`
2. Media empty → `TIKTOK_MSG.mediaMissing`; any `media_lost_at` → `TIKTOK_MSG.mediaLost`. These two run regardless of `creator.kind`.
3. `creator.kind === "cannot_post"` → `tiktokErrorMessage(creator.code)`
4. `creator.kind === "ok"`:
   - If `privacyLevelOptions` is a non-empty array that doesn't include `privacy_level` → `TIKTOK_MSG.privacyMismatch`.
   - If `tipo === "reels"`, `maxVideoPostDurationSec != null`, and a video's `duration_seconds > max` → `TIKTOK_MSG.durationExceeded(longest, max)`.
5. Otherwise `null`.

This is the spec's A10 order (rule 1, then rule 5, then rules 2-4): the two rules that need no creator_info always run, so lost media blocks even when creator_info fails open.

- [ ] **Step 1: Write the failing precheck tests**

```ts
// supabase/functions/__tests__/tiktok-precheck_test.ts
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { TikTokApiError } from "../_shared/tiktok.ts";
import { evaluateTikTokPrecheck, fetchCreatorCheck, fetchPrecheckMedia } from "../_shared/tiktok-precheck.ts";

/** Local stand-in for std's assertRejects — ./assert.ts deliberately stays tiny
 * (same helper as tiktok-shared_test.ts). */
// deno-lint-ignore no-explicit-any
async function assertRejects(fn: () => Promise<unknown>, ErrClass?: new (...a: any[]) => Error): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    if (ErrClass) {
      assert(e instanceof ErrClass, `expected ${ErrClass.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return e as Error;
  }
  throw new Error("expected the function to throw, but it did not");
}

const video = (d: number | null, lost: string | null = null) => ({ kind: "video", duration_seconds: d, media_lost_at: lost });
const ok = (opts: Partial<{ privacyLevelOptions: string[] | null; maxVideoPostDurationSec: number | null }> = {}) =>
  ({ kind: "ok" as const, privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600, ...opts });

Deno.test("precheck: privacy missing wins first", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: {}, media: [video(10)], creator: ok() }),
    "Configurações do TikTok incompletas. Abra o post e defina a privacidade.",
  );
});

Deno.test("precheck: lost media blocks even when creator check skipped", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(10, "2026-08-14")], creator: { kind: "skip" } }),
    "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.",
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "feed", settings: { privacy_level: "SELF_ONLY" }, media: [], creator: { kind: "skip" } }),
    "Adicione mídia ao post para publicar no TikTok.",
  );
});

Deno.test("precheck: cannot_post maps to pt-BR", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(10)], creator: { kind: "cannot_post", code: "spam_risk_too_many_posts" } }),
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  );
});

Deno.test("precheck: privacy no longer offered", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "PUBLIC_TO_EVERYONE" }, media: [video(10)], creator: ok() }),
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  );
  // empty/missing options list never blocks (older creator_info stubs return {})
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "PUBLIC_TO_EVERYONE" }, media: [video(10)], creator: ok({ privacyLevelOptions: null }) }),
    null,
  );
});

Deno.test("precheck: duration over the creator limit (video only)", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(750)], creator: ok() }),
    "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.",
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(null)], creator: ok() }),
    null,
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(600)], creator: ok() }),
    null,
  );
});

Deno.test("fetchCreatorCheck: ok / cannot_post / fail-open / token errors rethrow", async () => {
  const okFetch = () => Promise.resolve({ privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 300 });
  assertEquals(await fetchCreatorCheck(okFetch as never, "t"), { kind: "ok", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 300 });

  const cap = () => Promise.reject(new TikTokApiError("x", "reached_active_user_cap", false));
  assertEquals(await fetchCreatorCheck(cap as never, "t"), { kind: "cannot_post", code: "reached_active_user_cap" });

  for (const err of [new Error("network"), new TikTokApiError("rl", "RATE_LIMITED", true), new TikTokApiError("x", "internal_error", false)]) {
    assertEquals(await fetchCreatorCheck((() => Promise.reject(err)) as never, "t"), { kind: "skip" });
  }

  for (const code of ["TOKEN_INVALID", "REVOKED"]) {
    const err = await assertRejects(
      () => fetchCreatorCheck((() => Promise.reject(new TikTokApiError("x", code, false))) as never, "t"),
      TikTokApiError,
    );
    assertEquals((err as TikTokApiError).code, code);
  }
});

Deno.test("fetchPrecheckMedia: selects kind, duration, media_lost_at in order", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", { data: [
    { sort_order: 0, files: { kind: "video", duration_seconds: 42, media_lost_at: null } },
  ], error: null });
  assertEquals(await fetchPrecheckMedia(db as never, 7), [{ kind: "video", duration_seconds: 42, media_lost_at: null }]);
  const call = db.calls.find((c) => c.table === "post_file_links");
  // supabaseMock records `.select(...)` arguments in `selectArgs: unknown[][]` (test/shared/supabaseMock.ts:14-21).
  assertEquals(String(call?.selectArgs[0]?.[0]), "sort_order, files!inner(kind, duration_seconds, media_lost_at)");
  assertEquals(call?.modifiers.map((m) => m.method), ["eq", "order"]);
});

Deno.test("fetchPrecheckMedia: a DB error throws (never read as 'no media')", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", { data: null, error: { message: "boom" } });
  await assertRejects(() => fetchPrecheckMedia(db as never, 7));
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-precheck_test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `tiktok-precheck.ts`**

```ts
// supabase/functions/_shared/tiktok-precheck.ts
// Spec 2026-10-08-tiktok-audit-readiness A10: authoritative creator check right before
// TikTok init. The evaluator is pure; the two fetchers are thin and injectable.
import { TikTokApiError } from "./tiktok.ts";
import {
  isTikTokCannotPostCode,
  TIKTOK_MSG,
  type TikTokCannotPostCode,
  tiktokErrorMessage,
} from "./tiktok-messages.ts";

export type CreatorCheck =
  | { kind: "ok"; privacyLevelOptions: string[] | null; maxVideoPostDurationSec: number | null }
  | { kind: "cannot_post"; code: TikTokCannotPostCode }
  | { kind: "skip" };

export interface PrecheckMedia {
  kind: string;
  duration_seconds: number | null;
  media_lost_at: string | null;
}

type TikTokFetch = (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;

export async function fetchCreatorCheck(tiktokFetch: TikTokFetch, accessToken: string): Promise<CreatorCheck> {
  try {
    const data = (await tiktokFetch("/post/publish/creator_info/query/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({}),
    })) as Record<string, unknown> | null;
    const options = Array.isArray(data?.privacy_level_options)
      ? (data!.privacy_level_options as unknown[]).filter((o): o is string => typeof o === "string")
      : null;
    const max = typeof data?.max_video_post_duration_sec === "number" ? data.max_video_post_duration_sec : null;
    return { kind: "ok", privacyLevelOptions: options, maxVideoPostDurationSec: max };
  } catch (err) {
    if (err instanceof TikTokApiError) {
      if (isTikTokCannotPostCode(err.code)) return { kind: "cannot_post", code: err.code };
      if (err.code === "TOKEN_INVALID" || err.code === "REVOKED") throw err;
    }
    // Fail-open: the check is a guard, never an outage dependency. Init surfaces real problems.
    console.warn("[tiktok-precheck] creator_info unavailable, proceeding:", (err as Error)?.message);
    return { kind: "skip" };
  }
}

// deno-lint-ignore no-explicit-any
export async function fetchPrecheckMedia(svc: any, postId: number): Promise<PrecheckMedia[]> {
  const { data, error } = await svc
    .from("post_file_links")
    .select("sort_order, files!inner(kind, duration_seconds, media_lost_at)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`fetchPrecheckMedia: post_file_links read failed: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((l: any) => ({
    kind: l.files.kind,
    duration_seconds: l.files.duration_seconds ?? null,
    media_lost_at: l.files.media_lost_at ?? null,
  }));
}

export function evaluateTikTokPrecheck(input: {
  tipo: string;
  settings: { privacy_level?: string } | null | undefined;
  media: PrecheckMedia[];
  creator: CreatorCheck;
}): string | null {
  const privacy = input.settings?.privacy_level;
  if (!privacy) return TIKTOK_MSG.privacyMissing;
  if (input.media.length === 0) return TIKTOK_MSG.mediaMissing;
  if (input.media.some((m) => m.media_lost_at != null)) return TIKTOK_MSG.mediaLost;
  if (input.creator.kind === "cannot_post") return tiktokErrorMessage(input.creator.code);
  if (input.creator.kind === "ok") {
    const opts = input.creator.privacyLevelOptions;
    if (opts && opts.length > 0 && !opts.includes(privacy)) return TIKTOK_MSG.privacyMismatch;
    const max = input.creator.maxVideoPostDurationSec;
    if (input.tipo === "reels" && max != null) {
      const longest = Math.max(0, ...input.media.filter((m) => m.kind === "video").map((m) => m.duration_seconds ?? 0));
      if (longest > max) return TIKTOK_MSG.durationExceeded(longest, max);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the precheck tests and confirm they pass**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-precheck_test.ts`
Expected: PASS.

- [ ] **Step 5: Add `nonRetryable` to `markTikTokPublishFailed`**

In `tiktok-publish-utils.ts`:

```ts
export async function markTikTokPublishFailed(
  svc: SvcClient,
  postId: number,
  retryCount: number,
  message: string,
  opts?: { failReason?: string; nonRetryable?: boolean },
): Promise<void> {
  const nonRetryable = opts?.nonRetryable === true ||
    (opts?.failReason !== undefined && !RETRYABLE_FAIL_REASONS.includes(opts.failReason));
```

Leave the rest unchanged. Update the doc comment above it with one sentence: "`nonRetryable: true` exhausts immediately (precheck failures, spec A10)."

- [ ] **Step 6: Write the failing cron tests**

`tiktok-publish-cron_test.ts` already defines the helpers these tests use (`:28-85`): `callsFor(db, table, op)`, `rpcCalls(db, name)`, `claimedPost(overrides)` (default `tipo: "feed"`, `tiktok_account_id: "acct-1"`, `tiktok_settings: { privacy_level: "SELF_ONLY" }`, `tiktok_publish_retry_count: 0`), `queueClaims(db, init, status, retry)` and `baseDeps(db, overrides)`. Two new optional deps, `fetchCreatorCheck?` and `fetchPrecheckMedia?`, are added to `TikTokPublishCronDeps` in Step 8 so tests stub them instead of queueing extra DB calls.

1. Add `TikTokApiError` to the existing `../_shared/tiktok.ts` import (`:19`): `import { FIELD_PUBLIC_POST_ID, TikTokApiError } from "../_shared/tiktok.ts";`

2. **Stub the two new deps in the two existing init tests**, otherwise they break for the wrong reason once Step 8 lands: the real `fetchCreatorCheck` calls `tiktokFetch`, and both tests count every `tiktokFetch` call (`initCalls.length === 5` at `:142`, `calls.length === 2` at `:196`); the real `fetchPrecheckMedia` reads an unqueued `post_file_links` select, which the mock answers with `data: []`, so every post would fail with "Adicione mídia…". Add to the `baseDeps(db, { ... })` overrides of both test (b) "caps at 5 inits per account" (`:127-138`) and test (c) "reels hits video/init…" (`:179-193`):

   ```ts
       fetchCreatorCheck: async () => ({ kind: "skip" }),
       fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
   ```

   (The precheck's duration rule only looks at `kind === "video"` items for `tipo === "reels"`, and `null` durations never block, so one image row is a valid stub for every tipo.)

3. Add these five tests right after test (c) (before the `// ── (e) status phase` comment):

```ts
// ── (d) init phase: pre-init creator/media precheck (spec A10) ─────────────────

Deno.test("tiktok-publish-cron init phase: precheck failure -> non-retryable fail, no init call", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, tipo: "reels", tiktok_settings: { privacy_level: "SELF_ONLY" } })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-1" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "video", r2_key: "vid/1.mp4", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "cannot_post", code: "spam_risk_too_many_posts" }),
    fetchPrecheckMedia: async () => [{ kind: "video", duration_seconds: 10, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, [], "a precheck failure must never reach TikTok init");

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 1);
  const payload = updates[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_publish_status, "failed");
  assertEquals(payload.tiktok_publish_retry_count, 3);
  assertEquals(payload.tiktok_publish_processing_at, null);
  assertEquals(
    payload.tiktok_publish_error,
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  );
  const statusRpc = rpcCalls(db, "record_post_status_change");
  assertEquals(statusRpc.length, 1);
  assertEquals((statusRpc[0].payload as Record<string, unknown>).p_new_status, "falha_publicacao");
});

Deno.test("tiktok-publish-cron init phase: creator check runs once per account, with that account's token", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [
    claimedPost({ post_id: 1 }),
    claimedPost({ post_id: 2 }),
    claimedPost({ post_id: 3, tiktok_account_id: "acct-2" }),
  ], [], []);

  const checkedWith: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async (_svc, accountId) => ({ accessToken: `tok-${accountId}`, openId: "open-1" }),
    tiktokFetch: async () => ({ publish_id: "pub-x" }),
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async (_tiktokFetch, accessToken) => {
      checkedWith.push(accessToken);
      return { kind: "skip" };
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(checkedWith, ["tok-acct-1", "tok-acct-2"], "one creator_info call per account, never per post");
  const inited = callsFor(db, "workflow_posts", "update")
    .filter((c) => (c.payload as Record<string, unknown>).tiktok_publish_status === "initiated");
  assertEquals(inited.length, 3);
});

Deno.test("tiktok-publish-cron init phase: mapped TikTok init error -> pt-BR message, non-retryable", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false);
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  const payload = callsFor(db, "workflow_posts", "update")[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_publish_status, "failed");
  assertEquals(payload.tiktok_publish_retry_count, 3);
  assertEquals(
    payload.tiktok_publish_error,
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  );
});

Deno.test("tiktok-publish-cron init phase: unmapped init error stays retryable (+1, raw message)", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, tiktok_publish_retry_count: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new Error("network down");
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  const payload = callsFor(db, "workflow_posts", "update")[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_publish_status, "failed");
  assertEquals(payload.tiktok_publish_retry_count, 2);
  assertEquals(payload.tiktok_publish_error, "network down");
});

Deno.test("tiktok-publish-cron init phase: TOKEN_INVALID from the creator check fails every post of the account, retryable, no init", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 }), claimedPost({ post_id: 2 })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-x" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => {
      throw new TikTokApiError("access token invalid", "TOKEN_INVALID", false);
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, []);
  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 2);
  for (const u of updates) {
    const payload = u.payload as Record<string, unknown>;
    assertEquals(payload.tiktok_publish_status, "failed");
    assertEquals(payload.tiktok_publish_retry_count, 1);
    assertEquals(payload.tiktok_publish_error, "Erro ao obter token do TikTok: access token invalid");
  }
});
```

`tokenErrorMessage` (`core.ts:155-159`) only special-cases `TOKEN_EXPIRED`; every other code renders as `Erro ao obter token do TikTok: <message>`, which is the string the last test pins (spec A10, "fail as the `getFreshTikTokToken` catch does, retryable").

- [ ] **Step 7: Run and confirm they fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-cron_test.ts --filter "init phase"`
Expected: the five new tests FAIL (no precheck yet, so init is called and the mapped/unmapped errors are both stored raw with `+1`); tests (b) and (c) still pass because `baseDeps` ignores the two unknown overrides until Step 8 adds them.

- [ ] **Step 8: Implement in `core.ts`**

1. Add to `TikTokPublishCronDeps`:

   ```ts
   fetchCreatorCheck?: typeof realFetchCreatorCheck;
   fetchPrecheckMedia?: typeof realFetchPrecheckMedia;
   ```

   Add these imports to `core.ts` (`deno check` over `tiktok-publish-cron/index.ts` type-checks this file, so the `CreatorCheck` type import is required by the `let creator: CreatorCheck` below):

   ```ts
   import {
     type CreatorCheck,
     evaluateTikTokPrecheck,
     fetchCreatorCheck as realFetchCreatorCheck,
     fetchPrecheckMedia as realFetchPrecheckMedia,
   } from "../_shared/tiktok-precheck.ts";
   import { TikTokApiError } from "../_shared/tiktok.ts";
   import { tiktokErrorMessage } from "../_shared/tiktok-messages.ts";
   ```

2. In `processInitPhase`, after the access token is obtained and before the `for (const post of toProcess)` loop:

   ```ts
       let creator: CreatorCheck;
       try {
         creator = await fetchCreatorCheck(tiktokFetch, accessToken);
       } catch (err) {
         // TOKEN_INVALID / REVOKED rethrown by fetchCreatorCheck: same treatment as the
         // getFreshTikTokToken catch above (spec A10): tokenErrorMessage, retryable (+1).
         const message = tokenErrorMessage(err);
         for (const post of toProcess) {
           await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, message);
           failed++;
         }
         continue;
       }
   ```

   Read `const fetchCreatorCheck = deps.fetchCreatorCheck ?? realFetchCreatorCheck;` and the same pattern for `fetchPrecheckMedia` at the top of the function.

3. At the top of the per-post `try`, before `fetchPostMedia`:

   ```ts
           const precheckMedia = await fetchPrecheckMedia(svc, post.post_id);
           const precheckFailure = evaluateTikTokPrecheck({
             tipo: post.tipo,
             settings: post.tiktok_settings,
             media: precheckMedia,
             creator,
           });
           if (precheckFailure) {
             await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, precheckFailure, {
               nonRetryable: true,
             });
             failed++;
             continue;
           }
   ```

4. Replace the per-post `catch`:

   ```ts
         } catch (err) {
           const code = err instanceof TikTokApiError ? err.code : undefined;
           const mapped = tiktokErrorMessage(code);
           await markTikTokPublishFailed(
             svc,
             post.post_id,
             post.tiktok_publish_retry_count,
             mapped ?? errorMessage(err),
             mapped ? { nonRetryable: true } : undefined,
           );
           failed++;
         }
   ```

- [ ] **Step 9: Run the whole cron and utils suites**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-cron_test.ts supabase/functions/__tests__/tiktok-publish-utils_test.ts supabase/functions/__tests__/tiktok-precheck_test.ts`
Expected: PASS, including tests (b) and (c), which Step 6.2 already stubbed. If either fails with "Adicione mídia ao post…" or an off-by-one call count, the Step 6.2 stubs were not added.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/tiktok-precheck.ts supabase/functions/__tests__/tiktok-precheck_test.ts supabase/functions/_shared/tiktok-publish-utils.ts supabase/functions/tiktok-publish-cron/core.ts supabase/functions/__tests__/tiktok-publish-cron_test.ts
git commit -m "feat(tiktok): pre-init creator/media precheck in the cron; mapped init errors are non-retryable"
```

---

### Task 5: Publish-now uses the precheck and the mapped messages (A6, A10)

**Files:**
- Modify: `supabase/functions/tiktok-publish/handler.ts` (publish-now, lines ~343-534)
- Test: `supabase/functions/__tests__/tiktok-publish_test.ts`

**Interfaces, consumed:**
- `fetchCreatorCheck`, `evaluateTikTokPrecheck` (Task 4)
- `tiktokErrorMessage` (Task 1)
- `media_lost_at` on each `validation.media` item (Task 3; the item type is the non-exported `TikTokMediaFile` behind `TikTokValidationResult.media`, so nothing is imported for it)

Publish-now already has the validated media, with `duration_seconds` and `media_lost_at`, in `validation.media`. It does **not** call `fetchPrecheckMedia`.

**Behaviour:**
- If the precheck fails after the claim:
  - persist `tiktok_publish_status 'failed'`, the message, `tiktok_publish_retry_count = 3`, lock null
  - move the post to `falha_publicacao`
  - respond **422** `{ error: <message> }`
- If init fails with a mapped TikTok code: the same, with the mapped message, 422.
- Unmapped errors keep today's behaviour: count +1, then 500 generic.

- [ ] **Step 1: Add the dep and write the failing tests**

Add `fetchCreatorCheck?: typeof realFetchCreatorCheck;` to `TikTokPublishDeps`.

```ts
Deno.test("tiktok-publish publish-now: precheck failure -> 422 with pt-BR message, retry_count 3, no init", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "reels" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("record_post_status_change", { data: null, error: null }); // -> agendado
  db.queue("workflow_posts", "update", { data: null, error: null });     // lock
  db.queue("workflow_posts", "update", { data: null, error: null });     // failure write
  db.queueRpc("record_post_status_change", { data: null, error: null }); // -> falha_publicacao

  const { fn, calls } = stubTiktokFetch();
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation({
      media: [{ id: 1, kind: "video", mime_type: "video/mp4", size_bytes: 1, width: 1080, height: 1920,
        duration_seconds: 750, r2_key: "v.mp4", sort_order: 0, media_lost_at: null }],
    }))) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: fn,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "ok", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600 })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Este vídeo tem 750s. O máximo permitido para esta conta é 600s." });
  assertEquals(calls.filter((c) => c.path.endsWith("/init/")).length, 0);
  const failWrite = callsFor(db, "workflow_posts", "update").at(-1)!.payload as Record<string, unknown>;
  assertEquals(failWrite.tiktok_publish_status, "failed");
  assertEquals(failWrite.tiktok_publish_retry_count, 3);
});

Deno.test("tiktok-publish publish-now: mapped init error -> 422 pt-BR, retry_count 3", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("record_post_status_change", { data: null, error: null }); // -> agendado
  db.queue("workflow_posts", "update", { data: null, error: null });     // lock
  db.queue("workflow_posts", "update", { data: null, error: null });     // failure write
  db.queueRpc("record_post_status_change", { data: null, error: null }); // -> falha_publicacao

  const initCalls: string[] = [];
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: ((path: string) => {
      initCalls.push(path);
      return Promise.reject(new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false));
    }) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), {
    error: "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  });
  assertEquals(initCalls, ["/post/publish/content/init/"]);
  const failWrite = callsFor(db, "workflow_posts", "update").at(-1)!.payload as Record<string, unknown>;
  assertEquals(failWrite.tiktok_publish_status, "failed");
  assertEquals(failWrite.tiktok_publish_retry_count, 3);
  assertEquals(
    failWrite.tiktok_publish_error,
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  );
  const statusRpc = rpcCalls(db, "record_post_status_change");
  assertEquals((statusRpc.at(-1)!.payload as Record<string, unknown>).p_new_status, "falha_publicacao");
});

Deno.test("tiktok-publish publish-now: unmapped init error keeps +1 and the generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed", tiktok_publish_retry_count: 1 }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("record_post_status_change", { data: null, error: null });
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: (() => Promise.reject(new Error("socket hang up"))) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 500);
  const failWrite = callsFor(db, "workflow_posts", "update").at(-1)!.payload as Record<string, unknown>;
  assertEquals(failWrite.tiktok_publish_retry_count, 2);
  assertEquals(failWrite.tiktok_publish_error, "socket hang up");
});
```

`TikTokApiError` is already imported at the top of this test file by Task 2.

Then update the existing fixtures and tests in the same file:
- `okTikTokValidation` (`:72-93`): add `media_lost_at: null,` to its media item, once.
- "publish-now: success calls mark_platform_published and returns postado" (`:578-634`): add `fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,` to its `makeDeps` overrides, so the `fetchCalls.length === 2` assertion at `:611` still holds (the real `fetchCreatorCheck` would route a third call through the `tiktokFetch` stub).
- "publish-now: still-processing after 12 polls" (`:636-677`) and the `media changes before claiming` family (`:698-765`) do not need the stub: `stubTiktokFetch()` answers `/post/publish/creator_info/query/` with `{}`, which `fetchCreatorCheck` reads as `{ kind: "ok", privacyLevelOptions: null, maxVideoPostDurationSec: null }`, and none of those tests asserts the total call count except `:757`, whose branch fails validation before any token is fetched.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts --filter "publish-now"`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

0. Imports at the top of `handler.ts` (Task 2 already added `TikTokApiError` and `isTikTokCannotPostCode`):

   ```ts
   import {
     evaluateTikTokPrecheck,
     fetchCreatorCheck as realFetchCreatorCheck,
   } from "../_shared/tiktok-precheck.ts";
   import { isTikTokCannotPostCode, tiktokErrorMessage } from "../_shared/tiktok-messages.ts";
   ```

   (Merge the second line with Task 2's existing `tiktok-messages.ts` import rather than importing the module twice.)

1. Inside the claimed `try`, after `const { accessToken } = await getFreshToken(...)`:

   ```ts
           const creator = await (deps.fetchCreatorCheck ?? realFetchCreatorCheck)(tiktokFetchFn, accessToken);
           const precheckFailure = evaluateTikTokPrecheck({
             tipo: post.tipo,
             settings: post.tiktok_settings,
             media: (validation.media ?? []).map((m) => ({
               kind: m.kind,
               duration_seconds: m.duration_seconds,
               media_lost_at: m.media_lost_at ?? null,
             })),
             creator,
           });
           if (precheckFailure) throw new TikTokUserFacingError(precheckFailure);
   ```

2. At module level:

   ```ts
   /** A failure whose message is a curated pt-BR sentence: safe to persist and return (422). */
   class TikTokUserFacingError extends Error {}
   ```

3. Before `throw new Error("TikTok init did not return a publish_id")`, nothing changes. Init errors are `TikTokApiError` and are mapped in the catch.

4. Rewrite the start of the `catch (err)` block:

   ```ts
         } catch (err) {
           const mapped = err instanceof TikTokUserFacingError
             ? err.message
             : tiktokErrorMessage(err instanceof TikTokApiError ? err.code : undefined);
           const message = mapped ?? (err as Error)?.message ?? "Unknown error";
           console.error(`[TIKTOK-PUBLISH-NOW] failed for post ${postId}:`, (err as Error)?.message);

           const { error: failErr } = await svcDb
             .from("workflow_posts")
             .update({
               tiktok_publish_status: "failed",
               tiktok_publish_error: message.slice(0, 500),
               tiktok_publish_retry_count: mapped ? 3 : (post.tiktok_publish_retry_count ?? 0) + 1,
               tiktok_publish_processing_at: null,
             })
             .eq("id", postId);
   ```

   Keep the existing `failErr` logging and the `record_post_status_change` → `falha_publicacao` block. Change the final return to:

   ```ts
           if (validationFailure) return validationFailure;
           if (mapped) return json({ error: mapped }, 422);
           return internalServerError(json, "tiktok-publish:publish-now", err);
   ```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tiktok-publish/handler.ts supabase/functions/__tests__/tiktok-publish_test.ts
git commit -m "feat(tiktok): publish-now runs the creator precheck and returns pt-BR 422s"
```

---

### Task 6: Photo-post URL and `tipo` plumbing (B5)

**Files:**
- Modify: `supabase/functions/_shared/tiktok-publish-utils.ts`:
  - add `buildTikTokPostUrl`
  - `ConfirmAndApplyPublishStatusPost.tipo`
  - the URL builder at line ~626
- Modify: `supabase/functions/tiktok-publish-cron/core.ts` (status phase, pass `tipo`, line ~283)
- Modify: `supabase/functions/tiktok-publish/handler.ts` (line ~453)
- Modify: `supabase/functions/tiktok-webhook/handler.ts`:
  - `findPostByPublishId` select and `FoundPost`
  - `handlePubliclyAvailable`
  - the `confirmAndApplyPublishStatus` call that builds a `ConfirmAndApplyPublishStatusPost` from `FoundPost`
- Tests: `tiktok-publish-utils_test.ts`, `tiktok-publish_test.ts`, `tiktok-publish-cron_test.ts`, `tiktok-webhook_test.ts`

**Interfaces, produced:**

```ts
export function buildTikTokPostUrl(username: string, postId: string, tipo: string | null | undefined): string;
// feed | carrossel -> https://www.tiktok.com/@{username}/photo/{id}; anything else -> /video/{id}
export interface ConfirmAndApplyPublishStatusPost { post_id; tiktok_publish_id; tiktok_publish_retry_count; tiktok_username; tipo: string | null }
```

**Before relying on `/photo/`:** the spec says to verify it against a real photo post. That is an owner check at rollout (Task 15 lists it). The code ships with the `/photo/` mapping isolated in this one helper, so reverting it is a one-line change.

- [ ] **Step 1: Write the failing tests**

In `tiktok-publish-utils_test.ts`:

```ts
Deno.test("buildTikTokPostUrl: photo tipos use /photo/, others /video/", () => {
  assertEquals(buildTikTokPostUrl("u", "1", "feed"), "https://www.tiktok.com/@u/photo/1");
  assertEquals(buildTikTokPostUrl("u", "1", "carrossel"), "https://www.tiktok.com/@u/photo/1");
  assertEquals(buildTikTokPostUrl("u", "1", "reels"), "https://www.tiktok.com/@u/video/1");
  assertEquals(buildTikTokPostUrl("u", "1", null), "https://www.tiktok.com/@u/video/1");
});
```

Then update the three existing URL expectations (these are the only `tiktok.com/@` assertions in the suite):

- `tiktok-publish_test.ts:632`, success test, `basePost({ platform: "tiktok", tipo: "feed" })`: expect `"https://www.tiktok.com/@dramarina/photo/7123456"`.
- `tiktok-publish-cron_test.ts:256`, status-phase PUBLISH_COMPLETE test: `claimedPost()` defaults to `tipo: "feed"` (`:44`), so expect `"https://www.tiktok.com/@dktest/photo/7301234"`. Add a sibling test right after it that pins the video branch:

  ```ts
  Deno.test("tiktok-publish-cron status phase: a reels post keeps the /video/ URL", async () => {
    const db = createSupabaseQueryMock();
    const post = claimedPost({ post_id: 31, tipo: "reels", tiktok_publish_id: "pub-31", tiktok_username: "dktest" });
    queueClaims(db, [], [post], []);
    const response = await runTikTokPublishCron(baseDeps(db, {
      getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
      tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301235" }),
      buildTikTokMediaUrl: async () => "",
    }));
    assertEquals(response.status, 200);
    const fields = (rpcCalls(db, "mark_platform_published")[0].payload as Record<string, unknown>).p_fields as Record<string, unknown>;
    assertEquals(fields.tiktok_post_url, "https://www.tiktok.com/@dktest/video/7301235");
  });
  ```

- `tiktok-webhook_test.ts:182-209`, "publicly_available stores tiktok_post_id/tiktok_post_url": change the queued row at `:187` to `{ id: 70, tipo: "carrossel", tiktok_publish_id: "pub-70", tiktok_publish_retry_count: 0 }` and the expectation at `:207` to `"https://www.tiktok.com/@dktest/photo/post-70"`. The redelivery test (`:211-241`) compares the two payloads to each other and its row has no `tipo` (→ `null` → `/video/`), so it needs no change. The `confirmAndApplyPublishStatus` stubs in that file (`:321`, `:367`, `:461`) only read `post.post_id`, so the new `tipo` field in the object the handler builds does not break them.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-utils_test.ts supabase/functions/__tests__/tiktok-publish_test.ts supabase/functions/__tests__/tiktok-publish-cron_test.ts supabase/functions/__tests__/tiktok-webhook_test.ts`
Expected: FAIL in the updated tests.

- [ ] **Step 3: Implement**

In `tiktok-publish-utils.ts`:

```ts
const TIKTOK_PHOTO_TIPOS = new Set(["feed", "carrossel"]);
/** Public TikTok URL for a published post. Photo posts live under /photo/ (spec B5; verify on
 * a real photo post at rollout, revert this one line if TikTok serves them under /video/). */
export function buildTikTokPostUrl(username: string, postId: string, tipo: string | null | undefined): string {
  const segment = tipo && TIKTOK_PHOTO_TIPOS.has(tipo) ? "photo" : "video";
  return `https://www.tiktok.com/@${username}/${segment}/${postId}`;
}
```

- Add `tipo: string | null;` to `ConfirmAndApplyPublishStatusPost`.
- In `confirmAndApplyPublishStatus`, use `buildTikTokPostUrl(post.tiktok_username, result.publicPostId, post.tipo)`.

`core.ts` status phase: add `tipo: post.tipo,` to the object passed to `confirmAndApplyPublishStatus`. The claim RPC already returns `tipo` (`20260830000002:146,192`).

`tiktok-publish/handler.ts:453`: `buildTikTokPostUrl(username, statusResult.publicPostId, post.tipo)`.

`tiktok-webhook/handler.ts`:
- `findPostByPublishId` select becomes `"id, tipo, tiktok_publish_id, tiktok_publish_retry_count"`.
- Add `tipo: string | null` to `FoundPost` and map `tipo: data.tipo ?? null`.
- Pass `tipo: post.tipo` wherever a `ConfirmAndApplyPublishStatusPost` is built from it.
- In `handlePubliclyAvailable`, use `buildTikTokPostUrl(args.account.username, content.post_id, post.tipo)`.

- [ ] **Step 4: Run and confirm they pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tiktok-publish-utils.ts supabase/functions/tiktok-publish-cron/core.ts supabase/functions/tiktok-publish/handler.ts supabase/functions/tiktok-webhook/handler.ts supabase/functions/__tests__/tiktok-publish-utils_test.ts supabase/functions/__tests__/tiktok-publish_test.ts supabase/functions/__tests__/tiktok-publish-cron_test.ts supabase/functions/__tests__/tiktok-webhook_test.ts
git commit -m "fix(tiktok): photo posts link to /photo/ on every completion path"
```

---

### Task 7: Connect redirect and scope cleanup (B1 server side, B6)

**Files:**
- Modify: `supabase/functions/tiktok-integration/handlers.ts:262`
- Modify: `supabase/functions/_shared/tiktok.ts:13-14`
- Tests: `supabase/functions/__tests__/tiktok-integration_test.ts`, `supabase/functions/__tests__/tiktok-shared_test.ts`

- [ ] **Step 1: Update the tests**

```bash
grep -n "clientes/\|video.upload\|TIKTOK_SCOPES\|scope=" supabase/functions/__tests__/tiktok-integration_test.ts supabase/functions/__tests__/tiktok-shared_test.ts
```

The grep finds exactly one `Location` assertion and no scope assertion (the `scope: "user.info.basic,video.list"` at `tiktok-integration_test.ts:68` is the token-exchange fixture, not the auth URL; `:238` only checks the URL prefix).

- `tiktok-integration_test.ts:297`: change `"https://app.example.com/clientes/42"` to `"https://app.example.com/clientes/42?tt_connected=1"`.
- `tiktok-shared_test.ts`: add `TIKTOK_SCOPES` to the existing `../_shared/tiktok.ts` import (`:5-12`), then add:

```ts
Deno.test("tiktok-shared: TIKTOK_SCOPES requests only the demonstrated scopes (no video.upload)", () => {
  assertEquals(TIKTOK_SCOPES, "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish");
});
```

- `tiktok-integration_test.ts`, after the "/auth with feature_tiktok=true returns an authorize url" test (`:225-240`), add a test that the auth URL carries the new scope list end to end:

```ts
Deno.test("tiktok-integration: /auth requests the scope list without video.upload", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/auth/5"));
  const body = await res.json();
  const scope = new URL(body.url).searchParams.get("scope");
  assertEquals(scope, "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish");
});
```

(`makeStorage`, `makeHandler` and `authedRequest` are the file's existing helpers, used by the test right above.)

- [ ] **Step 2: Run and confirm they fail**

Run: `cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/new-session-3cb9fe-backend && deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-integration_test.ts supabase/functions/__tests__/tiktok-shared_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`_shared/tiktok.ts`:

```ts
export const TIKTOK_SCOPES =
  "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish";
```

Check that the comment at `_shared/tiktok.ts:30` still reads correctly; it mentions `video.upload` as the inbox mode we don't use.

`tiktok-integration/handlers.ts:262`:

```ts
  return Response.redirect(`${oauthRedirectBase()}/clientes/${clientId}?tt_connected=1`, 302);
```

- [ ] **Step 4: Run and confirm they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Run the full backend gates**

Run, in the backend worktree: `npm run check:functions && npm run test:functions`
Expected: both PASS. Do **not** run `npm ci` here: this worktree has no npm `node_modules` to restore, and the main worktree gets its `npm ci` after the merge (Execution order, step 4). If `git status --short` shows `deno.lock` modified, run `git checkout deno.lock` before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/tiktok.ts supabase/functions/tiktok-integration/handlers.ts supabase/functions/__tests__/tiktok-integration_test.ts supabase/functions/__tests__/tiktok-shared_test.ts
git commit -m "fix(tiktok): land on Redes sociais after connect; drop unused video.upload scope"
```

---

## Frontend lane

### Task 8: Pure composer rules (A0-A7)

**Files:**
- Create: `apps/crm/src/pages/entregas/tiktokComposerRules.ts`
- Create: `apps/crm/src/pages/entregas/__tests__/tiktokComposerRules.test.ts`

**Interfaces, consumed:** `TIKTOK_MSG`, `tiktokErrorMessage` from `@mesaas/tiktok-messages` (Task 1).

**Interfaces, produced:**

```ts
export interface TikTokReadiness { complete: boolean; reason?: string }
export interface ComposerInputs {
  loading: boolean;
  loadError: string | null;
  creator: {
    can_post?: boolean; cannot_post_reason?: string; app_audited?: boolean;
    privacy_level_options?: string[]; max_video_post_duration_sec?: number;
  } | null;
  tipo: string | null | undefined;
  privacyLevel: string | undefined;
  disclosureOn: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  media: { kind: 'image' | 'video'; duration_seconds: number | null; media_lost_at?: string | null }[] | undefined;
  mediaError: boolean;
}
export const DISCLOSURE_INCOMPLETE_MSG = 'Indique se o conteúdo promove você, um terceiro ou ambos.';
export const CREATOR_LOADING_MSG = 'Carregando informações do criador no TikTok…';
export const MEDIA_LOADING_MSG = 'Carregando mídias do post…';
export const MEDIA_ERROR_MSG = 'Não foi possível carregar as mídias. Reabra o post.';
export const UNAUDITED_OPTION_SUFFIX = '(disponível após a aprovação do app)';
export const BRANDED_PRIVATE_OPTION_SUFFIX = '(não disponível para conteúdo de marca)';
export const BRANDED_PRIVATE_HELPER = 'Conteúdo de marca não pode ter visibilidade privada.';
export function isAppAudited(creator: ComposerInputs['creator']): boolean;   // missing field -> true
export function isPublicAccountInTestMode(creator: ComposerInputs['creator']): boolean;
export function longestVideoSeconds(media: ComposerInputs['media']): number | null;
export function computeTikTokReadiness(i: ComposerInputs): TikTokReadiness;
export function disclosureLabel(brandOrganic: boolean, brandContent: boolean): 'Conteúdo promocional' | 'Parceria paga' | null;
export function privacyOptionState(option: string, ctx: { audited: boolean; brandContent: boolean }): { disabled: boolean; suffix?: string };
export function brandedCheckboxState(ctx: { audited: boolean; privacyLevel: string | undefined }): { disabled: boolean; suffix?: string; helper?: string };
export function cannotPostMessage(creator: ComposerInputs['creator']): string | null;
```

**Order of `computeTikTokReadiness`.** The first failing rule sets `reason`:
1. `loading` → `CREATOR_LOADING_MSG`
2. `loadError` → `loadError` (the panel's existing message)
3. `cannotPostMessage(creator)` → that message
4. `isPublicAccountInTestMode(creator)` → `TIKTOK_MSG.publicAccountInTestMode`
5. `mediaError` → `MEDIA_ERROR_MSG`
6. `media === undefined` → `MEDIA_LOADING_MSG`
7. `media.length === 0` → `TIKTOK_MSG.mediaMissing`
8. Any `media_lost_at` → `TIKTOK_MSG.mediaLost`
9. `!privacyLevel` → `'Escolha a privacidade do post no TikTok.'`
10. `disclosureOn && !brandOrganic && !brandContent` → `DISCLOSURE_INCOMPLETE_MSG`
11. `brandContent && privacyLevel === 'SELF_ONLY'` → `TIKTOK_MSG.brandedPrivate`
12. Video tipo (`reels`), `max_video_post_duration_sec != null`, longest video over it → `TIKTOK_MSG.durationExceeded(longest, max)`
13. Otherwise `{ complete: true }`

Notes on the helpers:
- `isPublicAccountInTestMode` returns `!isAppAudited(creator) && creator.privacy_level_options.includes('PUBLIC_TO_EVERYONE')`.
- `cannotPostMessage` returns `creator?.can_post === false ? (tiktokErrorMessage(creator.cannot_post_reason) ?? 'O TikTok não permite novas publicações nesta conta agora. Tente novamente mais tarde.') : null`.
- `privacyOptionState`:
  - Not audited and option is not `SELF_ONLY` → `{ disabled: true, suffix: UNAUDITED_OPTION_SUFFIX }`.
  - Audited, `brandContent`, option `SELF_ONLY` → `{ disabled: true, suffix: BRANDED_PRIVATE_OPTION_SUFFIX }`.
  - Otherwise `{ disabled: false }`.
- `brandedCheckboxState`:
  - Not audited → `{ disabled: true, suffix: UNAUDITED_OPTION_SUFFIX }`.
  - Audited and privacy `SELF_ONLY` → `{ disabled: true, helper: BRANDED_PRIVATE_HELPER }`.
  - Otherwise `{ disabled: false }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/entregas/__tests__/tiktokComposerRules.test.ts
import { describe, expect, it } from 'vitest';
import {
  brandedCheckboxState,
  computeTikTokReadiness,
  disclosureLabel,
  privacyOptionState,
  type ComposerInputs,
} from '../tiktokComposerRules';

const base: ComposerInputs = {
  loading: false,
  loadError: null,
  creator: { can_post: true, app_audited: true, privacy_level_options: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS'], max_video_post_duration_sec: 600 },
  tipo: 'reels',
  privacyLevel: 'SELF_ONLY',
  disclosureOn: false,
  brandOrganic: false,
  brandContent: false,
  media: [{ kind: 'video', duration_seconds: 42, media_lost_at: null }],
  mediaError: false,
};

describe('computeTikTokReadiness', () => {
  it('complete when every rule passes', () => {
    expect(computeTikTokReadiness(base)).toEqual({ complete: true });
  });
  it.each<[string, Partial<ComposerInputs>, string]>([
    ['creator loading', { loading: true }, 'Carregando informações do criador no TikTok…'],
    ['creator error', { loadError: 'Erro X' }, 'Erro X'],
    ['cannot post', { creator: { ...base.creator, can_post: false, cannot_post_reason: 'spam_risk_too_many_posts' } }, 'Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.'],
    ['public account in test mode', { creator: { ...base.creator, app_audited: false, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] } }, 'Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.'],
    ['media loading', { media: undefined }, 'Carregando mídias do post…'],
    ['media error', { media: undefined, mediaError: true }, 'Não foi possível carregar as mídias. Reabra o post.'],
    ['no media', { media: [] }, 'Adicione mídia ao post para publicar no TikTok.'],
    ['lost media', { media: [{ kind: 'video', duration_seconds: 4, media_lost_at: '2026-08-14' }] }, 'Uma das mídias deste post foi perdida. Substitua-a antes de publicar.'],
    ['no privacy', { privacyLevel: undefined }, 'Escolha a privacidade do post no TikTok.'],
    ['disclosure on, nothing checked', { disclosureOn: true }, 'Indique se o conteúdo promove você, um terceiro ou ambos.'],
    ['branded + private', { disclosureOn: true, brandContent: true }, 'A visibilidade de conteúdo de marca não pode ser privada.'],
    ['duration over limit', { media: [{ kind: 'video', duration_seconds: 750, media_lost_at: null }] }, 'Este vídeo tem 750s. O máximo permitido para esta conta é 600s.'],
  ])('%s', (_name, patch, reason) => {
    expect(computeTikTokReadiness({ ...base, ...patch })).toEqual({ complete: false, reason });
  });
  it('missing can_post/app_audited fields behave like today (older deploy)', () => {
    expect(computeTikTokReadiness({ ...base, creator: { privacy_level_options: ['SELF_ONLY'] } })).toEqual({ complete: true });
  });
  it('null duration never blocks', () => {
    expect(computeTikTokReadiness({ ...base, media: [{ kind: 'video', duration_seconds: null }] })).toEqual({ complete: true });
  });
});

describe('disclosureLabel', () => {
  it('maps the selections', () => {
    expect(disclosureLabel(false, false)).toBeNull();
    expect(disclosureLabel(true, false)).toBe('Conteúdo promocional');
    expect(disclosureLabel(false, true)).toBe('Parceria paga');
    expect(disclosureLabel(true, true)).toBe('Parceria paga');
  });
});

describe('privacyOptionState / brandedCheckboxState', () => {
  it('unaudited: only SELF_ONLY selectable, branded disabled', () => {
    expect(privacyOptionState('SELF_ONLY', { audited: false, brandContent: false })).toEqual({ disabled: false });
    expect(privacyOptionState('FOLLOWER_OF_CREATOR', { audited: false, brandContent: false })).toEqual({ disabled: true, suffix: '(disponível após a aprovação do app)' });
    expect(brandedCheckboxState({ audited: false, privacyLevel: undefined })).toEqual({ disabled: true, suffix: '(disponível após a aprovação do app)' });
  });
  it('audited: branded and SELF_ONLY exclude each other', () => {
    expect(privacyOptionState('SELF_ONLY', { audited: true, brandContent: true })).toEqual({ disabled: true, suffix: '(não disponível para conteúdo de marca)' });
    expect(brandedCheckboxState({ audited: true, privacyLevel: 'SELF_ONLY' })).toEqual({ disabled: true, helper: 'Conteúdo de marca não pode ter visibilidade privada.' });
    expect(brandedCheckboxState({ audited: true, privacyLevel: 'PUBLIC_TO_EVERYONE' })).toEqual({ disabled: false });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/tiktokComposerRules.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `tiktokComposerRules.ts`**

```ts
import { TIKTOK_MSG, tiktokErrorMessage } from '@mesaas/tiktok-messages';

// Spec 2026-10-08-tiktok-audit-readiness A0-A7: every composer decision lives here, pure.
// TikTokSettingsPanel only renders what these functions return.

export interface TikTokReadiness {
  complete: boolean;
  reason?: string;
}

export interface ComposerInputs {
  loading: boolean;
  loadError: string | null;
  creator: {
    can_post?: boolean;
    cannot_post_reason?: string;
    app_audited?: boolean;
    privacy_level_options?: string[];
    max_video_post_duration_sec?: number;
  } | null;
  tipo: string | null | undefined;
  privacyLevel: string | undefined;
  disclosureOn: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  media:
    | { kind: 'image' | 'video'; duration_seconds: number | null; media_lost_at?: string | null }[]
    | undefined;
  mediaError: boolean;
}

export const DISCLOSURE_INCOMPLETE_MSG = 'Indique se o conteúdo promove você, um terceiro ou ambos.';
export const CREATOR_LOADING_MSG = 'Carregando informações do criador no TikTok…';
export const MEDIA_LOADING_MSG = 'Carregando mídias do post…';
export const MEDIA_ERROR_MSG = 'Não foi possível carregar as mídias. Reabra o post.';
export const PRIVACY_MISSING_MSG = 'Escolha a privacidade do post no TikTok.';
export const UNAUDITED_OPTION_SUFFIX = '(disponível após a aprovação do app)';
export const BRANDED_PRIVATE_OPTION_SUFFIX = '(não disponível para conteúdo de marca)';
export const BRANDED_PRIVATE_HELPER = 'Conteúdo de marca não pode ter visibilidade privada.';
const CANNOT_POST_FALLBACK =
  'O TikTok não permite novas publicações nesta conta agora. Tente novamente mais tarde.';

export function isAppAudited(creator: ComposerInputs['creator']): boolean {
  return creator?.app_audited !== false;
}

export function isPublicAccountInTestMode(creator: ComposerInputs['creator']): boolean {
  return (
    !isAppAudited(creator) && (creator?.privacy_level_options ?? []).includes('PUBLIC_TO_EVERYONE')
  );
}

export function cannotPostMessage(creator: ComposerInputs['creator']): string | null {
  if (creator?.can_post !== false) return null;
  return tiktokErrorMessage(creator.cannot_post_reason) ?? CANNOT_POST_FALLBACK;
}

export function longestVideoSeconds(media: ComposerInputs['media']): number | null {
  const durations = (media ?? [])
    .filter((m) => m.kind === 'video' && m.duration_seconds != null)
    .map((m) => m.duration_seconds as number);
  return durations.length ? Math.max(...durations) : null;
}

export function computeTikTokReadiness(i: ComposerInputs): TikTokReadiness {
  const fail = (reason: string): TikTokReadiness => ({ complete: false, reason });
  if (i.loading) return fail(CREATOR_LOADING_MSG);
  if (i.loadError) return fail(i.loadError);
  const cannot = cannotPostMessage(i.creator);
  if (cannot) return fail(cannot);
  if (isPublicAccountInTestMode(i.creator)) return fail(TIKTOK_MSG.publicAccountInTestMode);
  if (i.mediaError) return fail(MEDIA_ERROR_MSG);
  if (i.media === undefined) return fail(MEDIA_LOADING_MSG);
  if (i.media.length === 0) return fail(TIKTOK_MSG.mediaMissing);
  if (i.media.some((m) => m.media_lost_at != null)) return fail(TIKTOK_MSG.mediaLost);
  if (!i.privacyLevel) return fail(PRIVACY_MISSING_MSG);
  if (i.disclosureOn && !i.brandOrganic && !i.brandContent) return fail(DISCLOSURE_INCOMPLETE_MSG);
  if (i.brandContent && i.privacyLevel === 'SELF_ONLY') return fail(TIKTOK_MSG.brandedPrivate);
  const max = i.creator?.max_video_post_duration_sec;
  const longest = longestVideoSeconds(i.media);
  if (i.tipo === 'reels' && max != null && longest != null && longest > max) {
    return fail(TIKTOK_MSG.durationExceeded(longest, max));
  }
  return { complete: true };
}

export function disclosureLabel(
  brandOrganic: boolean,
  brandContent: boolean,
): 'Conteúdo promocional' | 'Parceria paga' | null {
  if (brandContent) return 'Parceria paga';
  if (brandOrganic) return 'Conteúdo promocional';
  return null;
}

export function privacyOptionState(
  option: string,
  ctx: { audited: boolean; brandContent: boolean },
): { disabled: boolean; suffix?: string } {
  if (!ctx.audited && option !== 'SELF_ONLY') return { disabled: true, suffix: UNAUDITED_OPTION_SUFFIX };
  if (ctx.audited && ctx.brandContent && option === 'SELF_ONLY') {
    return { disabled: true, suffix: BRANDED_PRIVATE_OPTION_SUFFIX };
  }
  return { disabled: false };
}

export function brandedCheckboxState(ctx: {
  audited: boolean;
  privacyLevel: string | undefined;
}): { disabled: boolean; suffix?: string; helper?: string } {
  if (!ctx.audited) return { disabled: true, suffix: UNAUDITED_OPTION_SUFFIX };
  if (ctx.privacyLevel === 'SELF_ONLY') return { disabled: true, helper: BRANDED_PRIVATE_HELPER };
  return { disabled: false };
}
```

Note the order: `mediaError` is checked before `media === undefined`, so a failed query never reads as "loading". The test table encodes this with `{ media: undefined, mediaError: true }`.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/tiktokComposerRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/tiktokComposerRules.ts apps/crm/src/pages/entregas/__tests__/tiktokComposerRules.test.ts
git commit -m "feat(tiktok): pure composer rules for audit compliance"
```

---

### Task 9: `TikTokPostingDeclaration` (A3)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/TikTokPostingDeclaration.tsx`
- Create: `apps/crm/src/pages/entregas/components/__tests__/TikTokPostingDeclaration.test.tsx`

**Interfaces, produced:**

```ts
export const MUSIC_USAGE_CONFIRMATION_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';
export function TikTokPostingDeclaration(props: { brandedContent: boolean | undefined; className?: string }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BRANDED_CONTENT_POLICY_URL,
  MUSIC_USAGE_CONFIRMATION_URL,
  TikTokPostingDeclaration,
} from '../TikTokPostingDeclaration';

describe('TikTokPostingDeclaration', () => {
  it('without branded content links only the music confirmation', () => {
    const { container } = render(<TikTokPostingDeclaration brandedContent={false} />);
    expect(container.textContent).toBe(
      'Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok.',
    );
    expect(screen.getByRole('link', { name: 'Confirmação de Uso de Música' })).toHaveAttribute(
      'href',
      MUSIC_USAGE_CONFIRMATION_URL,
    );
    expect(screen.queryByRole('link', { name: 'Política de Conteúdo de Marca' })).toBeNull();
  });

  it.each([true, undefined])('branded (%s) links both policies', (branded) => {
    const { container } = render(<TikTokPostingDeclaration brandedContent={branded} />);
    expect(container.textContent).toBe(
      'Ao publicar, você concorda com a Política de Conteúdo de Marca e a Confirmação de Uso de Música do TikTok.',
    );
    expect(screen.getByRole('link', { name: 'Política de Conteúdo de Marca' })).toHaveAttribute(
      'href',
      BRANDED_CONTENT_POLICY_URL,
    );
  });

  it('links open in a new tab safely', () => {
    render(<TikTokPostingDeclaration brandedContent={false} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TikTokPostingDeclaration.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { Music2 } from 'lucide-react';

// Spec 2026-10-08-tiktok-audit-readiness A3. Rendered directly above every control that sends
// a TikTok post. `brandedContent === undefined` (caller has no settings) renders the branded
// variant: over-disclosing is compliant, under-disclosing is not.

export const MUSIC_USAGE_CONFIRMATION_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

function PolicyLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: 'var(--text-main)' }}
    >
      {children}
    </a>
  );
}

export function TikTokPostingDeclaration({
  brandedContent,
  className,
}: {
  brandedContent: boolean | undefined;
  className?: string;
}) {
  const branded = brandedContent !== false;
  return (
    <p
      className={`text-xs flex items-start gap-1.5 ${className ?? ''}`}
      style={{ color: 'var(--text-muted)' }}
      data-testid="tiktok-posting-declaration"
    >
      <Music2 aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <span>
        Ao publicar, você concorda com a{' '}
        {branded && (
          <>
            <PolicyLink href={BRANDED_CONTENT_POLICY_URL}>Política de Conteúdo de Marca</PolicyLink>{' '}
            e a{' '}
          </>
        )}
        <PolicyLink href={MUSIC_USAGE_CONFIRMATION_URL}>Confirmação de Uso de Música</PolicyLink> do
        TikTok.
      </span>
    </p>
  );
}
```

`container.textContent` excludes the svg. If the test shows doubled spaces, adjust the `{' '}` placement until the exact strings match. Don't loosen the test.

- [ ] **Step 4: Run and confirm it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/TikTokPostingDeclaration.tsx apps/crm/src/pages/entregas/components/__tests__/TikTokPostingDeclaration.test.tsx
git commit -m "feat(tiktok): posting declaration component"
```

---

### Task 10: Rebuild `TikTokSettingsPanel` on the rules (A0, A1, A2, A4-A7)

**Files:**
- Modify: `apps/crm/src/services/tiktok.ts`. `TikTokCreatorInfo` gains `can_post?: boolean; cannot_post_reason?: string; app_audited?: boolean;`.
- Modify: `apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx`:
  - the postMedia query (lines 228-233)
  - the state at lines 242-254
  - the `tiktokSettingsPanel` factory (lines 481-490)
  - the ScheduleButton props (lines 842-852)
- Modify: `apps/crm/src/pages/entregas/components/DestinationCaptionTabs.tsx`, only if its `tiktokSettings` prop typing needs it (it takes a ReactNode, so likely no change)
- Test: `apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx` (update props/expectations)

**Interfaces, consumed:**
- the Task 8 rules and constants
- `MUSIC_USAGE_CONFIRMATION_URL` is no longer used by the panel

**Interfaces, produced (new panel props):**

```ts
export interface TikTokSettingsPanelProps {
  clientId: number;
  post: Pick<WorkflowPost, 'id' | 'tipo' | 'tiktok_settings' | 'tiktok_caption' | 'tiktok_title' | 'ig_caption'>;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  onReadinessChange?: (readiness: TikTokReadiness) => void;   // replaces onCompletenessChange
  media: PostMedia[] | undefined;                              // undefined = loading
  mediaError?: boolean;
  showTestModeBanner?: boolean;                                // still OR-ed with !app_audited (422 fallback)
  hideCaption?: boolean;
}
```

`PostEditorBody` holds `const [tiktokReadiness, setTiktokReadiness] = useState<TikTokReadiness>({ complete: false })`. It passes `tiktokSettingsComplete={tiktokReadiness.complete}` and `tiktokIncompleteReason={tiktokReadiness.reason}` to `ScheduleButton`; Task 11 adds that prop.

**Implementation and test order:** do the steps below in order. Each one is a red-green cycle on `TikTokSettingsPanel.test.tsx`.

**How the existing test file works** (`TikTokSettingsPanel.test.tsx`), so every edit below fits it:
- `getTikTokCreatorInfoMock` is a `vi.hoisted` mock (`:9-13`); the service module is NOT imported, so `vi.mocked(getTikTokCreatorInfo)` does not exist here.
- Radix `Select*` are mocked as plain elements (`:18-62`): `SelectTrigger` is a `<button>`, `SelectItem` is a `<button onClick={() => onValueChange(value)}>` that **drops `disabled`**. There is no `combobox` or `option` role.
- `Checkbox` and `Switch` are mocked as native `<input type="checkbox">` with `role="checkbox"` / `role="switch"` and a real `disabled` prop (`:66-110`). They have no `aria-checked`; assert with `toBeChecked()`.
- The file uses `fireEvent` (not `userEvent`) and imports `act, cleanup, fireEvent, render, screen, waitFor` (`:2`); `within` is not imported.
- `basePost` (`:117-126`) is a `Pick` without `ig_caption`; `renderPanel(postOverrides, propOverrides)` (`:135-151`) passes `onCompletenessChange`.

**Step 0, before any new test: adapt the file's scaffolding.**

1. Imports: add `within` to the `@testing-library/react` import; add `import type { PostMedia } from '../../../../store/posts';` and `import type { TikTokCreatorInfo } from '../../../../services/tiktok';` (type-only, so the `vi.mock` of that module is unaffected).
2. Extend the `SelectTrigger`/`SelectItem` mocks so disabled items are observable:

   ```tsx
   function SelectTrigger({ children }: { children: React.ReactNode }) {
     return <button type="button" role="combobox">{children}</button>;
   }
   function SelectItem({ value, children, disabled }: { value: string; children: React.ReactNode; disabled?: boolean }) {
     const { onValueChange } = ReactModule.useContext(SelectContext);
     return (
       <button type="button" role="option" disabled={disabled} data-disabled={disabled ? '' : undefined} onClick={() => onValueChange?.(value)}>
         {children}
       </button>
     );
   }
   ```

3. `basePost`: add `'ig_caption'` to its `Pick` and `ig_caption: null,` to the object (the panel's `post` prop gains `ig_caption` in Step 5).
4. Add, right after `defaultCreatorInfo`:

   ```tsx
   const video42 = [
     { id: 1, kind: 'video', duration_seconds: 42, media_lost_at: null, thumbnail_url: null, url: 'u', is_cover: true, sort_order: 0 },
   ] as unknown as PostMedia[];

   type PanelProps = React.ComponentProps<typeof TikTokSettingsPanel>;

   function reelsPost(overrides: Partial<WorkflowPost> = {}): WorkflowPost {
     return { ...basePost, ...overrides } as WorkflowPost;
   }
   function panelElement(props: Partial<PanelProps> & { post: WorkflowPost }) {
     return <TikTokSettingsPanel clientId={7} onFieldChange={vi.fn()} media={video42} {...props} />;
   }
   function renderPanelProps(props: Partial<PanelProps> & { post: WorkflowPost }) {
     return render(panelElement(props));
   }
   function mockCreatorInfo(info: Partial<TikTokCreatorInfo>) {
     getTikTokCreatorInfoMock.mockResolvedValue(info);
   }
   /** The Select mock renders each option as a button; clicking it fires onValueChange. */
   async function selectPrivacy(label: string) {
     fireEvent.click(await screen.findByRole('option', { name: label }));
   }
   ```

5. Rewrite the existing `renderPanel` so the ~30 old call sites keep working against the new props:

   ```tsx
   function renderPanel(
     postOverrides: Partial<typeof basePost> = {},
     propOverrides: Partial<PanelProps> = {},
   ) {
     const onFieldChange = vi.fn();
     const onReadinessChange = vi.fn();
     const utils = render(
       <TikTokSettingsPanel
         clientId={7}
         post={{ ...basePost, ...postOverrides } as WorkflowPost}
         onFieldChange={onFieldChange}
         onReadinessChange={onReadinessChange}
         media={video42}
         {...propOverrides}
       />,
     );
     return { ...utils, onFieldChange, onReadinessChange };
   }
   ```

6. Existing tests that change meaning under the new UI (each named so nothing is guessed):
   - `:362-371` "toggling brand_content persists brand_content_toggle=true": the switch labelled `'Conteúdo de marca — parceria paga'` no longer exists. Replace with the Step 4 disclosure tests (delete this one).
   - `:373-388` "links to the official Music Usage Confirmation page" and "switches to the branded-content music confirmation copy": **delete** (the block moves to `TikTokPostingDeclaration`, Task 9).
   - `:389-411` "reports incomplete until privacy is chosen AND the music confirmation is ticked" and "reports incomplete again if the music confirmation is unticked": **delete**; the Step 2 readiness tests replace them.
   - `:419-426` "shows the test-mode banner when the parent sets showTestModeBanner": change the expected text to `'App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.'`.
   - `:350-360` ("Parceria paga" note shown/hidden) keep passing as written: with `brand_content_toggle: true` the disclosure master initialises on and the label prompt renders `<strong>Parceria paga</strong>`; with it off, nothing renders that text.
   - `:413` "does not show the test-mode banner by default" keeps passing: `defaultCreatorInfo` has no `app_audited`, which the panel treats as audited.
   - Every other existing test (privacy no default, interactions locked per creator, no-store fetch per mount, caption/title caps and debounce, `hideCaption`, stories renders nothing) must keep passing unchanged.

- [ ] **Step 1: Extend `TikTokCreatorInfo`**

In `services/tiktok.ts`, add `can_post?: boolean; cannot_post_reason?: string; app_audited?: boolean;` to the interface. No behaviour change.

- [ ] **Step 2: Readiness contract tests (red)**

Apply Step 0 above, then add to `TikTokSettingsPanel.test.tsx`:

```tsx
describe('readiness contract (spec A0)', () => {
  it('reports readiness with a reason, and completes once privacy is chosen', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'], can_post: true, app_audited: false, max_video_post_duration_sec: 600 });
    const onReadinessChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }), onReadinessChange });
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: false, reason: 'Escolha a privacidade do post no TikTok.' }),
    );
    await selectPrivacy('Somente eu (privado)');
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: true }));
  });

  it('reports the creator-info loading reason first', async () => {
    const onReadinessChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }), onReadinessChange });
    expect(onReadinessChange).toHaveBeenCalledWith({ complete: false, reason: 'Carregando informações do criador no TikTok…' });
    await screen.findByText('Dra Marina');
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: true }));
  });

  it('a creator-info failure blocks with its message', async () => {
    getTikTokCreatorInfoMock.mockRejectedValue(new Error('Erro X'));
    const onReadinessChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }), onReadinessChange });
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: false, reason: 'Erro X' }));
  });

  it('media undefined reports loading; mediaError reports the error', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const onReadinessChange = vi.fn();
    const post = reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } });
    const { rerender } = renderPanelProps({ post, media: undefined, onReadinessChange });
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: false, reason: 'Carregando mídias do post…' }),
    );
    rerender(panelElement({ post, media: undefined, mediaError: true, onReadinessChange }));
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: false, reason: 'Não foi possível carregar as mídias. Reabra o post.' }),
    );
  });
});
```

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx`. Expected: the four new tests FAIL (the prop does not exist yet); the deleted tests are gone; the rest still pass.

- [ ] **Step 3: Implement the readiness wiring (green)**

In `TikTokSettingsPanel.tsx`:
- Replace the module-level "Completeness contract" comment. It now says the panel reports `computeTikTokReadiness` (spec A0) through `onReadinessChange`, and that there is no ephemeral state any more.
- Delete the `musicConfirmed` state, its checkbox block, `isBrandedContent`, the `Music2` import and `MUSIC_USAGE_CONFIRMATION_URL`.
- Add the `media`, `mediaError` and `onReadinessChange` props, and remove `onCompletenessChange`.
- Add a local `const [disclosureOn, setDisclosureOn] = useState(() => !!(post.tiktok_settings?.brand_organic_toggle || post.tiktok_settings?.brand_content_toggle));`.
- Compute:

  ```tsx
  const readiness = computeTikTokReadiness({
    loading,
    loadError,
    creator: creatorInfo,
    tipo: post.tipo,
    privacyLevel: draft.privacy_level,
    disclosureOn,
    brandOrganic: draft.brand_organic_toggle,
    brandContent: draft.brand_content_toggle,
    media: media?.map((m) => ({ kind: m.kind, duration_seconds: m.duration_seconds, media_lost_at: m.media_lost_at ?? null })),
    mediaError: !!mediaError,
  });
  const readinessKey = `${readiness.complete}|${readiness.reason ?? ''}`;
  useEffect(() => {
    onReadinessChange?.(readiness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readinessKey]);
  ```

  This must sit before the `if (post.tipo === 'stories') return null;` early return, so the hook order stays stable.

Run the test file. Expected: the four Step 2 tests PASS and every remaining old test still passes.

- [ ] **Step 4: Disclosure UI tests (red), then the implementation (green)**

Tests (`fireEvent`, native-input mocks; see Step 0):

```tsx
describe('commercial content disclosure (spec A1/A2/A7)', () => {
  it('master off by default; on reveals two checkboxes; nothing checked warns', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], app_audited: true });
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }) });
    const master = await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' });
    expect(master).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Sua marca/ })).toBeNull();
    fireEvent.click(master);
    expect(screen.getByRole('checkbox', { name: /Sua marca/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeInTheDocument();
    expect(screen.getByText('Indique se o conteúdo promove você, um terceiro ou ambos.')).toBeInTheDocument();
  });

  it('"Sua marca" shows Conteúdo promocional; adding branded shows Parceria paga and persists both', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }), onFieldChange });
    fireEvent.click(await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sua marca/ }));
    expect(screen.getByText(/Seu post será rotulado como/)).toHaveTextContent('Seu post será rotulado como Conteúdo promocional.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Conteúdo de marca/ }));
    expect(screen.getByText(/Seu post será rotulado como/)).toHaveTextContent('Seu post será rotulado como Parceria paga.');
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_organic_toggle: true, brand_content_toggle: true }),
    );
  });

  it('turning the master on persists nothing until a checkbox is ticked', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }), onFieldChange });
    fireEvent.click(await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }));
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('turning the master off persists both toggles false', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE', brand_organic_toggle: true } }),
      onFieldChange,
    });
    const master = await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' });
    expect(master).toBeChecked();
    fireEvent.click(master);
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_organic_toggle: false, brand_content_toggle: false }),
    );
    expect(screen.queryByRole('checkbox', { name: /Sua marca/ })).toBeNull();
  });

  it('unaudited: branded disabled with suffix; non-SELF_ONLY options disabled; banner always shown', async () => {
    mockCreatorInfo({ privacy_level_options: ['FOLLOWER_OF_CREATOR', 'SELF_ONLY'], app_audited: false });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(
      await screen.findByText('App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Divulgação de conteúdo comercial' }));
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeDisabled();
    expect(screen.getByTestId('tt-branded-suffix')).toHaveTextContent('(disponível após a aprovação do app)');
    expect(screen.getByRole('option', { name: /Seguidores/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Seguidores/ })).toHaveTextContent('(disponível após a aprovação do app)');
    expect(screen.getByRole('option', { name: 'Somente eu (privado)' })).toBeEnabled();
  });

  it('audited: SELF_ONLY chosen disables branded with the helper line', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], app_audited: true });
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }) });
    fireEvent.click(await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }));
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeDisabled();
    expect(screen.getByText('Conteúdo de marca não pode ter visibilidade privada.')).toBeInTheDocument();
    expect(screen.queryByTestId('tt-branded-suffix')).toBeNull();
  });

  it('audited: branded checked disables the SELF_ONLY option with its suffix', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], app_audited: true });
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE', brand_content_toggle: true } }),
    });
    const selfOnly = await screen.findByRole('option', { name: /Somente eu/ });
    expect(selfOnly).toBeDisabled();
    expect(selfOnly).toHaveTextContent('(não disponível para conteúdo de marca)');
    expect(screen.getByRole('option', { name: 'Todos' })).toBeEnabled();
  });

  it('legacy branded + SELF_ONLY row shows the inline error and keeps branded uncheckable', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY', brand_content_toggle: true } }),
      onFieldChange,
    });
    expect(await screen.findByText('A visibilidade de conteúdo de marca não pode ser privada.')).toBeInTheDocument();
    const branded = screen.getByRole('checkbox', { name: /Conteúdo de marca/ });
    expect(branded).toBeEnabled();
    fireEvent.click(branded);
    expect(onFieldChange).toHaveBeenLastCalledWith('tiktok_settings', expect.objectContaining({ brand_content_toggle: false }));
  });
});
```

Accessible names come from the `<Label htmlFor>` association (the mocks drop `aria-label`); the "Conteúdo de marca" label also contains the suffix span, so its name is matched with a regex.

Implementation, replacing the "Commercial content" block:

```tsx
      {/* Commercial content disclosure (spec A1/A2) */}
      <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`tt-disclosure-${post.id}`}>Divulgação de conteúdo comercial</Label>
          <Switch
            id={`tt-disclosure-${post.id}`}
            aria-label="Divulgação de conteúdo comercial"
            checked={disclosureOn}
            onCheckedChange={(checked) => {
              setDisclosureOn(checked === true);
              if (checked !== true) persist({ brand_organic_toggle: false, brand_content_toggle: false });
            }}
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Indique se este conteúdo promove você, uma marca, um produto ou um serviço.
        </p>
        {disclosureOn && (
          <>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`tt-brand-organic-${post.id}`}
                checked={draft.brand_organic_toggle}
                onCheckedChange={(c) => persist({ brand_organic_toggle: c === true })}
              />
              <div className="flex flex-col">
                <Label htmlFor={`tt-brand-organic-${post.id}`}>Sua marca</Label>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Você está promovendo a si mesmo ou o seu negócio.
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`tt-brand-content-${post.id}`}
                checked={draft.brand_content_toggle}
                disabled={brandedState.disabled && !draft.brand_content_toggle}
                onCheckedChange={(c) => persist({ brand_content_toggle: c === true })}
              />
              <div className="flex flex-col">
                <Label htmlFor={`tt-brand-content-${post.id}`}>
                  Conteúdo de marca{' '}
                  {brandedState.suffix && (
                    <span data-testid="tt-branded-suffix" className="text-xs" style={{ color: 'var(--text-light)' }}>
                      {brandedState.suffix}
                    </span>
                  )}
                </Label>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {brandedState.helper ?? 'Você está promovendo outra marca ou um terceiro.'}
                </span>
              </div>
            </div>
            {label ? (
              <p className="text-xs rounded-md px-2 py-1.5" style={{ background: 'var(--surface-hover)' }}>
                Seu post será rotulado como <strong>{label}</strong>.
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--warning)' }}>
                {DISCLOSURE_INCOMPLETE_MSG}
              </p>
            )}
          </>
        )}
        {draft.brand_content_toggle && draft.privacy_level === 'SELF_ONLY' && (
          <p className="text-xs" style={{ color: 'var(--danger-text)' }}>{TIKTOK_MSG.brandedPrivate}</p>
        )}
      </div>
```

with, before `return`:

```tsx
  const audited = isAppAudited(creatorInfo);
  const brandedState = brandedCheckboxState({ audited, privacyLevel: draft.privacy_level });
  const label = disclosureLabel(draft.brand_organic_toggle, draft.brand_content_toggle);
```

Note `disabled={brandedState.disabled && !draft.brand_content_toggle}`: a legacy row that already has branded checked can still be unchecked, so the conflict can be cleared.

Privacy select items:

```tsx
            {(creatorInfo?.privacy_level_options ?? []).map((opt) => {
              const st = privacyOptionState(opt, { audited, brandContent: draft.brand_content_toggle });
              return (
                <SelectItem key={opt} value={opt} disabled={st.disabled}>
                  {PRIVACY_LABELS[opt] ?? opt}
                  {st.suffix ? ` ${st.suffix}` : ''}
                </SelectItem>
              );
            })}
```

Test-mode banner: render it when `showTestModeBanner || (creatorInfo != null && !audited)`, with the text `App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.`

Run the test file. Expected: PASS.

- [ ] **Step 5: Notices, preview and duration, tests (red) then implementation (green)**

Tests:

```tsx
describe('notices, preview and duration (spec A4/A5/A6/A7)', () => {
  it('can_post false replaces the nickname header with the pt-BR notice', async () => {
    mockCreatorInfo({ can_post: false, cannot_post_reason: 'spam_risk_too_many_posts', app_audited: false });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.',
    );
    expect(screen.queryByTestId('tiktok-creator-avatar')).toBeNull();
  });

  it('can_post false with an unknown reason uses the fallback sentence', async () => {
    mockCreatorInfo({ can_post: false, cannot_post_reason: 'something_new' });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O TikTok não permite novas publicações nesta conta agora. Tente novamente mais tarde.',
    );
  });

  it('public account in test mode shows the blocking warning', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], app_audited: false });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.',
    );
  });

  it('preview shows the duration badge and the caption that will be sent', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    renderPanelProps({ post: reelsPost({ tiktok_caption: 'Legenda do TikTok', tiktok_settings: {} }) });
    const preview = await screen.findByRole('region', { name: 'Prévia' });
    expect(within(preview).getByText('0:42')).toBeInTheDocument();
    expect(within(preview).getByText('Legenda do TikTok')).toBeInTheDocument();
  });

  it('preview falls back to ig_caption and shows +N beyond five thumbnails', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...video42[0], id: i + 1, kind: 'image', duration_seconds: null, url: `https://cdn.example/${i}.jpg`,
    })) as unknown as PostMedia[];
    renderPanelProps({ post: reelsPost({ tipo: 'carrossel', tiktok_caption: null, ig_caption: 'Legenda do IG', tiktok_settings: {} }), media: seven });
    const preview = await screen.findByRole('region', { name: 'Prévia' });
    expect(preview.querySelectorAll('img')).toHaveLength(5);
    expect(within(preview).getByText('+2')).toBeInTheDocument();
    expect(within(preview).getByText('Legenda do IG')).toBeInTheDocument();
  });

  it('preview: empty media and lost media messages', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const post = reelsPost({ tiktok_settings: {} });
    const { rerender } = renderPanelProps({ post, media: [] });
    expect(await screen.findByText('Adicione mídia ao post para publicar no TikTok.')).toBeInTheDocument();
    rerender(panelElement({ post, media: [{ ...video42[0], media_lost_at: '2026-08-14' }] as unknown as PostMedia[] }));
    expect(await screen.findByText('Uma das mídias deste post foi perdida. Substitua-a antes de publicar.')).toBeInTheDocument();
  });

  it('video over the creator limit shows the duration error', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }), media: [{ ...video42[0], duration_seconds: 750 }] as unknown as PostMedia[] });
    expect(await screen.findByText('Este vídeo tem 750s. O máximo permitido para esta conta é 600s.')).toBeInTheDocument();
    expect(screen.getByText('Duração máxima de vídeo nesta conta: 600s')).toBeInTheDocument();
  });
});
```

Implementation:
- **Header.** When `cannotPostMessage(creatorInfo)` is non-null, render `<p role="alert" …>{message}</p>` instead of the avatar and nickname row. Use colors `var(--danger-text)` on `rgba(245, 90, 66, 0.08)`, matching the existing warning style in `ScheduleButton`. Otherwise keep the header, changing the nickname line to `Publicando como @{creator_nickname}` when the nickname exists.
- **Public account in test mode.** When `isPublicAccountInTestMode(creatorInfo)`, render `<p role="alert">{TIKTOK_MSG.publicAccountInTestMode}</p>` under the banner.
- **Preview.** Add a `<section aria-label="Prévia">` block under the header:

  ```tsx
  <section aria-label="Prévia" className="flex flex-col gap-1.5">
    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Prévia</span>
    {media === undefined ? null : media.length === 0 ? (
      <p className="text-xs" style={{ color: 'var(--text-light)' }}>{TIKTOK_MSG.mediaMissing}</p>
    ) : (
      <div className="flex gap-2 items-start">
        <div className="flex gap-1.5">
          {media.slice(0, 5).map((m) => (
            <div key={m.id} className="relative h-28 w-16 overflow-hidden rounded-md flex-shrink-0" style={{ background: 'var(--surface-3)' }}>
              {(m.thumbnail_url || (m.kind === 'image' && m.url)) && !m.media_lost_at && (
                <img src={sanitizeUrl(m.thumbnail_url ?? m.url!)} alt="" className="h-full w-full object-cover" />
              )}
              {m.kind === 'video' && m.duration_seconds != null && (
                <span className="absolute bottom-1 right-1 rounded px-1 text-[10px] font-semibold" style={{ background: 'var(--dark)', color: '#fff' }}>
                  {formatDuration(m.duration_seconds)}
                </span>
              )}
            </div>
          ))}
          {media.length > 5 && (
            <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>+{media.length - 5}</span>
          )}
        </div>
        <p className="text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {post.tiktok_caption ?? post.ig_caption ?? ''}
        </p>
      </div>
    )}
    {media?.some((m) => m.media_lost_at) && (
      <p className="text-xs" style={{ color: 'var(--danger-text)' }}>{TIKTOK_MSG.mediaLost}</p>
    )}
    {durationError && (
      <p className="text-xs" style={{ color: 'var(--danger-text)' }}>{durationError}</p>
    )}
  </section>
  ```

  - `formatDuration(s)` returns `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; define it at module level.
  - `durationError` is the readiness `reason` when the duration rule fired. Compute it as `isVideoTipo && maxDur != null && longest != null && longest > maxDur ? TIKTOK_MSG.durationExceeded(longest, maxDur) : null`, using `longestVideoSeconds`.
  - Add `ig_caption` to the props' `post` `Pick`. `PostEditorBody` already passes the full post.
- **Duration line.** Rename the existing "Duração máxima de vídeo permitida" line to `Duração máxima de vídeo nesta conta: {n}s`.

Run the test file. Expected: PASS.

- [ ] **Step 6: Wire `PostEditorBody`**

```tsx
  const { data: postMedia, isError: postMediaError } = useQuery({ /* unchanged */ });
  ...
  const [tiktokReadiness, setTiktokReadiness] = useState<TikTokReadiness>({ complete: false });
  ...
  useEffect(() => {
    if (!isExpanded) {
      setTiktokReadiness({ complete: false });
      setTiktokTestModeBanner(false);
    }
  }, [isExpanded]);
```

- Rewrite the comment above it: the panel reports readiness (spec A0), and it is reset on collapse so a reopen re-fetches creator_info.
- `tiktokSettingsPanel` factory: pass `media={postMedia}`, `mediaError={postMediaError}` and `onReadinessChange={setTiktokReadiness}`, replacing `onCompletenessChange`.
- `ScheduleButton`: `tiktokSettingsComplete={tiktokReadiness.complete}` and `tiktokIncompleteReason={tiktokReadiness.reason}`. Task 11 adds that prop. If this task lands first, add the prop to `ScheduleButtonProps` here as `tiktokIncompleteReason?: string`, unused until Task 11.
- Import `type TikTokReadiness` from `../tiktokComposerRules`.

Update `PostEditorBody.destinations.test.tsx` wherever it asserted `onCompletenessChange` or the music checkbox.

- [ ] **Step 7: Run the frontend checks for this area**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/services/tiktok.ts apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx apps/crm/src/pages/entregas/components/PostEditorBody.tsx apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx
git commit -m "feat(tiktok): audit-compliant composer panel (disclosure, preview, limits, test mode)"
```

---

### Task 11: `ScheduleButton`: declaration, reason, copy, colour, notices (A0, A3, A8, B3)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx`

**Interfaces, consumed:** `TikTokPostingDeclaration` (Task 9); the `tiktokIncompleteReason` prop, fed by `PostEditorBody` (Task 10).

**Interfaces, produced:**
- New prop: `tiktokIncompleteReason?: string`.
- `PublicacoesPanel` mounts with `tiktokSettingsComplete={false}` (`PublicacoesPanel.tsx:114`), so the gate is never open there and no declaration renders (spec A3). Its `title` assertion (`PublicacoesPanel.test.tsx:108`) keeps passing because `title` stays on the buttons (Step 3.9).

- [ ] **Step 1: Write the failing tests**

`ScheduleButton.test.tsx` has no `approvedPost`/`renderButton` helpers. It uses `makePost(overrides)` (default `status: 'aprovado_cliente'`, `tipo: 'feed'`, `scheduled_at` set, `ig_caption` set; `:45-59`), `defaultProps` (`:61-64`), direct `render(<ScheduleButton ... />)`, `fireEvent`, fake timers with `shouldAdvanceTime` (`:89-96`) and `act` + `vi.advanceTimersByTimeAsync` for the 600 ms post-publish delay (`:586-604`). `within` is not imported: add it to the `@testing-library/react` import on `:1`.

Add this `describe` block at the end of the top-level `describe('ScheduleButton')`:

```tsx
  describe('audit readiness (spec A0/A3/A8/B3)', () => {
    it('TikTok post: declaration renders above the actions once the gate is open', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok', tiktok_settings: { brand_content_toggle: false } })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      expect(screen.getByTestId('tiktok-posting-declaration')).toHaveTextContent(
        'Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok.',
      );
    });

    it('TikTok post without settings: branded variant of the declaration', () => {
      render(<ScheduleButton post={makePost({ platform: 'tiktok' })} {...defaultProps} tiktokSettingsComplete />);
      expect(screen.getByTestId('tiktok-posting-declaration')).toHaveTextContent('Política de Conteúdo de Marca');
    });

    it('TikTok post with incomplete settings: no declaration (nothing can send)', () => {
      render(<ScheduleButton post={makePost({ platform: 'tiktok' })} {...defaultProps} tiktokSettingsComplete={false} />);
      expect(screen.queryByTestId('tiktok-posting-declaration')).toBeNull();
    });

    it('Instagram-only post: no TikTok declaration', () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      expect(screen.queryByTestId('tiktok-posting-declaration')).toBeNull();
    });

    it('publish-now dialog repeats the declaration above Publicar for TikTok', async () => {
      render(<ScheduleButton post={makePost({ platform: 'tiktok' })} {...defaultProps} tiktokSettingsComplete />);
      fireEvent.click(screen.getByText('Publicar agora'));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByTestId('tiktok-posting-declaration')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Publicar' })).toBeInTheDocument();
    });

    it('shows the panel reason in the Falta line, lowercased and without its final period', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete={false}
          tiktokIncompleteReason="Indique se o conteúdo promove você, um terceiro ou ambos."
        />,
      );
      expect(screen.getByText(/Falta:/)).toHaveTextContent(
        'Falta: indique se o conteúdo promove você, um terceiro ou ambos',
      );
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.getAttribute('title')).toBe('Indique se o conteúdo promove você, um terceiro ou ambos.');
    });

    it('missing caption names the platform whose caption is empty', () => {
      render(
        <ScheduleButton post={makePost({ platform: 'tiktok', ig_caption: null })} {...defaultProps} tiktokSettingsComplete />,
      );
      expect(screen.getByText(/Falta:/)).toHaveTextContent('legenda do TikTok');
      cleanup();
      render(
        <ScheduleButton post={makePost({ platform: 'both', ig_caption: null })} {...defaultProps} tiktokSettingsComplete />,
      );
      expect(screen.getByText(/Falta:/)).toHaveTextContent('Falta: legenda');
      expect(screen.getByText(/Falta:/)).not.toHaveTextContent('legenda do');
    });

    it('TikTok post: row button, dialog confirm and progress bar use the ink style, never pink', async () => {
      let resolvePublish: (v: unknown) => void = () => {};
      vi.mocked(publishTikTokPostNow).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePublish = resolve;
        }) as never,
      );
      render(<ScheduleButton post={makePost({ platform: 'tiktok' })} {...defaultProps} tiktokSettingsComplete />);
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(publishBtn.style.background).toBe('var(--text-main)');
      expect(publishBtn.style.color).toBe('var(--bg-color)');

      fireEvent.click(publishBtn);
      const confirm = await screen.findByRole('button', { name: 'Publicar' });
      expect(confirm.style.background).toBe('var(--text-main)');

      await act(async () => {
        fireEvent.click(confirm);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      const pct = screen.getByText(/\d+%/);
      const bar = pct.closest('.px-1')!.querySelector('.h-full') as HTMLElement;
      expect(bar.style.background).toBe('var(--text-main)');

      await act(async () => {
        resolvePublish({ ok: true, status: 'postado' });
        await vi.advanceTimersByTimeAsync(1000);
      });
    });

    it('Instagram post keeps the pink publish button (unchanged)', () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(publishBtn.style.background).toBe('rgb(225, 48, 108)');
    });

    it('agendado "Publicando…" pill uses the ink style for a TikTok post', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado', platform: 'tiktok', scheduled_at: '2099-01-01T00:00:00Z', tiktok_publish_status: 'initiated' })}
          {...defaultProps}
        />,
      );
      const pill = screen.getByText('Publicando…').closest('div')!;
      expect(pill.style.background).toBe('var(--surface-hover)');
      expect(pill.style.color).toBe('var(--text-main)');
    });

    it('TikTok publish-now success toasts the processing notice for both postado and processing', async () => {
      for (const result of [{ ok: true, status: 'postado' }, { ok: true, status: 'agendado', message: 'x' }]) {
        vi.mocked(publishTikTokPostNow).mockResolvedValueOnce(result as never);
        render(<ScheduleButton post={makePost({ platform: 'tiktok' })} {...defaultProps} tiktokSettingsComplete />);
        fireEvent.click(screen.getByText('Publicar agora'));
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
          await vi.advanceTimersByTimeAsync(1000);
        });
        await waitFor(() =>
          expect(toast.success).toHaveBeenLastCalledWith('Enviado ao TikTok. Pode levar alguns minutos para aparecer no perfil.'),
        );
        expect(toast.info).not.toHaveBeenCalled();
        cleanup();
      }
    });

    it('status row shows the processing notice while TikTok processes', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado', platform: 'tiktok', tiktok_publish_status: 'processing' })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText('Processando no TikTok. Pode levar alguns minutos.')).toBeInTheDocument();
    });
  });
```

`cleanup` comes from `@testing-library/react` (add it to the `:1` import). jsdom keeps `var(...)` values verbatim on `style.background` and serialises `#E1306C` as `rgb(225, 48, 108)`, which is what the colour assertions rely on.

Existing tests whose expectations change (update each to the new string; nothing else in them moves):
- `:603` "platform tiktok calls publishTikTokPostNow, not instagram": `toast.success` is now called with `'Enviado ao TikTok. Pode levar alguns minutos para aparecer no perfil.'`.
- `:626` "platform tiktok shows info toast when TikTok is still processing": rename to "…shows the processing notice when TikTok is still processing" and assert `toast.success` with the same sentence instead of `toast.info('TikTok ainda processando.')`.
- `:654` "platform both calls publishInstagramPostNow THEN publishTikTokPostNow": `toast.success` with `'Enviado ao Instagram e ao TikTok. No TikTok, pode levar alguns minutos para aparecer no perfil.'`.
- `:881` "disables Agendar/Publicar for platform tiktok until tiktokSettingsComplete is true" keeps passing: `title` stays `'Complete as configurações do TikTok'` when no reason is passed.
- `:161` "shows missing items hint when caption is empty" is an Instagram post and still reads `legenda do Instagram`.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

1. Props: add `tiktokIncompleteReason?: string` with a doc comment ("first failing A0 rule's pt-BR sentence, shown in the Falta line").
2. Branded flag: `const tiktokBranded = post.tiktok_settings == null ? undefined : (post.tiktok_settings as { brand_content_toggle?: boolean }).brand_content_toggle === true;`
3. Missing items, replacing the two pushes:

   ```ts
       const captionLabel = targetsInstagram && targetsTikTok
         ? 'legenda'
         : targetsTikTok ? 'legenda do TikTok' : 'legenda do Instagram';
       if (!isStoryPost && !hasRequiredCaption) missingItems.push(captionLabel);
       if (targetsTikTok && !tiktokReady) {
         missingItems.push(
           tiktokIncompleteReason
             ? tiktokIncompleteReason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())
             : 'configurações do TikTok',
         );
       }
   ```

4. Colour (spec B3). The default `Button` variant is the yellow primary (`components/ui/button.tsx:11`), same family as "Agendar", so TikTok posts get an explicit inverted ink style:

   ```ts
   const publishColor = platform === 'instagram'
     ? { background: '#E1306C', color: 'white' }
     : { background: 'var(--text-main)', color: 'var(--bg-color)' };
   ```

   - Row button: `style={canPublishNow ? publishColor : undefined}`.
   - Dialog confirm button: `style={publishColor}`.
   - Progress bar: `background: publishPct < 100 ? (platform === 'instagram' ? '#E1306C' : 'var(--text-main)') : '#3ecf8e'`.
   - The `agendado` "Publicando…" pill (`:450-455`): `style={platform === 'instagram' ? { background: 'rgba(225, 48, 108, 0.12)', color: '#E1306C' } : { background: 'var(--surface-hover)', color: 'var(--text-main)' }}`.
   - "Agendar" keeps `#eab308`.
5. Declaration above the row: inside the `aprovado_cliente` branch, right before `<div className="flex flex-wrap items-center gap-2">`:

   ```tsx
           {targetsTikTok && tiktokReady && (
             <TikTokPostingDeclaration brandedContent={tiktokBranded} className="mb-2" />
           )}
   ```

6. Declaration in the dialog: inside `AlertDialogContent`, right before `{!publishing && (<AlertDialogFooter>`:

   ```tsx
             {!publishing && targetsTikTok && tiktokReady && (
               <TikTokPostingDeclaration brandedContent={tiktokBranded} />
             )}
   ```

7. Toasts, in the TikTok-only branch of `handlePublishNow`:

   ```ts
           toast.success('Enviado ao TikTok. Pode levar alguns minutos para aparecer no perfil.');
   ```

   Use this for both `postado` and the processing response. In the `both` branch's full success: `toast.success('Enviado ao Instagram e ao TikTok. No TikTok, pode levar alguns minutos para aparecer no perfil.');`.
8. In `PlatformStatusRow`, after the chips `div`:

   ```tsx
      {(post.tiktok_publish_status === 'initiated' || post.tiktok_publish_status === 'processing') && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Processando no TikTok. Pode levar alguns minutos.
        </p>
      )}
   ```

   `PlatformStatusRow` returns a single `div` today. Wrap the chips `div` and this `p` in a fragment.
9. Tooltip on the disabled buttons (spec A0: the reason is shown two ways). Compute `const tiktokBlockedTitle = targetsTikTok && !tiktokReady ? (tiktokIncompleteReason ?? tiktokIncompleteTooltip ?? 'Complete as configurações do TikTok') : undefined;` (replacing the existing expression at `:550-553`). **Keep** `title={tiktokBlockedTitle}` on both buttons (`:572`, `:582`; `ScheduleButton.test.tsx:881` and `PublicacoesPanel.test.tsx:108` assert it), and additionally wrap each button when `tiktokBlockedTitle` is set:

   ```tsx
   const withBlockedTooltip = (button: ReactElement) =>
     tiktokBlockedTitle ? (
       <TooltipProvider>
         <Tooltip>
           <TooltipTrigger asChild>
             <span tabIndex={0}>{button}</span>
           </TooltipTrigger>
           <TooltipContent>{tiktokBlockedTitle}</TooltipContent>
         </Tooltip>
       </TooltipProvider>
     ) : (
       button
     );
   ```

   and render `{withBlockedTooltip(<Button ...>Agendar…</Button>)}` / `{withBlockedTooltip(<Button ...>Publicar…</Button>)}`. `@/components/ui/tooltip` exports exactly `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` (`tooltip.tsx:27`); import `type ReactElement` from `react`.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx apps/crm/src/pages/entregas/components/__tests__/PublicacoesPanel.test.tsx`
Expected: PASS with no change to `PublicacoesPanel.test.tsx` (its TikTok post is gated closed, so no declaration renders, and `title` is kept). The Radix Tooltip wrapper renders fine in jsdom: `test/vitest.setup.ts:97` polyfills `ResizeObserver`, and `NotificationBell.test.tsx` already renders `Tooltip` from `@/components/ui/tooltip` without mocks.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ScheduleButton.tsx apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx apps/crm/src/pages/entregas/components/__tests__/PublicacoesPanel.test.tsx
git commit -m "feat(tiktok): declaration before every send, neutral TikTok button, processing notices"
```

---

### Task 12: Auto-schedule dialogs show the declaration (A3)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx`
- Modify: `apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx`
- Modify the caller that builds `AutoSchedulePromptPost` from a `WorkflowPost`: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (`maybeNudge`, `:207-214`). `PostsKanbanView.tsx` (`:686-691`, `:803-808`) builds it from `ActivePost` (`store/posts.ts:380`), which has no `tiktok_settings`; leave it as is, the branded fallback covers it.
- Tests: `apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx`, `apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx`

**Interfaces, consumed:** `TikTokPostingDeclaration` (Task 9), `targetsTikTokService(platform: string | null | undefined): boolean` (`autoScheduleNudge.ts:50`, already imported by `AutoScheduleBatchDialog.tsx:15`).

- [ ] **Step 1: Write the failing tests**

`AutoSchedulePromptDialog.test.tsx` renders the component directly with `post={{ id, titulo, platform, scheduled_at }}` and a `FUTURE` ISO constant (`:43`, `:64-70`). Append inside its `describe`:

```tsx
  it('TikTok post with settings: music-only declaration above Agendar', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'tiktok', scheduled_at: FUTURE, tiktok_settings: { brand_content_toggle: false } }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    const decl = screen.getByTestId('tiktok-posting-declaration');
    expect(decl).toHaveTextContent('Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok.');
    expect(decl).not.toHaveTextContent('Política de Conteúdo de Marca');
    // Declaration precedes the confirm button in DOM order (spec A3: above the control).
    const agendar = screen.getByRole('button', { name: /^Agendar$/ });
    expect(decl.compareDocumentPosition(agendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('TikTok post with branded settings: branded declaration', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'both', scheduled_at: FUTURE, tiktok_settings: { brand_content_toggle: true } }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tiktok-posting-declaration')).toHaveTextContent('Política de Conteúdo de Marca');
  });

  it('TikTok post without settings: branded variant (caller has no settings)', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'tiktok', scheduled_at: FUTURE }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tiktok-posting-declaration')).toHaveTextContent('Política de Conteúdo de Marca');
  });

  it('Instagram post: no declaration', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('tiktok-posting-declaration')).toBeNull();
  });
```

`AutoScheduleBatchDialog.test.tsx` wraps in a `QueryClientProvider` via `wrap(...)` (`:30-33`), feeds posts through `getWorkflowPosts.mockResolvedValue([...])` with `status: 'aprovado_cliente'` and `scheduled_at: future(n)` (`:26`, `:97-112`). Append inside its `describe`:

```tsx
  const batchDialog = () => (
    <AutoScheduleBatchDialog
      workflowId={7}
      tiktokFeatureEnabled
      isFinalApprovalCycle
      onClose={vi.fn()}
      onScheduled={vi.fn()}
    />
  );

  it('mixed batch with one branded TikTok post: branded declaration', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
        tiktok_settings: { brand_content_toggle: false, privacy_level: 'SELF_ONLY' },
      },
      {
        id: 3,
        titulo: 'C',
        status: 'aprovado_cliente',
        platform: 'both',
        scheduled_at: future(5),
        tiktok_settings: { brand_content_toggle: true, privacy_level: 'PUBLIC_TO_EVERYONE' },
      },
    ]);
    wrap(batchDialog());
    expect(await screen.findByTestId('tiktok-posting-declaration')).toHaveTextContent('Política de Conteúdo de Marca');
  });

  it('batch whose TikTok posts are all non-branded: music-only declaration', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
        tiktok_settings: { brand_content_toggle: false },
      },
    ]);
    wrap(batchDialog());
    const decl = await screen.findByTestId('tiktok-posting-declaration');
    expect(decl).toHaveTextContent('Confirmação de Uso de Música');
    expect(decl).not.toHaveTextContent('Política de Conteúdo de Marca');
  });

  it('TikTok post with no settings in the batch: branded declaration', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'tiktok', scheduled_at: future(4) },
    ]);
    wrap(batchDialog());
    expect(await screen.findByTestId('tiktok-posting-declaration')).toHaveTextContent('Política de Conteúdo de Marca');
  });

  it('Instagram-only batch: no declaration', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
    ]);
    wrap(batchDialog());
    await screen.findByRole('button', { name: /Agendar 1 post/ });
    expect(screen.queryByTestId('tiktok-posting-declaration')).toBeNull();
  });

  it('TikTok posts blocked by the missing add-on do not trigger the declaration', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'tiktok', scheduled_at: future(4) },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled={false}
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: /Agendar 1 post/ });
    expect(screen.queryByTestId('tiktok-posting-declaration')).toBeNull();
  });
```

The last test pins the declaration to `eligible` (what the confirm button actually sends), not to every approved post: with the add-on off, TikTok posts land in `tiktokBlocked` (`AutoScheduleBatchDialog.tsx:111`) and are not sent.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`AutoSchedulePromptDialog.tsx`:
- Add `tiktok_settings?: WorkflowPost['tiktok_settings'];` to `AutoSchedulePromptPost`.
- Before `<AlertDialogFooter>`:

  ```tsx
          {targetsTikTokService(post.platform) && (
            <TikTokPostingDeclaration
              brandedContent={
                post.tiktok_settings == null
                  ? undefined
                  : (post.tiktok_settings as { brand_content_toggle?: boolean }).brand_content_toggle === true
              }
            />
          )}
  ```

- Import `targetsTikTokService` from `../autoScheduleNudge` (it takes the platform string, `autoScheduleNudge.ts:50`) and `TikTokPostingDeclaration` from `./TikTokPostingDeclaration`.

`AutoScheduleBatchDialog.tsx`, before `<AlertDialogFooter>`:

```tsx
        {(() => {
          const tiktokPosts = eligible.filter((p) => targetsTikTokService(p.platform));
          if (tiktokPosts.length === 0) return null;
          const branded = tiktokPosts.some(
            (p) => p.tiktok_settings == null ||
              (p.tiktok_settings as { brand_content_toggle?: boolean }).brand_content_toggle === true,
          );
          return <TikTokPostingDeclaration brandedContent={branded} className="mb-2" />;
        })()}
```

`eligible` (`AutoScheduleBatchDialog.tsx:105`) is the list the confirm button schedules (`:126`); `tiktokBlocked` posts are excluded on purpose, see the last test. Import `TikTokPostingDeclaration` from `./TikTokPostingDeclaration`.

Caller: in `WorkflowDrawer.tsx` `maybeNudge` (`:207-214`), add `tiktok_settings: updated.tiktok_settings,` after `scheduled_at`. `PostsKanbanView.tsx` is not changed (see Files).

- [ ] **Step 4: Run and confirm it passes**

Same command, plus `npx vitest run apps/crm/src/pages/entregas`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx
git commit -m "feat(tiktok): posting declaration in the auto-schedule dialogs"
```

---

### Task 13: Connect landing, toast, capture, auth URL errors (B1 client side, B2)

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheIndexRedirect.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/RedesSociaisTab.tsx` (effect at lines 72-97)
- Modify: `apps/crm/src/services/tiktok.ts` (`getTikTokAuthUrl`, `:114-125`)
- Modify: `apps/crm/src/lib/analytics.ts` (`AnalyticsEvent` closed union, `:9`): add `| 'tiktok_connected'` right after `| 'instagram_connected'` (`:17`), with the comment `// TikTok activation milestone: fired once by RedesSociaisTab when the OAuth callback lands with tt_connected=1.`
- Modify: `packages/i18n/locales/pt/clients.json` and `packages/i18n/locales/en/clients.json` (`detail.ttConnected`)
- Tests: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx` (redirect, `:200-210`), `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/RedesSociaisTab.test.tsx`, `apps/crm/src/services/__tests__/tiktok.test.ts`

- [ ] **Step 1: Write the failing tests**

Redirect (`ClienteDetalhePage.test.tsx:200`): add `'tt_connected'` to the existing `it.each` list so it reads `it.each(['ig_connected', 'ig_error', 'tt_error', 'tt_connected'])`. Nothing else changes there.

`RedesSociaisTab.test.tsx` already mocks `@/lib/analytics` as `captureEventMock` (`:16-17`) and `sonner` with `{ info, error }` only (`:40-44`). Extend the sonner mock:

```tsx
const { toastInfoMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { info: toastInfoMock, error: toastErrorMock, success: toastSuccessMock },
}));
```

and add to the `'OAuth callback processing'` describe (it renders with `renderTab(path)` and reads the URL through `screen.getByTestId('search')`; i18n is real in this suite, the existing `tt_error` test asserts the resolved pt string):

```tsx
    it('tt_connected=1: toasts success, captures tiktok_connected once and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      getTikTokSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tt_connected=1&tab=redes');

      await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Conta do TikTok conectada.'));
      expect(captureEventMock).toHaveBeenCalledWith('tiktok_connected', { cliente_id: 42 });
      expect(captureEventMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?tab=redes'));
    });

    it('tt_connected with any other value: no toast, no event, param still stripped', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tt_connected=0');

      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(captureEventMock).not.toHaveBeenCalled();
    });
```

Also extend the `'does not process anything on an ordinary visit'` test (`:247-256`) with `expect(toastSuccessMock).not.toHaveBeenCalled();`.

`services/__tests__/tiktok.test.ts` has `jsonResponse(body, { status, ok })` and `invalidJsonResponse()` helpers (`:26-41`). Add after the existing auth-url error tests (`:139-152`):

```ts
  it('getTikTokAuthUrl: feature_disabled maps to the plan message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'feature_disabled' }, { status: 403, ok: false }),
    );
    await expect(getTikTokAuthUrl(7)).rejects.toThrow('O TikTok não está disponível no seu plano.');
  });

  it('getTikTokAuthUrl: { error: true, message } surfaces the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: true, message: 'Falha X' }, { status: 500, ok: false }),
    );
    await expect(getTikTokAuthUrl(7)).rejects.toThrow('Falha X');
  });

  // Spec B2: "otherwise it uses typeof data.error === 'string' ? data.error : data.message".
  it('getTikTokAuthUrl: a string error code other than feature_disabled is surfaced as the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'client_not_found' }, { status: 404, ok: false }),
    );
    await expect(getTikTokAuthUrl(7)).rejects.toThrow('client_not_found');
  });
```

Existing test whose expectation changes: `:149-152` "falls back to a generic message when the error body is not valid JSON" now expects `'Erro ao gerar o link de conexão do TikTok.'` (the English `'Error generating auth url'` fallback is replaced). `:139-146` (`{ message }` body) keeps passing.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe apps/crm/src/services/__tests__/tiktok.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ClienteDetalheIndexRedirect.tsx`: the `hasOAuthCallback` condition (`:19-20`) adds `|| params.has('tt_connected')`. Add `tt_connected` to the doc comment's param list (`:5`).

`RedesSociaisTab.tsx`, inside the existing effect:

```ts
    const ttConnected = searchParams.get('tt_connected');
    if (!igConnected && !igError && !ttError && !ttConnected) return;
    ...
    if (ttConnected === '1') {
      toast.success(t('detail.ttConnected'));
      captureEvent('tiktok_connected', { cliente_id: clienteId });
    }
    ...
    next.delete('tt_connected');
```

- The effect's dependency array (`:97`) becomes `[searchParams, setSearchParams, t, clienteId]`.
- Import `captureEvent` from `@/lib/analytics` (the `'tiktok_connected'` member is added to `AnalyticsEvent` in this same task, see Files).
- Extend the module doc comment's param list with `tt_connected`.
- The server side of B1 (the `?tt_connected=1` redirect in `tiktok-integration/handlers.ts` `handleCallback`, today a bare `/clientes/{id}`) is Task 7 in the backend lane. This task is testable on its own because the tests drive the URL directly; the end-to-end connect flow only works once both lanes are merged (Execution order step 4).

i18n:
- pt `detail.ttConnected`: `"Conta do TikTok conectada."`
- en `detail.ttConnected`: `"TikTok account connected."`

`services/tiktok.ts`:

```ts
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error === 'feature_disabled') {
      throw new Error('O TikTok não está disponível no seu plano.');
    }
    const message = typeof data.error === 'string' ? data.error : data.message;
    throw new Error(message || 'Erro ao gerar o link de conexão do TikTok.');
  }
```

(`data` is the parsed body, typed `Record<string, unknown>`; narrow `data.message` with `typeof data.message === 'string' ? data.message : undefined` if tsc complains.)

- [ ] **Step 4: Run and confirm it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe apps/crm/src/lib/analytics.ts apps/crm/src/services/tiktok.ts apps/crm/src/services/__tests__/tiktok.test.ts packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json
git commit -m "fix(tiktok): connect lands on Redes sociais with a toast; clear auth-url errors"
```

---

### Task 14: Remove the "TikTok · Em breve" analytics nav item (B4)

**Files:**
- Modify: `apps/crm/src/components/layout/nav-data.ts:174-181` (the `analytics-tiktok` item) and the comment at `:250`
- Modify: `apps/crm/src/components/layout/__tests__/nav-data.test.ts` (comment `:125`, agent id list `:142`)
- Modify: `packages/i18n/locales/pt/common.json:22`, `packages/i18n/locales/en/common.json:22`: remove `nav.tiktok` (its only user is `nav-data.ts:178`; confirm with `grep -rn "nav.tiktok" apps packages --include=*.ts --include=*.tsx`). Keep `sidebar.comingSoon` and the generic disabled branch in `Sidebar.tsx` / `MobileNav.tsx`.

- [ ] **Step 1: Update the test first**

In `nav-data.test.ts`:
- Delete the `'analytics-tiktok',` line from the agent id list (`:142`) in "shows exactly the agent-visible id set, in declaration order".
- In the comment at `:125`, change `(dashboard, analytics-tiktok,` to `(dashboard,`.
- Add, using the file's existing `ids` helper, `getNavGroups` import and `ownerCan` (`:1-11`):

```ts
describe('TikTok analytics placeholder', () => {
  it('is gone for every role (spec B4)', () => {
    expect(ids(getNavGroups(null, 'owner', ownerCan))).not.toContain('analytics-tiktok');
    expect(ids(getNavGroups(null, 'agent', agentCan))).not.toContain('analytics-tiktok');
    expect(ids(getMoreSheetGroups(null, 'owner', ownerCan))).not.toContain('analytics-tiktok');
  });
});
```

`getMoreSheetGroups` takes the same `(features, workspaceRole, can)` triple as `getNavGroups` (`nav-data.ts:343-346`; the test already calls it that way at `:108`).

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/nav-data.test.ts`
Expected: the new test FAILS.

- [ ] **Step 3: Implement**

Delete the `analytics-tiktok` item (`nav-data.ts:174-181`), change `politica-de-privacidade, analytics-tiktok)` to `politica-de-privacidade)` in the comment at `:250`, and remove the `"tiktok": "TikTok",` line from `nav` in both `common.json` files (`:22`). Check `Sidebar.tsx` / `MobileNav.tsx` still compile (the generic `disabled` branch stays; only the item goes).

- [ ] **Step 4: Run and confirm it passes**

Same command, plus `npx vitest run apps/crm/src/components/layout`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout packages/i18n/locales
git commit -m "chore(nav): remove the TikTok 'Em breve' analytics placeholder"
```

---

## Integration

### Task 15: Gates, browser verification, PR, deploy checklist

Precondition: Execution order step 4 is done in the main worktree (`git merge --no-ff feat/tiktok-audit-readiness-backend`, `git worktree remove .../new-session-3cb9fe-backend`, `git branch -d feat/tiktok-audit-readiness-backend`, `npm ci`). `git worktree list` must no longer show the backend path and `git log --oneline -1` must be the merge commit.

- [ ] **Step 1: Frontend gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all green. If `format:check` fails, run `npm run format` and commit.

- [ ] **Step 2: Backend gates (last), then restore `node_modules`**

The backend lane already ran these per file in its own worktree; this is the full-suite pass on the merged tree, and it is the one `deno` run the main worktree ever sees.

```bash
npm run check:functions
npm run test:functions
npm ci
git status --short   # deno.lock must not be dirty; if it is: git checkout deno.lock
```

- [ ] **Step 3: Browser verification**

- Run the CRM locally with `npm run dev:env`, using the preview tooling.
- Stub `workspace-limits` and `tiktok-publish/creator-info` as described in memory `reference_local_browser_verify_stub_edge_functions.md`. Patch `fetch` in the page to answer creator-info with each of these bodies:
  1. `{ app_audited: false, can_post: true, privacy_level_options: ['FOLLOWER_OF_CREATOR','MUTUAL_FOLLOW_FRIENDS','SELF_ONLY'], max_video_post_duration_sec: 600, creator_nickname: 'teste' }`
  2. the same with `PUBLIC_TO_EVERYONE` added
  3. `{ can_post: false, cannot_post_reason: 'spam_risk_too_many_posts', app_audited: false }`
  4. `app_audited: true` with all options
- In the TikTok tab, check:
  - banner
  - preview
  - disabled options and suffixes
  - disclosure states and labels
  - declaration above the row and inside the publish-now dialog
  - "Falta:" reasons
  - neutral button
- Check light and dark (`resize_window` `colorScheme`), at drawer width and at 390px.
- Screenshot the main state for the PR.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/tiktok-audit-readiness
gh pr create --title "feat(tiktok): audit readiness (composer compliance + flow fixes)" --body-file <(cat <<'EOF'
## Summary
Spec: docs/superpowers/specs/2026-10-08-tiktok-audit-readiness-design.md. Mockups: https://claude.ai/artifact/CdAMpAMxXx9iAucyRjfp3d

- Composer meets TikTok's Content Sharing Guidelines: commercial-disclosure master toggle with label prompts, branded content never private, content preview, video duration vs creator limit, can't-post notices, test mode shown up front, declaration above every sending control (incl. publish-now dialog and auto-schedule dialogs).
- Server pre-init creator/media check in cron + publish-now (guards Hub-approved and auto-scheduled posts); TikTok error codes become pt-BR, non-retryable.
- Flow: connect lands on Redes sociais with a toast; clear auth-url errors; TikTok posts get neutral button + per-platform caption copy; photo posts link to /photo/; drop unused video.upload scope; remove TikTok "Em breve" nav item.

## Deploy (functions BEFORE merge; merge deploys the frontend)
- tiktok-publish (keeps verify_jwt)
- tiktok-publish-cron --no-verify-jwt
- tiktok-webhook --no-verify-jwt
- tiktok-integration --no-verify-jwt
No migrations.

## Test plan
- [ ] vitest, tsc x4, lint, format
- [ ] check:functions, test:functions
- [ ] browser walk of C2 steps 3-5 with stubbed creator-info (light/dark, drawer, 390px)
- [ ] owner pre-deploy gate: /@user/photo/{id} verified on a real photo post (Task 15 Step 5)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

- [ ] **Step 5: Hand the owner the deploy and demo checklist. Do not run it without explicit approval.**

- **Pre-deploy owner gate: the `/photo/` URL.** Before any prod deploy, the owner opens a real TikTok photo post of the sandbox account and confirms `https://www.tiktok.com/@{user}/photo/{publish_id}` resolves (Task 6 switches `buildTikTokPostUrl` to that shape for photos). If it 404s, revert the photo branch of `buildTikTokPostUrl` to `/video/` in a follow-up commit (update the Task 6 photo test expectation back to `/video/`) **before** deploying; the PR test-plan checkbox above is this gate.
- **Deploy the edge functions to prod** in the table order, using `--use-api` (memory) and the explicit `--project-ref skjzpekeqefvlojenfsw`. Ask before each prod deploy.
- **Spec C1:**
  - DK TESTE overrides
  - a board with TikTok
  - `auto_publish_on_approval` off
  - the sandbox target user
  - the account set to private
- **Spec C2** demo recording, **C3** portal submission, **C4** after approval.
