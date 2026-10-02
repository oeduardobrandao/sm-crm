# Bounded `hub-posts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `hub-posts` from shipping never-sent drafts and every post a client ever had on each Hub load: return in-flight posts plus the last 90 days, with older posts, calendar months and single posts fetched on demand.

**Architecture:** Two PRs. PR 1 (Tasks 1–3) filters the existing GET to client-visible posts, prunes every response field to them, and pages the unbounded lookups; no contract change. PR 2 (Tasks 4–11) adds three read modes to the same endpoint (`?before=` history pages, `?from=&to=` calendar month, `?post_id=`), bounds the default response, and moves the Hub to them through a `useHubPosts` hook, a range query on Home and a single-post fallback for deep links and message chips.

**Tech Stack:** Deno edge function (Supabase, PostgREST via supabase-js), React 19 + TanStack Query v5 + react-router v7 (Hub), Vitest + Testing Library, Deno test with `test/shared/supabaseMock.ts`.

**Spec:** `docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md` (read it first; this plan implements it exactly).

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/client-hub-loading-speeds-776bfa`. Run `pwd` and `git branch --show-current` before every commit.
- User-facing copy is Portuguese, with period or colon instead of em-dashes. New Hub strings go into BOTH `packages/i18n/locales/pt/<ns>.json` and `packages/i18n/locales/en/<ns>.json` (a parity test enforces identical keys), and every `t()` call carries the Portuguese default.
- Edge functions never return raw error details: generic Portuguese messages out, details in `console.error`.
- Every Hub mode stays scoped by `conta_id` AND `cliente_id` from the resolved token. A never-sent draft (internal status, no `enviado_cliente` event) must never leave the server in any mode.
- Shell cutoff: start of the UTC day 90 days before `deps.now()`. History page size: 30 (fetch 31). Range max span: 45 days.
- The history cursor is `"<published_at>|<id>"` with `published_at` copied byte for byte from the row PostgREST returned. Never round-trip it through `Date`.
- After ANY `deno test` run: `git checkout deno.lock` and `ls node_modules/.deno >/dev/null 2>&1 && npm ci` (Deno pollutes both).
- Pre-push gate (CLAUDE.md): `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`.
- Edge deploy: `npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref <ref>` with STAGING=`wlyzhyfondykzpsiqsce`, PROD=`skjzpekeqefvlojenfsw`. Deploy only from a branch that contains everything on `origin/main` (`git log HEAD..origin/main` empty).
- Hub browser verification: `node scripts/with-env.mjs npm run dev:hub` on port 5175 (prod CORS only allows 5175).

Deno test command used below (single file):

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts
```

---

# PR 1: visibility filter, response pruning, row cap

### Task 1: Drop never-sent drafts and prune every response field to visible posts

**Files:**

- Modify: `supabase/functions/hub-posts/em-producao.ts` (export the visible set, add `isHubVisiblePost`)
- Modify: `supabase/functions/hub-posts/handler.ts` (GET, after the phase 2 `Promise.all`)
- Test: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**

- Produces: `export const CLIENT_VISIBLE_STATUSES: ReadonlySet<string>` and `export function isHubVisiblePost(post: { id: number; status: string }, emProducao: Map<number, unknown>): boolean` in `em-producao.ts`. Tasks 4–6 reuse the handler's filtered `visiblePosts`.

- [ ] **Step 0: Branch**

The spec and this plan were committed on `claude/hub-posts-bounded`. PR 1 ships from that branch, renamed:

```bash
cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/client-hub-loading-speeds-776bfa
git fetch -q origin && git log --oneline HEAD..origin/main   # must be empty; else: git rebase origin/main
git branch -m claude/hub-posts-visibility
```

- [ ] **Step 1: Write the failing tests**

Add after the test `"hub-posts paginates the post_status_events lookup past a full page"` (it uses the existing `queueHubPostsBase`, `hubPostsHandlerFor` and `basePost` helpers defined just above it):

```ts
Deno.test('hub-posts never returns a never-sent draft or anything tied to it', async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [
    { ...basePost, id: 1, status: 'enviado_cliente', workflow_id: 7 },
    {
      ...basePost,
      id: 2,
      status: 'rascunho',
      workflow_id: 8,
      workflows: { titulo: 'Só rascunho' },
    },
  ]);
  db.queue('instagram_accounts', 'select', { data: null, error: null });
  db.queue('clientes', 'select', { data: { auto_publish_on_approval: true }, error: null });
  // No enviado_cliente event for post 2: it was never sent, so it is not em produção.
  db.queue('post_status_events', 'select', { data: [], error: null });
  db.queue('post_approvals', 'select', {
    data: [
      {
        id: 10,
        post_id: 1,
        action: 'aprovado',
        comentario: null,
        is_workspace_user: false,
        created_at: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 11,
        post_id: 2,
        action: 'correcao',
        comentario: 'x',
        is_workspace_user: false,
        created_at: '2026-09-01T10:00:00.000Z',
      },
    ],
    error: null,
  });
  db.queue('post_property_values', 'select', {
    data: [
      {
        post_id: 1,
        value: 'a',
        template_property_definitions: {
          name: 'P',
          type: 'text',
          config: {},
          portal_visible: true,
          display_order: 0,
        },
      },
      {
        post_id: 2,
        value: 'b',
        template_property_definitions: {
          name: 'P',
          type: 'text',
          config: {},
          portal_visible: true,
          display_order: 0,
        },
      },
    ],
    error: null,
  });
  db.queue('workflow_select_options', 'select', {
    data: [
      { workflow_id: 7, property_definition_id: 1, option_id: 'o1', label: 'A', color: '#000' },
      { workflow_id: 8, property_definition_id: 1, option_id: 'o2', label: 'B', color: '#000' },
    ],
    error: null,
  });
  db.queue('post_file_links', 'select', {
    data: [
      {
        id: 100,
        post_id: 1,
        is_cover: false,
        sort_order: 0,
        files: {
          id: 1,
          kind: 'image',
          mime_type: 'image/png',
          r2_key: 'contas/conta-1/a.png',
          thumbnail_r2_key: null,
          width: 1,
          height: 1,
          duration_seconds: null,
          blur_data_url: null,
          stream_uid: null,
          stream_status: null,
          media_lost_at: null,
        },
      },
      {
        id: 101,
        post_id: 2,
        is_cover: false,
        sort_order: 0,
        files: {
          id: 2,
          kind: 'image',
          mime_type: 'image/png',
          r2_key: 'contas/conta-1/draft.png',
          thumbnail_r2_key: null,
          width: 1,
          height: 1,
          duration_seconds: null,
          blur_data_url: null,
          stream_uid: null,
          stream_status: null,
          media_lost_at: null,
        },
      },
    ],
    error: null,
  });
  // Workflow 8 (only the draft) has two open approval etapas: suspended, but must not leak.
  db.queue('workflow_etapas', 'select', {
    data: [
      { workflow_id: 8, tipo: 'aprovacao_cliente', status: 'ativo' },
      { workflow_id: 8, tipo: 'aprovacao_cliente', status: 'pendente' },
    ],
    error: null,
  });

  const signed: string[] = [];
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => {
      signed.push(key);
      return `https://signed/${key}`;
    },
    rateLimit: async () => true,
  });
  const body = await readJson(
    await handler(new Request('https://example.test/hub-posts?token=hub-123')),
  );

  assertEquals(
    body.posts.map((p: { id: number }) => p.id),
    [1],
  );
  assertEquals(
    body.postApprovals.map((a: { id: number }) => a.id),
    [10],
  );
  assertEquals(
    body.propertyValues.map((v: { post_id: number }) => v.post_id),
    [1],
  );
  assertEquals(
    body.workflowSelectOptions.map((o: { workflow_id: number }) => o.workflow_id),
    [7],
  );
  assertEquals(body.autoPublishSuspendedWorkflowIds, []);
  assertEquals(signed, ['contas/conta-1/a.png'], "a dropped draft's media is never signed");
});

Deno.test(
  'hub-posts drops a suspended avulso id when the avulso is a never-sent draft',
  async () => {
    const db = createSupabaseQueryMock();
    queueHubPostsBase(db, [
      { ...basePost, id: 1, status: 'enviado_cliente', workflow_id: null, workflows: null },
      { ...basePost, id: 2, status: 'rascunho', workflow_id: null, workflows: null },
    ]);
    db.queue('instagram_accounts', 'select', { data: null, error: null });
    db.queue('clientes', 'select', { data: { auto_publish_on_approval: true }, error: null });
    db.queue('post_status_events', 'select', { data: [], error: null });
    db.queue('post_processes', 'select', {
      data: [
        { id: 10, post_id: 1 },
        { id: 11, post_id: 2 },
      ],
      error: null,
    });
    db.queue('post_process_steps', 'select', {
      data: [
        { process_id: 10, estado: 'ativo' },
        { process_id: 10, estado: 'pendente' },
        { process_id: 11, estado: 'ativo' },
        { process_id: 11, estado: 'pendente' },
      ],
      error: null,
    });

    const body = await readJson(
      await hubPostsHandlerFor(db)(new Request('https://example.test/hub-posts?token=hub-123')),
    );
    assertEquals(body.autoPublishSuspendedPostIds, [1]);
  },
);
```

- [ ] **Step 2: Update the existing tests the filter changes**

In `"hub-posts flags a re-armed rascunho post as em_producao and leaves the others null"`: rename it to `"hub-posts flags a re-armed rascunho post as em_producao and drops a never-sent draft"` and change the assertion to:

```ts
assertEquals(byId, { 1: 'proxima_aprovacao', 3: null });
```

In `"hub-posts falls back to em_producao null when the status-events query fails"`: rename it to `"hub-posts hides internal posts when the status-events query fails"` and replace its two assertions with:

```ts
assertEquals(response.status, 200);
assertEquals(body.posts, []);
```

Four auto-publish tests queue posts with no `status`, which the filter now drops. Add `status: "enviado_cliente"` to every post object in the `workflow_posts` fixtures of:
`"hub-posts suspends every workflow when the etapa lookup errors"`,
`"hub-posts flags workflows whose auto-publish is suspended by a later approval etapa"`,
`"hub-posts lista avulsos com processo individual suspenso por outra aprovação adiante"`,
`"hub-posts suspende todos os avulsos com processo quando a consulta das etapas erra"`.
For example `{ id: 1, workflow_id: 7, workflows: null }` becomes `{ id: 1, status: "enviado_cliente", workflow_id: 7, workflows: null }`.

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run the Deno test command (Global Constraints). Expected: the two new tests FAIL (draft id 2 present in `posts`, and `autoPublishSuspendedPostIds` is `[1, 2]`); the renamed em_producao tests FAIL too. Then `git checkout deno.lock`.

- [ ] **Step 4: Export the visible set and add the predicate**

In `supabase/functions/hub-posts/em-producao.ts`, change `const CLIENT_VISIBLE_STATUSES` to `export const CLIENT_VISIBLE_STATUSES` and add below `computeEmProducaoByPost`:

```ts
/** Server-side mirror of the Hub's isPostClientVisible: client-visible statuses, plus internal
 * posts the client already saw (em produção). Everything else is a never-sent draft and must
 * not leave the server. */
export function isHubVisiblePost(
  post: { id: number; status: string },
  emProducao: Map<number, unknown>,
): boolean {
  return (
    CLIENT_VISIBLE_STATUSES.has(post.status) ||
    (INTERNAL_STATUSES.has(post.status) && emProducao.has(post.id))
  );
}
```

- [ ] **Step 5: Filter and prune in the handler**

In `handler.ts`, add `isHubVisiblePost` to the `./em-producao.ts` import. Directly after the phase 2 `Promise.all` destructuring (the block ending in `loadSuspendedPostIds(),\n    ]);`), insert:

```ts
// Never-sent drafts stay on the server. Phase 2 queried with every post id (no extra
// round trip); from here on, every field is pruned to the visible set so nothing tied
// to a dropped post (approvals, properties, options, suspension ids, media) leaves.
const visiblePosts = flatPosts.filter((post: { id: number; status: string }) =>
  isHubVisiblePost(post, emProducaoByPost),
);
const visibleIds = new Set<number>(visiblePosts.map((post: { id: number }) => post.id));
const visibleWorkflowIds = new Set<number>(
  visiblePosts
    .map((post: { workflow_id: number | null }) => post.workflow_id)
    .filter((id: number | null): id is number => id != null),
);
```

Then make these replacements below it:

1. `postApprovals`:

```ts
const postApprovals = (
  (rawPostApprovals ?? []) as {
    post_id: number;
    action: string;
    is_workspace_user: boolean | null;
  }[]
)
  .filter((a) => visibleIds.has(a.post_id))
  .filter(isClientVisibleApproval);
```

2. Both suggestion loops: skip rows of dropped posts. In `for (const s of (pendingSuggestions ?? []))` add `if (!visibleIds.has(s.post_id)) continue;` as the first line of the body; same in `for (const r of (rejectedSuggestions ?? []))`.

3. Media: `const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(` becomes

```ts
    const mediaWithUrls = await Promise.all((mediaLinks ?? [])
      .filter((link: { post_id: number }) => visibleIds.has(link.post_id))
      .map(
```

(keep the rest of the callback and close the extra parenthesis).

4. `const flatPostsWithMedia = flatPosts.map(` becomes `const flatPostsWithMedia = visiblePosts.map(`.

5. In the final `return json({...})`:

```ts
      propertyValues: ((propertyValues ?? []) as { post_id: number }[])
        .filter((v) => visibleIds.has(v.post_id)),
      workflowSelectOptions: ((workflowSelectOptions ?? []) as { workflow_id: number }[])
        .filter((o) => visibleWorkflowIds.has(o.workflow_id)),
      ...
      autoPublishSuspendedWorkflowIds: autoPublishSuspendedWorkflowIds
        .filter((id) => visibleWorkflowIds.has(id)),
      autoPublishSuspendedPostIds: autoPublishSuspendedPostIds
        .filter((id) => visibleIds.has(id)),
```

Content keys need no change: they are collected from `flatPostsWithMedia` (now visible only) and `suggestionByPost` (now visible only).

- [ ] **Step 6: Run the tests to verify they pass**

Run the Deno test command. Expected: all `hub-posts` tests PASS. Then `git checkout deno.lock`.

- [ ] **Step 7: Type-check and commit**

```bash
npm run check:functions
git add supabase/functions/hub-posts/em-producao.ts supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "fix(hub): hub-posts não envia rascunhos nunca enviados ao cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page the lookups that grow with post count

**Files:**

- Modify: `supabase/functions/hub-posts/handler.ts` (phase 2)
- Test: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**

- Consumes: `fetchAllRows` from `../_shared/paginate.ts` (already imported). It stops only on an empty page and throws on a page error.
- Produces: module-level `pagedRows` and `warnIfCapped` helpers in `handler.ts`.

Mock ordering matters here: `supabaseMock` dequeues per `table:select` at the moment a query is awaited. `fetchAllRows` starts its first page as soon as it is called, i.e. while the phase 2 array is being built, before `Promise.all` touches the plain builders. Both `post_edit_suggestions` lookups must therefore BOTH go through `fetchAllRows`, pending first, so their first pages still dequeue pending-then-rejected (the `files` test from #622 queues them in that order).

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test(
  'hub-posts pages approvals, media, property values and suggestions with a total order',
  async () => {
    const db = createSupabaseQueryMock();
    queueHubPostsBase(db, [{ ...basePost, id: 1, status: 'enviado_cliente' }]);
    db.queue(
      'post_approvals',
      'select',
      {
        data: [
          {
            id: 10,
            post_id: 1,
            action: 'aprovado',
            comentario: null,
            is_workspace_user: false,
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 11,
            post_id: 1,
            action: 'correcao',
            comentario: 'y',
            is_workspace_user: false,
            created_at: '2026-09-02T10:00:00.000Z',
          },
        ],
        error: null,
      },
    );

    const body = await readJson(
      await hubPostsHandlerFor(db)(new Request('https://example.test/hub-posts?token=hub-123')),
    );

    assertEquals(
      body.postApprovals.map((a: { id: number }) => a.id),
      [10, 11],
    );
    // Unqueued tables answer [] on the first page, which already ends fetchAllRows (one call);
    // what matters for them is .range() and a total order ending in id.
    for (const table of [
      'post_approvals',
      'post_file_links',
      'post_property_values',
      'post_edit_suggestions',
    ]) {
      const calls = db.calls.filter((c) => c.table === table);
      assert(calls.length >= 1, `${table} must be queried`);
      assert(
        calls.every((c) => c.modifiers.some((m) => m.method === 'range')),
        `${table} must use .range()`,
      );
      const orders = calls[0].modifiers.filter((m) => m.method === 'order').map((m) => m.args[0]);
      assertEquals(orders[orders.length - 1], 'id', `${table} order must end in id`);
    }
    assertEquals(
      db.calls.filter((c) => c.table === 'post_approvals').length,
      3,
      'two queued pages, then the empty page that ends the loop',
    );
  },
);

Deno.test('hub-posts keeps going with [] when a paged lookup errors', async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [{ ...basePost, id: 1, status: 'enviado_cliente' }]);
  db.queue('post_approvals', 'select', { data: null, error: { message: 'boom' } });

  const response = await hubPostsHandlerFor(db)(
    new Request('https://example.test/hub-posts?token=hub-123'),
  );
  const body = await readJson(response);
  assertEquals(response.status, 200);
  assertEquals(body.postApprovals, []);
  assertEquals(body.posts.length, 1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Deno test command. Expected: the first FAILS (`postApprovals` is `[10]`: the unpaged read stops after one call). Then `git checkout deno.lock`.

- [ ] **Step 3: Add the helpers**

In `handler.ts`, below `injectSignedUrls`:

```ts
// PostgREST truncates an unpaged select at db-max-rows (1000 on hosted Supabase) silently.
const ROW_CAP = 1000;

type PageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** fetchAllRows with today's failure mode: a failed lookup logs and degrades to []. */
async function pagedRows<T>(label: string, fetchPage: PageFetcher<T>): Promise<{ data: T[] }> {
  try {
    return { data: await fetchAllRows(fetchPage) };
  } catch (err) {
    console.error(`[hub-posts] ${label} lookup failed:`, err);
    return { data: [] };
  }
}

/** Unpaged lookups whose size is bounded per post or per workflow: never silent if that breaks. */
function warnIfCapped(table: string, rows: unknown[] | null | undefined) {
  if ((rows?.length ?? 0) >= ROW_CAP) console.warn(`[hub-posts] row cap reached: ${table}`);
}
```

- [ ] **Step 4: Page the four lookups**

In the phase 2 `Promise.all` array replace the approvals, both suggestion, property-value and media entries with (order in the array unchanged):

```ts
      postIds.length > 0
        ? pagedRows("post_approvals", (from, to) =>
            db
              .from("post_approvals")
              .select("id, post_id, action, comentario, is_workspace_user, created_at")
              .in("post_id", postIds)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : none,
      postIds.length > 0
        ? pagedRows("pending suggestions", (from, to) =>
            db
              .from("post_edit_suggestions")
              .select("id, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, changed_fields, updated_at")
              .in("post_id", postIds)
              .eq("status", "pending")
              .order("id", { ascending: true })
              .range(from, to)
          )
        : none,
      postIds.length > 0
        ? pagedRows("rejected suggestions", (from, to) =>
            db
              .from("post_edit_suggestions")
              .select("id, post_id, updated_at")
              .in("post_id", postIds)
              .eq("status", "rejected")
              .order("updated_at", { ascending: false })
              .order("id", { ascending: false })
              .range(from, to)
          )
        : none,
      wiredPostIds.length > 0
        ? pagedRows("post_property_values", (from, to) =>
            db
              .from("post_property_values")
              .select("id, post_id, value, template_property_definitions!inner(name, type, config, portal_visible, display_order)")
              .in("post_id", wiredPostIds)
              .eq("template_property_definitions.portal_visible", true)
              .order("template_property_definitions(display_order)", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : none,
```

(`workflow_select_options` stays as it is, between property values and media.)

```ts
      postIds.length > 0
        ? pagedRows("post_file_links", (from, to) =>
            db
              .from("post_file_links")
              .select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url, stream_uid, stream_status, media_lost_at)")
              .in("post_id", postIds)
              .order("sort_order", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : none,
```

Note: the property-values select gains `id` (needed for the total order). The client never reads it; leaving it in the payload is harmless.

- [ ] **Step 5: Cap warnings on the bounded lookups**

Right after the phase 1 destructuring add `warnIfCapped("workflow_posts", posts);`. After the phase 2 destructuring add `warnIfCapped("workflow_select_options", workflowSelectOptions);`. Inside `loadSuspendedWorkflowIds` after its query add `warnIfCapped("workflow_etapas", etapas);`; inside `loadSuspendedPostIds` add `warnIfCapped("post_processes", procs);` and `warnIfCapped("post_process_steps", steps);` after each query.

- [ ] **Step 6: Run the whole hub-posts suite**

Deno test command. Expected: all PASS, including `"hub-posts: ... files ..."` single-query test and the em_producao paging test. Then `git checkout deno.lock`.

- [ ] **Step 7: Type-check and commit**

```bash
npm run check:functions
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "fix(hub): hub-posts pagina aprovações, mídias, propriedades e sugestões

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ship PR 1 (deploy before merge, as usual)

- [ ] **Step 1: Full gate**

Run every command in the pre-push gate (Global Constraints). All must pass. Then `git checkout deno.lock` and the `npm ci` check.

- [ ] **Step 2: Deploy to staging and smoke**

```bash
git fetch -q origin && git log --oneline HEAD..origin/main   # must be empty
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce
```

Smoke with a staging hub token if one is at hand; otherwise go to prod in Step 3 with the test client.

- [ ] **Step 3: Deploy to prod and smoke**

```bash
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
cd /Users/eduardosouza/projects/sm-crm && set -a && . ./.env && set +a
curl -s -H "apikey: $VITE_SUPABASE_ANON_KEY" "$VITE_SUPABASE_URL/functions/v1/hub-posts?token=8381033c-520a-4614-a67d-ac5fbb2af11a" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['posts']), sorted({p['status'] for p in d['posts']}))"
```

Expected: 200 JSON, no internal status without `em_producao`. (Shell cwd resets afterwards; `cd` back to the worktree.)

- [ ] **Step 4: Push, PR, merge**

```bash
git push -u origin claude/hub-posts-visibility
gh pr create --title "fix(hub): hub-posts sem rascunhos nunca enviados e com leituras paginadas" --body "$(cat <<'EOF'
Primeiro de dois PRs do spec docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md (inclui o spec e o plano).

- Posts internos que o cliente nunca viu não saem mais do servidor (antes iam com conteúdo e mídia assinada e só eram escondidos na tela). Todos os campos da resposta são podados para os posts visíveis.
- Aprovações, mídias, propriedades e sugestões são lidas em páginas (sem corte silencioso em 1000 linhas); as demais leituras avisam no log se baterem no limite.
- Mudança visível: "Posts este mês" e "Próximo post" na Home deixam de contar rascunhos nunca enviados.

Sem mudança de contrato. hub-posts já está em staging e prod.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Wait for CI green (check `e2e-secrets-guard`), then `gh pr merge <n> --squash`. Delete the remote branch by hand if `--delete-branch` conflicts with the worktree.

---

# PR 2: the bound

Start from fresh main after PR 1 merged:

```bash
git fetch -q origin && git switch -c claude/hub-posts-bounded-modes origin/main
```

### Task 4: Pure mode parsing (`modes.ts`)

**Files:**

- Create: `supabase/functions/hub-posts/modes.ts`
- Test: `supabase/functions/__tests__/hub-posts-modes_test.ts`

**Interfaces:**

- Produces (all exported from `modes.ts`): `HISTORY_PAGE_SIZE = 30`, `SHELL_WINDOW_DAYS = 90`, `MAX_RANGE_DAYS = 45`, `interface Cursor { ts: string; id: number }`, `type GetMode = { kind: "shell" } | { kind: "history"; before: Cursor } | { kind: "range"; from: string; to: string } | { kind: "post"; postId: number }`, `parseCursor(raw: string): Cursor | null`, `cursorOf(row: { published_at: string; id: number }): string`, `shellCutoff(nowIso: string): string`, `parseGetMode(params: URLSearchParams): GetMode | null` (null = 400).

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from './assert.ts';
import { cursorOf, parseCursor, parseGetMode, shellCutoff } from '../hub-posts/modes.ts';

const q = (s: string) => new URLSearchParams(s);

Deno.test('hub-posts modes: no params is the shell', () => {
  assertEquals(parseGetMode(q('token=t')), { kind: 'shell' });
});

Deno.test('hub-posts modes: cutoff is the start of the UTC day 90 days back', () => {
  assertEquals(shellCutoff('2026-10-02T23:59:59.999Z'), '2026-07-04T00:00:00.000Z');
  assertEquals(shellCutoff('2026-10-02T00:00:00.000Z'), '2026-07-04T00:00:00.000Z');
});

Deno.test('hub-posts modes: cursor keeps PostgREST microseconds byte for byte', () => {
  const row = { published_at: '2026-07-04T10:00:00.123456+00:00', id: 42 };
  const raw = cursorOf(row);
  assertEquals(raw, '2026-07-04T10:00:00.123456+00:00|42');
  assertEquals(parseCursor(raw), { ts: '2026-07-04T10:00:00.123456+00:00', id: 42 });
  assertEquals(parseGetMode(q(`before=${encodeURIComponent(raw)}`)), {
    kind: 'history',
    before: { ts: '2026-07-04T10:00:00.123456+00:00', id: 42 },
  });
});

Deno.test('hub-posts modes: a cursor cannot smuggle PostgREST syntax', () => {
  for (const bad of [
    '2026-07-04T10:00:00Z,status.neq.postado|1',
    '2026-07-04T10:00:00Z)|1',
    'not-a-date|1',
    '2026-07-04T10:00:00Z|abc',
    '2026-07-04T10:00:00Z',
    '|1',
  ]) {
    assertEquals(parseCursor(bad), null, bad);
  }
});

Deno.test('hub-posts modes: range bounds', () => {
  assertEquals(parseGetMode(q('from=2026-03-01T03:00:00.000Z&to=2026-04-01T03:00:00.000Z')), {
    kind: 'range',
    from: '2026-03-01T03:00:00.000Z',
    to: '2026-04-01T03:00:00.000Z',
  });
  assertEquals(parseGetMode(q('from=2026-04-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-04-02T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-01-01T00:00:00.000Z&to=2026-02-16T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-01-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=x&to=y')), null);
});

Deno.test('hub-posts modes: post id and conflicts', () => {
  assertEquals(parseGetMode(q('post_id=5061')), { kind: 'post', postId: 5061 });
  assertEquals(parseGetMode(q('post_id=5a')), null);
  assertEquals(parseGetMode(q('post_id=1&before=2026-07-04T00:00:00.000Z|0')), null);
  assertEquals(
    parseGetMode(q('post_id=1&from=2026-03-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')),
    null,
  );
});
```

- [ ] **Step 2: Run to verify failure**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-posts-modes_test.ts
```

Expected: FAIL, module `../hub-posts/modes.ts` not found. `git checkout deno.lock`.

- [ ] **Step 3: Implement `modes.ts`**

```ts
// Read modes of the hub-posts GET.
// Spec: docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md

export const HISTORY_PAGE_SIZE = 30;
export const SHELL_WINDOW_DAYS = 90;
export const MAX_RANGE_DAYS = 45;

export interface Cursor {
  ts: string;
  id: number;
}

export type GetMode =
  | { kind: 'shell' }
  | { kind: 'history'; before: Cursor }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'post'; postId: number };

// The cursor timestamp is interpolated into a PostgREST .or() string, so only ISO 8601
// characters pass: no comma, parenthesis or quote can add another condition.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseCursor(raw: string): Cursor | null {
  const sep = raw.lastIndexOf('|');
  if (sep <= 0) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!isIsoTimestamp(ts) || !/^\d+$/.test(id)) return null;
  return { ts, id: Number(id) };
}

/** The row's cursor. published_at goes in exactly as PostgREST returned it: it carries
 * microseconds, and re-serializing through Date would truncate to milliseconds and make the
 * tie-break `published_at.eq.<ts>` skip rows. */
export function cursorOf(row: { published_at: string; id: number }): string {
  return `${row.published_at}|${row.id}`;
}

/** Start of the UTC day SHELL_WINDOW_DAYS back: stable for a whole day of refetches. */
export function shellCutoff(nowIso: string): string {
  const d = new Date(nowIso);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - SHELL_WINDOW_DAYS);
  return d.toISOString();
}

/** null means a 400: malformed values, or more than one mode at once. */
export function parseGetMode(params: URLSearchParams): GetMode | null {
  const before = params.get('before');
  const from = params.get('from');
  const to = params.get('to');
  const postId = params.get('post_id');
  const isRange = from !== null || to !== null;
  const given = [before !== null, isRange, postId !== null].filter(Boolean).length;
  if (given === 0) return { kind: 'shell' };
  if (given > 1) return null;

  if (before !== null) {
    const cursor = parseCursor(before);
    return cursor ? { kind: 'history', before: cursor } : null;
  }
  if (postId !== null) {
    return /^\d+$/.test(postId) ? { kind: 'post', postId: Number(postId) } : null;
  }
  if (from === null || to === null || !isIsoTimestamp(from) || !isIsoTimestamp(to)) return null;
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0 || span > MAX_RANGE_DAYS * 86_400_000) return null;
  return { kind: 'range', from, to };
}
```

- [ ] **Step 4: Run to verify pass**

Same command. Expected: PASS. `git checkout deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/modes.ts supabase/functions/__tests__/hub-posts-modes_test.ts
git commit -m "feat(hub): modos de leitura do hub-posts (cursor, intervalo, post único)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bounded shell, history pages, range and single post in the handler

**Files:**

- Modify: `supabase/functions/hub-posts/handler.ts` (GET phase 1 and the final response)
- Test: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**

- Consumes: everything from `modes.ts` (Task 4); `visiblePosts` / pruning from Task 1.
- Produces: response fields `olderCursor: string | null` and `historyCutoff: string | null` (shell only), `nextCursor: string | null` (history only); 400 `{ error: "Parâmetros inválidos." }`; 404 `{ error: "Post não encontrado." }` (post mode).

- [ ] **Step 1: Write the failing tests**

Add after the Task 2 tests. `now` in this file is `2026-04-17T12:00:00.000Z`, so the cutoff is `2026-01-17T00:00:00.000Z`.

```ts
const CUTOFF = '2026-01-17T00:00:00.000Z';
const orArgs = (db: ReturnType<typeof createSupabaseQueryMock>, nth = 0) =>
  db.calls
    .filter((c) => c.table === 'workflow_posts')
    [nth].modifiers.filter((m) => m.method === 'or')
    .map((m) => m.args[0]);

Deno.test(
  'hub-posts shell: bounded filter, older check after the posts query, cursor when older exist',
  async () => {
    const db = createSupabaseQueryMock();
    queueHubPostsBase(db, [{ ...basePost, id: 1, status: 'enviado_cliente' }]);
    db.queue('workflow_posts', 'select', { data: [{ id: 77 }], error: null }); // older check
    const body = await readJson(
      await hubPostsHandlerFor(db)(new Request('https://example.test/hub-posts?token=hub-123')),
    );

    assertEquals(orArgs(db), [
      `status.neq.postado,published_at.gte.${CUTOFF},scheduled_at.gte.${CUTOFF}`,
    ]);
    const older = db.calls.filter((c) => c.table === 'workflow_posts')[1];
    assert(
      older.modifiers.some(
        (m) => m.method === 'eq' && m.args[0] === 'status' && m.args[1] === 'postado',
      ),
    );
    assert(
      older.modifiers.some(
        (m) => m.method === 'lt' && m.args[0] === 'published_at' && m.args[1] === CUTOFF,
      ),
    );
    assert(older.modifiers.some((m) => m.method === 'limit' && m.args[0] === 1));
    assert(!older.modifiers.some((m) => m.method === 'maybeSingle' || m.method === 'single'));
    assertEquals(body.olderCursor, `${CUTOFF}|0`);
    assertEquals(body.historyCutoff, CUTOFF);
    assertEquals('nextCursor' in body, false);
  },
);

Deno.test(
  'hub-posts shell: no older posts means null cursor (an unqueued older check returns [])',
  async () => {
    const db = createSupabaseQueryMock();
    queueHubPostsBase(db, [{ ...basePost, id: 1, status: 'enviado_cliente' }]);
    const body = await readJson(
      await hubPostsHandlerFor(db)(new Request('https://example.test/hub-posts?token=hub-123')),
    );
    assertEquals(body.olderCursor, null);
    assertEquals(body.historyCutoff, null);
  },
);

Deno.test(
  'hub-posts history: postado older than the cursor, 30 per page, cursor verbatim',
  async () => {
    const ts = '2026-01-10T10:00:00.123456+00:00';
    const rows = Array.from({ length: 31 }, (_, i) => ({
      ...basePost,
      id: 500 - i,
      status: 'postado',
      published_at: `2026-01-0${(i % 9) + 1}T10:00:00.12345${i % 10}+00:00`,
    }));
    const db = createSupabaseQueryMock();
    queueHubPostsBase(db, rows);
    const before = encodeURIComponent(`${ts}|900`);
    const body = await readJson(
      await hubPostsHandlerFor(db)(
        new Request(`https://example.test/hub-posts?token=hub-123&before=${before}`),
      ),
    );

    const call = db.calls.filter((c) => c.table === 'workflow_posts')[0];
    assertEquals(orArgs(db), [`published_at.lt.${ts},and(published_at.eq.${ts},id.lt.900)`]);
    assert(
      call.modifiers.some(
        (m) => m.method === 'eq' && m.args[0] === 'status' && m.args[1] === 'postado',
      ),
    );
    assert(call.modifiers.some((m) => m.method === 'limit' && m.args[0] === 31));
    assertEquals(
      call.modifiers.filter((m) => m.method === 'order').map((m) => m.args[0]),
      ['published_at', 'id'],
    );
    assertEquals(body.posts.length, 30);
    assertEquals(body.nextCursor, `${rows[29].published_at}|${rows[29].id}`);
    assertEquals(
      db.calls.filter((c) => c.table === 'workflow_posts').length,
      1,
      'no older check in history mode',
    );
    assertEquals('olderCursor' in body, false);
  },
);

Deno.test('hub-posts history: last page has nextCursor null', async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [
    { ...basePost, id: 3, status: 'postado', published_at: '2026-01-01T10:00:00+00:00' },
  ]);
  const before = encodeURIComponent('2026-01-17T00:00:00.000Z|0');
  const body = await readJson(
    await hubPostsHandlerFor(db)(
      new Request(`https://example.test/hub-posts?token=hub-123&before=${before}`),
    ),
  );
  assertEquals(body.posts.length, 1);
  assertEquals(body.nextCursor, null);
});

Deno.test('hub-posts range: postado by scheduled_at in [from, to)', async () => {
  const db = createSupabaseQueryMock();
  // Published 60 days after its scheduled date: still in its scheduled month.
  queueHubPostsBase(db, [
    {
      ...basePost,
      id: 4,
      status: 'postado',
      scheduled_at: '2025-11-10T12:00:00.000Z',
      published_at: '2026-01-09T12:00:00+00:00',
    },
  ]);
  const url =
    'https://example.test/hub-posts?token=hub-123&from=2025-11-01T03:00:00.000Z&to=2025-12-01T03:00:00.000Z';
  const body = await readJson(await hubPostsHandlerFor(db)(new Request(url)));

  const call = db.calls.filter((c) => c.table === 'workflow_posts')[0];
  assert(
    call.modifiers.some(
      (m) =>
        m.method === 'gte' &&
        m.args[0] === 'scheduled_at' &&
        m.args[1] === '2025-11-01T03:00:00.000Z',
    ),
  );
  assert(
    call.modifiers.some(
      (m) =>
        m.method === 'lt' &&
        m.args[0] === 'scheduled_at' &&
        m.args[1] === '2025-12-01T03:00:00.000Z',
    ),
  );
  assert(
    call.modifiers.some(
      (m) => m.method === 'eq' && m.args[0] === 'status' && m.args[1] === 'postado',
    ),
  );
  assertEquals(
    body.posts.map((p: { id: number }) => p.id),
    [4],
  );
  assertEquals('olderCursor' in body || 'nextCursor' in body, false);
});

Deno.test("hub-posts post mode: returns a visible post, scoped to the token's client", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [{ ...basePost, id: 5061, status: 'postado' }]);
  const body = await readJson(
    await hubPostsHandlerFor(db)(
      new Request('https://example.test/hub-posts?token=hub-123&post_id=5061'),
    ),
  );
  const call = db.calls.filter((c) => c.table === 'workflow_posts')[0];
  assert(call.modifiers.some((m) => m.method === 'eq' && m.args[0] === 'id' && m.args[1] === 5061));
  assert(
    call.modifiers.some((m) => m.method === 'eq' && m.args[0] === 'cliente_id' && m.args[1] === 14),
  );
  assert(
    call.modifiers.some(
      (m) => m.method === 'eq' && m.args[0] === 'conta_id' && m.args[1] === 'conta-1',
    ),
  );
  assertEquals(
    body.posts.map((p: { id: number }) => p.id),
    [5061],
  );
});

Deno.test('hub-posts post mode: an em-produção post comes back', async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsBase(db, [{ ...basePost, id: 9, status: 'rascunho' }]);
  db.queue('post_status_events', 'select', {
    data: [
      {
        id: 1,
        post_id: 9,
        from_status: 'aprovado_interno',
        to_status: 'enviado_cliente',
        created_at: '2026-03-01T10:00:00.000Z',
      },
      {
        id: 2,
        post_id: 9,
        from_status: 'correcao_cliente',
        to_status: 'rascunho',
        created_at: '2026-03-02T10:00:00.000Z',
      },
    ],
    error: null,
  });
  const response = await hubPostsHandlerFor(db)(
    new Request('https://example.test/hub-posts?token=hub-123&post_id=9'),
  );
  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).posts[0].em_producao, 'correcao');
});

Deno.test(
  'hub-posts post mode: a never-sent draft, or a post outside the client, is 404',
  async () => {
    const draftDb = createSupabaseQueryMock();
    queueHubPostsBase(draftDb, [{ ...basePost, id: 9, status: 'rascunho' }]);
    const draft = await hubPostsHandlerFor(draftDb)(
      new Request('https://example.test/hub-posts?token=hub-123&post_id=9'),
    );
    assertEquals(draft.status, 404);
    assertEquals(await readJson(draft), { error: 'Post não encontrado.' });

    const otherDb = createSupabaseQueryMock();
    queueHubPostsBase(otherDb, []); // the conta/cliente filter matched nothing
    const other = await hubPostsHandlerFor(otherDb)(
      new Request('https://example.test/hub-posts?token=hub-123&post_id=1234'),
    );
    assertEquals(other.status, 404);
  },
);

Deno.test(
  'hub-posts rejects malformed or combined modes with 400 before reading posts',
  async () => {
    for (const qs of [
      'before=2026-01-01T00:00:00Z,status.neq.x|1',
      'post_id=abc',
      'post_id=1&before=2026-01-17T00:00:00.000Z|0',
      'from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z',
    ]) {
      const db = createSupabaseQueryMock();
      queueHubPostsBase(db, []);
      const response = await hubPostsHandlerFor(db)(
        new Request(`https://example.test/hub-posts?token=hub-123&${qs.replace('|', '%7C')}`),
      );
      assertEquals(response.status, 400, qs);
      assertEquals(await readJson(response), { error: 'Parâmetros inválidos.' });
      assertEquals(
        db.calls.some((c) => c.table === 'workflow_posts'),
        false,
        qs,
      );
    }
  },
);
```

- [ ] **Step 2: Run to verify failure**

Deno test command. Expected: the new tests FAIL (no `.or()`, no `olderCursor`, no 400/404). `git checkout deno.lock`.

- [ ] **Step 3: Implement the modes in the GET**

In `handler.ts` add:

```ts
import { cursorOf, HISTORY_PAGE_SIZE, parseGetMode, shellCutoff } from './modes.ts';
```

At the top of the GET section (right after the `if (req.method === "PATCH") {...}` block closes, before the "Every lookup below..." comment):

```ts
const mode = parseGetMode(url.searchParams);
if (!mode) return json({ error: 'Parâmetros inválidos.' }, 400);
const cutoff = shellCutoff(deps.now());
```

Replace the phase 1 `Promise.all` (posts, instagram_accounts, clientes) with:

```ts
// Spec: docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md. The shell holds
// every post still in flight plus published posts with either date inside the window;
// older published posts come through ?before= (Postagens) and ?from=&to= (calendar).
let postsQuery = db
  .from('workflow_posts')
  .select(
    'id, titulo, tipo, status, ordem, conteudo, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, tiktok_post_url, published_at, publish_error, platform, ig_trial_strategy, media_autocleaned_at, workflow_id, workflows(titulo, created_at)',
  )
  .eq('conta_id', hubToken.conta_id)
  .eq('cliente_id', hubToken.cliente_id);
if (mode.kind === 'shell') {
  postsQuery = postsQuery
    .or(`status.neq.postado,published_at.gte.${cutoff},scheduled_at.gte.${cutoff}`)
    .order('scheduled_at', { ascending: true });
} else if (mode.kind === 'history') {
  const { ts, id } = mode.before;
  postsQuery = postsQuery
    .eq('status', 'postado')
    .or(`published_at.lt.${ts},and(published_at.eq.${ts},id.lt.${id})`)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1);
} else if (mode.kind === 'range') {
  postsQuery = postsQuery
    .eq('status', 'postado')
    .gte('scheduled_at', mode.from)
    .lt('scheduled_at', mode.to)
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true });
} else {
  postsQuery = postsQuery.eq('id', mode.postId);
}

// Placed LAST in the array: the test mock dequeues workflow_posts in call order, and an
// unqueued select answers [] (read as "nothing older"). A non-empty array is the only
// "older exists" signal; never .maybeSingle() or a truthiness check on data.
const olderCheck =
  mode.kind === 'shell'
    ? db
        .from('workflow_posts')
        .select('id')
        .eq('conta_id', hubToken.conta_id)
        .eq('cliente_id', hubToken.cliente_id)
        .eq('status', 'postado')
        .lt('published_at', cutoff)
        .limit(1)
    : Promise.resolve({ data: [] as unknown[] });

const [{ data: rawPosts }, { data: igAccount }, { data: clienteRow }, { data: olderRows }] =
  await Promise.all([
    postsQuery,
    db
      .from('instagram_accounts')
      .select('username, profile_picture_url')
      .eq('client_id', hubToken.cliente_id)
      .maybeSingle(),
    db.from('clientes').select('auto_publish_on_approval').eq('id', hubToken.cliente_id).single(),
    olderCheck,
  ]);

let posts = (rawPosts ?? []) as any[];
let nextCursor: string | null = null;
if (mode.kind === 'history' && posts.length > HISTORY_PAGE_SIZE) {
  posts = posts.slice(0, HISTORY_PAGE_SIZE);
  nextCursor = cursorOf(posts[HISTORY_PAGE_SIZE - 1]);
}
const hasOlder = Array.isArray(olderRows) && olderRows.length > 0;
```

`warnIfCapped("workflow_posts", posts);` (from Task 2) stays right after this block. The rest of the handler keeps reading `posts`.

Replace the final `return json({...})` with:

```ts
if (mode.kind === 'post' && postsWithResolvedContent.length === 0) {
  return json({ error: 'Post não encontrado.' }, 404);
}

return json({
  posts: postsWithResolvedContent,
  postApprovals,
  propertyValues: ((propertyValues ?? []) as { post_id: number }[]).filter((v) =>
    visibleIds.has(v.post_id),
  ),
  workflowSelectOptions: ((workflowSelectOptions ?? []) as { workflow_id: number }[]).filter((o) =>
    visibleWorkflowIds.has(o.workflow_id),
  ),
  instagramProfile: igAccount
    ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
    : null,
  autoPublishOnApproval,
  autoPublishSuspendedWorkflowIds: autoPublishSuspendedWorkflowIds.filter((id) =>
    visibleWorkflowIds.has(id),
  ),
  autoPublishSuspendedPostIds: autoPublishSuspendedPostIds.filter((id) => visibleIds.has(id)),
  ...(mode.kind === 'shell'
    ? { olderCursor: hasOlder ? `${cutoff}|0` : null, historyCutoff: hasOlder ? cutoff : null }
    : {}),
  ...(mode.kind === 'history' ? { nextCursor } : {}),
});
```

- [ ] **Step 4: Run the whole hub suite**

Deno test command, then the modes test file. Expected: all PASS (existing shell tests keep passing: their older check dequeues the default `[]`). `git checkout deno.lock`.

- [ ] **Step 5: Type-check and commit**

```bash
npm run check:functions
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub): hub-posts limitado (90 dias) com páginas anteriores, intervalo e post único

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hub API, types and query helpers

**Files:**

- Modify: `apps/hub/src/types.ts:326-339` (`HubPostsResponse`)
- Modify: `apps/hub/src/api.ts` (after `fetchPosts`)
- Modify: `apps/hub/src/queries.ts`
- Create: `apps/hub/src/lib/mergeById.ts`
- Test: `apps/hub/src/__tests__/queries.test.tsx`, `apps/hub/src/lib/__tests__/mergeById.test.ts`

**Interfaces:**

- Produces:
  - `types.ts`: `HubPostsResponse` gains `olderCursor?: string | null; historyCutoff?: string | null; nextCursor?: string | null;`
  - `api.ts`: `fetchOlderPosts(token: string, before: string): Promise<HubPostsResponse>`, `fetchPostsInRange(token: string, from: string, to: string): Promise<HubPostsResponse>`, `fetchPost(token: string, postId: number): Promise<HubPostsResponse>`
  - `queries.ts`: `HUB_POSTS_KEY` (now exported), `hubPostsQuery(token)`, `hubPostQuery(token, postId)`, `hubPostsRangeQuery(token, from, to)`, `hubPostsHistoryKey(token, olderCursor)`, `invalidateHubPosts(qc, token): Promise<unknown>`, `HISTORY_RETRY = { retry: 1, retryDelay: 300 }`
  - `lib/mergeById.ts`: `mergeById<T extends { id: number }>(primary: T[], extra: T[]): T[]` (primary order first, then unseen extras in order; primary wins on duplicate ids)

- [ ] **Step 1: Write the failing tests**

`apps/hub/src/lib/__tests__/mergeById.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeById } from '../mergeById';

describe('mergeById', () => {
  it('keeps the primary copy on duplicate ids and appends unseen extras in order', () => {
    const primary = [
      { id: 1, v: 'shell' },
      { id: 2, v: 'shell' },
    ];
    const extra = [
      { id: 2, v: 'page' },
      { id: 3, v: 'page' },
      { id: 3, v: 'dup' },
    ];
    expect(mergeById(primary, extra)).toEqual([
      { id: 1, v: 'shell' },
      { id: 2, v: 'shell' },
      { id: 3, v: 'page' },
    ]);
  });

  it('returns the primary array itself when there is nothing extra', () => {
    const primary = [{ id: 1 }];
    expect(mergeById(primary, [])).toBe(primary);
  });
});
```

Append to `apps/hub/src/__tests__/queries.test.tsx` (extend its `vi.mock('../api', ...)` factory with `fetchOlderPosts: vi.fn(), fetchPostsInRange: vi.fn(), fetchPost: vi.fn()`, and import `useInfiniteQuery` from `@tanstack/react-query`, plus `fetchOlderPosts, fetchPostsInRange` from `'../api'` and `hubPostsHistoryKey, hubPostsQuery, hubPostsRangeQuery, invalidateHubPosts` from `'../queries'`):

```tsx
describe('invalidateHubPosts', () => {
  it('refetches the shell but only marks loaded history pages and range months stale', async () => {
    mockedFetchPosts.mockReset().mockResolvedValue({ posts: [] } as never);
    const olderMock = vi
      .mocked(fetchOlderPosts)
      .mockReset()
      .mockResolvedValue({ posts: [], nextCursor: null } as never);
    const rangeMock = vi
      .mocked(fetchPostsInRange)
      .mockReset()
      .mockResolvedValue({ posts: [] } as never);
    const qc = createHubQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(
      () => {
        useQuery(hubPostsQuery('tk'));
        useInfiniteQuery({
          queryKey: hubPostsHistoryKey('tk', 'c|0'),
          queryFn: ({ pageParam }) => fetchOlderPosts('tk', pageParam),
          initialPageParam: 'c|0',
          getNextPageParam: () => undefined,
        });
        useQuery(hubPostsRangeQuery('tk', '2025-11-01T03:00:00.000Z', '2025-12-01T03:00:00.000Z'));
      },
      { wrapper },
    );
    await waitFor(() => expect(rangeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(olderMock).toHaveBeenCalledTimes(1));

    await invalidateHubPosts(qc, 'tk');

    expect(mockedFetchPosts).toHaveBeenCalledTimes(2);
    expect(olderMock).toHaveBeenCalledTimes(1);
    expect(rangeMock).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(hubPostsHistoryKey('tk', 'c|0'))?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/hub/src/lib/__tests__/mergeById.test.ts apps/hub/src/__tests__/queries.test.tsx`
Expected: FAIL (missing modules/exports).

- [ ] **Step 3: Implement**

`apps/hub/src/lib/mergeById.ts`:

```ts
/** `primary` first (its copy wins on a duplicate id), then the unseen items of `extra` in order. */
export function mergeById<T extends { id: number }>(primary: T[], extra: T[]): T[] {
  if (extra.length === 0) return primary;
  const seen = new Set(primary.map((item) => item.id));
  const out = [...primary];
  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
```

`types.ts`, inside `HubPostsResponse` after `autoPublishSuspendedPostIds?`:

```ts
  /** Shell only: present when published posts older than the 90-day window exist. Opaque;
   * pass it back as `before`. Absent from older backends, which return everything. */
  olderCursor?: string | null;
  /** Shell only: the window's start (ISO). Calendar months starting before it need a range fetch. */
  historyCutoff?: string | null;
  /** History pages only: the next page's cursor, null on the last page. */
  nextCursor?: string | null;
```

`api.ts`, after `fetchPosts`:

```ts
export function fetchOlderPosts(token: string, before: string) {
  return get<HubPostsResponse>('hub-posts', { token, before });
}

export function fetchPostsInRange(token: string, from: string, to: string) {
  return get<HubPostsResponse>('hub-posts', { token, from, to });
}

export function fetchPost(token: string, postId: number) {
  return get<HubPostsResponse>('hub-posts', { token, post_id: String(postId) });
}
```

`queries.ts`: change the import to `import { fetchBootstrap, fetchPost, fetchPosts, fetchPostsInRange } from './api';`, export `HUB_POSTS_KEY`, and add (also make `prefetchHubShell` use `hubPostsQuery(token)` for its posts prefetch):

```ts
export const hubPostsQuery = (token: string) =>
  queryOptions({ queryKey: [HUB_POSTS_KEY, token], queryFn: () => fetchPosts(token) });

/** History and range fail fast: one retry, shown in about a second instead of ~7s. */
export const HISTORY_RETRY = { retry: 1, retryDelay: 300 } as const;

export const hubPostsHistoryKey = (token: string, olderCursor: string | null) =>
  [HUB_POSTS_KEY, token, 'history', olderCursor] as const;

export const hubPostsRangeQuery = (token: string, from: string, to: string) =>
  queryOptions({
    queryKey: [HUB_POSTS_KEY, token, 'range', from],
    queryFn: () => fetchPostsInRange(token, from, to),
    ...HISTORY_RETRY,
  });

// A 404 ("não disponível") is an answer, not a failure to retry.
export const hubPostQuery = (token: string, postId: number) =>
  queryOptions({
    queryKey: [HUB_POSTS_KEY, token, 'post', postId],
    queryFn: () => fetchPost(token, postId),
    retry: false,
  });

/**
 * After an approval or correction: refetch the shell and any open single post. History pages
 * and range months are published posts the action cannot change, so they are only marked
 * stale (refetching them would spend one hub-read hit per loaded page).
 */
export function invalidateHubPosts(qc: QueryClient, token: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token], exact: true }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'post'] }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'history'], refetchType: 'none' }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'range'], refetchType: 'none' }),
  ]);
}
```

- [ ] **Step 4: Run to verify pass**

Same vitest command. Expected: PASS (the existing `prefetchHubShell` tests still pass).

- [ ] **Step 5: Commit**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/queries.ts apps/hub/src/lib/mergeById.ts apps/hub/src/lib/__tests__/mergeById.test.ts apps/hub/src/__tests__/queries.test.tsx
git commit -m "feat(hub): API e queries para páginas anteriores, intervalo e post único

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `useHubPosts` hook

**Files:**

- Create: `apps/hub/src/hooks/useHubPosts.ts`
- Test: `apps/hub/src/hooks/__tests__/useHubPosts.test.tsx`

**Interfaces:**

- Consumes: `hubPostsQuery`, `hubPostsHistoryKey`, `HISTORY_RETRY` (Task 6), `fetchOlderPosts`, `mergeById`.
- Produces:

```ts
export interface UseHubPostsResult {
  data: HubPostsResponse | undefined; // the shell response
  posts: HubPost[]; // shell + history pages, shell wins
  postApprovals: PostApproval[]; // shell + history pages, by approval id
  isLoading: boolean;
  isError: boolean;
  loadOlder: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
}
export function useHubPosts(
  token: string,
  opts?: {
    history?: boolean;
    refetchInterval?: UseQueryOptions<HubPostsResponse>['refetchInterval'];
  },
): UseHubPostsResult;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchOlderPosts: vi.fn() }));

import { fetchOlderPosts, fetchPosts } from '../../api';
import { useHubPosts } from '../useHubPosts';

const shellPost = (id: number) => ({ id, status: 'enviado_cliente', titulo: `S${id}` });
const oldPost = (id: number) => ({ id, status: 'postado', titulo: `O${id}` });
const approval = (id: number, post_id: number) => ({ id, post_id, action: 'aprovado' });

const posts = vi.mocked(fetchPosts);
const older = vi.mocked(fetchOlderPosts);

function setup(shell: Record<string, unknown>) {
  posts.mockResolvedValue(shell as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useHubPosts('tk', { history: true }), { wrapper }) };
}

describe('useHubPosts', () => {
  beforeEach(() => {
    posts.mockReset();
    older.mockReset();
  });

  it('makes no history request on mount, even with an olderCursor', async () => {
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.hasOlder).toBe(true);
    expect(older).not.toHaveBeenCalled();
  });

  it('loads pages on demand and merges posts and approvals, the shell winning', async () => {
    older
      .mockResolvedValueOnce({
        posts: [oldPost(1), oldPost(2)],
        postApprovals: [approval(20, 2)],
        nextCursor: 'n|2',
      } as never)
      .mockResolvedValueOnce({ posts: [oldPost(3)], postApprovals: [], nextCursor: null } as never);
    const { result } = setup({
      posts: [shellPost(1)],
      postApprovals: [approval(10, 1)],
      olderCursor: 'c|0',
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2]));
    expect(older).toHaveBeenLastCalledWith('tk', 'c|0');
    expect(result.current.posts[0].titulo).toBe('S1');
    expect(result.current.postApprovals.map((a) => a.id)).toEqual([10, 20]);
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2, 3]));
    expect(older).toHaveBeenLastCalledWith('tk', 'n|2');
    expect(result.current.hasOlder).toBe(false);
  });

  it('keeps hasOlder after a failed first page and retries on the next loadOlder', async () => {
    older
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ posts: [oldPost(2)], postApprovals: [], nextCursor: null } as never);
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.olderError).toBe(true), { timeout: 3000 });
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2]));
    expect(result.current.olderError).toBe(false);
  });

  it('treats a response without olderCursor (old backend) as complete', async () => {
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasOlder).toBe(false);
    act(() => result.current.loadOlder());
    expect(older).not.toHaveBeenCalled();
  });

  it('starts a fresh history when the shell comes back with a new cursor', async () => {
    older.mockResolvedValue({ posts: [oldPost(2)], postApprovals: [], nextCursor: null } as never);
    const { result, qc } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts).toHaveLength(2));

    posts.mockResolvedValue({
      posts: [shellPost(1)],
      postApprovals: [],
      olderCursor: 'd|0',
    } as never);
    await act(() => qc.refetchQueries({ queryKey: ['hub-posts', 'tk'], exact: true }));

    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(older).toHaveBeenLastCalledWith('tk', 'd|0'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/hub/src/hooks/__tests__/useHubPosts.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { fetchOlderPosts } from '../api';
import { HISTORY_RETRY, hubPostsHistoryKey, hubPostsQuery } from '../queries';
import { mergeById } from '../lib/mergeById';
import type { HubPost, HubPostsResponse, PostApproval } from '../types';

export interface UseHubPostsResult {
  data: HubPostsResponse | undefined;
  posts: HubPost[];
  postApprovals: PostApproval[];
  isLoading: boolean;
  isError: boolean;
  loadOlder: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
}

/**
 * The bounded shell (every in-flight post plus the last 90 days of published ones) and,
 * with `history`, older published posts loaded on demand with "Carregar posts anteriores".
 * Spec: docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md
 */
export function useHubPosts(
  token: string,
  opts: {
    history?: boolean;
    refetchInterval?: UseQueryOptions<HubPostsResponse>['refetchInterval'];
  } = {},
): UseHubPostsResult {
  const shell = useQuery({ ...hubPostsQuery(token), refetchInterval: opts.refetchInterval });
  const olderCursor = shell.data?.olderCursor ?? null;

  // useInfiniteQuery fetches its first page the moment it is enabled, so it stays disabled
  // until the client asks. Tracking WHICH cursor was started also resets history when the
  // shell rolls over to a new day's cursor (the key includes it, so that is a fresh query).
  const [startedCursor, setStartedCursor] = useState<string | null>(null);
  const historyEnabled = !!opts.history && olderCursor !== null && startedCursor === olderCursor;

  const history = useInfiniteQuery({
    queryKey: hubPostsHistoryKey(token, olderCursor),
    queryFn: ({ pageParam }) => fetchOlderPosts(token, pageParam),
    initialPageParam: olderCursor ?? '',
    getNextPageParam: (page: HubPostsResponse) => page.nextCursor ?? undefined,
    enabled: historyEnabled,
    ...HISTORY_RETRY,
  });

  const historyData = historyEnabled ? history.data : undefined;
  const hasOlder =
    olderCursor !== null &&
    (historyData === undefined ? true : history.hasNextPage || history.isFetchNextPageError);

  const loadOlder = useCallback(() => {
    if (olderCursor === null || history.isFetching) return;
    if (startedCursor !== olderCursor) {
      setStartedCursor(olderCursor); // enabling the query fetches the first page
      return;
    }
    if (history.data === undefined) {
      void history.refetch();
      return;
    }
    if (history.hasNextPage || history.isFetchNextPageError) void history.fetchNextPage();
  }, [olderCursor, startedCursor, history]);

  const pages = historyData?.pages;
  const posts = useMemo(
    () => mergeById(shell.data?.posts ?? [], pages?.flatMap((p) => p.posts) ?? []),
    [shell.data?.posts, pages],
  );
  const postApprovals = useMemo(
    () => mergeById(shell.data?.postApprovals ?? [], pages?.flatMap((p) => p.postApprovals) ?? []),
    [shell.data?.postApprovals, pages],
  );

  return {
    data: shell.data,
    posts,
    postApprovals,
    isLoading: shell.isLoading,
    isError: shell.isError,
    loadOlder,
    hasOlder,
    isLoadingOlder: historyEnabled && history.isFetching,
    olderError: historyEnabled && (history.isError || history.isFetchNextPageError),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Same command. Expected: PASS. If the failed-first-page test times out, check that `HISTORY_RETRY.retryDelay` is 300 and the hook spreads it after `enabled`.

Known tsc fallback: if `npx tsc -p apps/hub/tsconfig.json --noEmit` rejects `UseQueryOptions<HubPostsResponse>['refetchInterval']` spread into `hubPostsQuery(token)` (query-key generic mismatch), type the option as `refetchInterval?: (query: { state: { data?: HubPostsResponse } }) => number | false` instead; PostagensPage's callback fits both.

- [ ] **Step 5: Commit**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/hub/src/hooks/useHubPosts.ts apps/hub/src/hooks/__tests__/useHubPosts.test.tsx
git commit -m "feat(hub): useHubPosts junta o shell com as páginas anteriores sob demanda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Postagens: merged lists, "Carregar posts anteriores", deep-link fallback

**Files:**

- Modify: `apps/hub/src/pages/PostagensPage.tsx`
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx` (new optional `standalone` prop)
- Modify: `packages/i18n/locales/pt/hubPosts.json`, `packages/i18n/locales/en/hubPosts.json` (keys under `postagens`)
- Test: `apps/hub/src/pages/__tests__/postagensPage.test.tsx`

**Interfaces:**

- Consumes: `useHubPosts` (Task 7), `hubPostQuery`, `invalidateHubPosts` (Task 6).
- Produces: `PostDetailDialogProps.standalone?: boolean` (hides the "X de Y" counter and the prev/next arrows, which otherwise render disabled for a one-post list).

- [ ] **Step 1: Add the strings**

In `packages/i18n/locales/pt/hubPosts.json` inside `"postagens"` (after `"noResults"`):

```json
    "emptyRecent": "Nenhuma postagem recente.",
    "loadOlder": "Carregar posts anteriores",
    "loadingOlder": "Carregando…",
    "olderError": "Não foi possível carregar os posts anteriores.",
    "retryOlder": "Tentar novamente",
```

In `packages/i18n/locales/en/hubPosts.json` inside `"postagens"`:

```json
    "emptyRecent": "No recent posts.",
    "loadOlder": "Load older posts",
    "loadingOlder": "Loading…",
    "olderError": "Couldn't load older posts.",
    "retryOlder": "Try again",
```

- [ ] **Step 2: Write the failing tests**

In `postagensPage.test.tsx`, extend the `vi.mock('../../api', ...)` factory with `fetchOlderPosts: vi.fn(), fetchPost: vi.fn(),`, import them, and add `const mockedFetchOlderPosts = vi.mocked(fetchOlderPosts); const mockedFetchPost = vi.mocked(fetchPost);`. In the file's `beforeEach` (create one at the top of `describe('PostagensPage')` if absent) add `mockedFetchOlderPosts.mockReset(); mockedFetchPost.mockReset();`.

Replace the body of `'deep link to an unknown or internal post shows notAvailable'` with:

```tsx
mockedFetchPost.mockRejectedValue(new Error('Post não encontrado.'));
renderPage(`${BASE}/999`, response({ posts: [post({ id: 1 })] }));
expect(await screen.findByText('Esta postagem não está disponível.')).toBeInTheDocument();
expect(mockedFetchPost).toHaveBeenCalledWith('token-publico', 999);
```

Add:

```tsx
it('an empty shell with older history shows the load button, which appends older posts', async () => {
  mockedFetchOlderPosts.mockResolvedValue(
    response({
      posts: [
        post({
          id: 7,
          titulo: 'Post antigo',
          status: 'postado',
          published_at: '2026-01-01T10:00:00+00:00',
        }),
      ],
      nextCursor: null,
    }),
  );
  renderPage(BASE, response({ posts: [], olderCursor: '2026-07-04T00:00:00.000Z|0' }));

  expect(await screen.findByText('Nenhuma postagem recente.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Carregar posts anteriores' }));

  expect(await screen.findByText('Post antigo')).toBeInTheDocument();
  expect(mockedFetchOlderPosts).toHaveBeenCalledWith('token-publico', '2026-07-04T00:00:00.000Z|0');
  expect(
    screen.queryByRole('button', { name: 'Carregar posts anteriores' }),
  ).not.toBeInTheDocument();
});

it('shows no load button without an olderCursor', async () => {
  renderPage(BASE, response({ posts: [post({ id: 1 })] }));
  expect(await screen.findByText('Post padrão')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Carregar posts anteriores' }),
  ).not.toBeInTheDocument();
});

it('keeps the button as Tentar novamente after a failed page', async () => {
  mockedFetchOlderPosts.mockRejectedValue(new Error('x'));
  renderPage(BASE, response({ posts: [post({ id: 1 })], olderCursor: 'c|0' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Carregar posts anteriores' }));
  expect(
    await screen.findByRole('button', { name: 'Tentar novamente' }, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect(screen.getByText('Não foi possível carregar os posts anteriores.')).toBeInTheDocument();
});

it('a deep link outside the loaded posts opens the single post without a counter', async () => {
  mockedFetchPost.mockResolvedValue(
    response({ posts: [post({ id: 5061, titulo: 'Post de março', status: 'postado' })] }),
  );
  renderPage(`${BASE}/5061`, response({ posts: [post({ id: 1 })] }));
  expect(await screen.findByRole('heading', { name: 'Post de março' })).toBeInTheDocument();
  expect(screen.queryByText('1 de 1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Post anterior' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Próximo post' })).not.toBeInTheDocument();
  expect(screen.queryByText('Esta postagem não está disponível.')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run apps/hub/src/pages/__tests__/postagensPage.test.tsx`
Expected: the four new/changed tests FAIL.

- [ ] **Step 4: `standalone` on PostDetailDialog**

In `PostDetailDialogProps` add:

```ts
  /** Opened from outside the list (deep link to an older post): no "X de Y" counter. */
  standalone?: boolean;
```

`ContentProps` already extends `PostDetailDialogProps`; destructure `standalone` in the content component's props next to `posts`. Wrap BOTH counter renderings (the `<span className="absolute top-3 left-3 ...">` around line 653 and the `{singleColumn && (<span className="text-[12px] hub-tx3">` around line 680) so they render only when `!standalone`; for the second: `{singleColumn && !standalone && (`.
The arrows come from `navButton('prev')` / `navButton('next')` (a `<button disabled={!target || navLocked}>`, so with one post they still render, disabled): render both only when `!standalone`: around line 631 `{!ghost && navButton('prev')}` / `{!ghost && navButton('next')}` become `{!ghost && !standalone && navButton('prev')}` / `{!ghost && !standalone && navButton('next')}`.

- [ ] **Step 5: Rewire PostagensPage**

1. Imports: replace `import { useQuery, useQueryClient } from '@tanstack/react-query';` with `import { useQuery, useQueryClient } from '@tanstack/react-query';` (unchanged) and replace `import { fetchPosts, fetchInstagramFeed } from '../api';` with `import { fetchInstagramFeed } from '../api';`. Add `import { useHubPosts } from '../hooks/useHubPosts';` and `import { hubPostQuery, invalidateHubPosts } from '../queries';`.

2. Replace the `useQuery({ queryKey: ['hub-posts', token], ... refetchInterval ... })` call with:

```tsx
const {
  data,
  posts,
  postApprovals,
  isLoading,
  isError,
  loadOlder,
  hasOlder,
  isLoadingOlder,
  olderError,
} = useHubPosts(token, {
  history: true,
  // Poll while a post is mid-publishing so the client sees it flip to "Publicado".
  refetchInterval: (query) =>
    (query.state.data?.posts ?? []).some((p) => getPostPublishState(p) === 'publicando')
      ? 15000
      : false,
});
```

3. `allVisible`: `sortPostsNewestFirst((data?.posts ?? []).filter(isPostClientVisible))` becomes `sortPostsNewestFirst(posts.filter(isPostClientVisible))` with deps `[posts]`.

4. `const approvals = data?.postApprovals ?? [];` becomes `const approvals = postApprovals;`.

5. `selectedPosts`: `(data?.posts ?? []).filter(` becomes `posts.filter(` with deps `[posts, selectedIds]`.

6. `handleInvalidate`: body becomes `() => invalidateHubPosts(qc, token)`.

7. Deep-link fallback, after `allVisible`:

```tsx
// A deep link (share link, message chip, calendar) can point at a post older than what is
// loaded: fetch just that post. 404 leaves the dialog's "não disponível" branch.
const wantsSingle =
  !isLoading &&
  !fatalError &&
  currentId !== null &&
  currentId > 0 &&
  !allVisible.some((p) => p.id === currentId);
const single = useQuery({ ...hubPostQuery(token, currentId ?? 0), enabled: wantsSingle });
const singlePost = wantsSingle ? single.data?.posts.find((p) => p.id === currentId) : undefined;
```

8. The empty branch: `t('postagens.empty', 'Nenhuma postagem disponível ainda.')` becomes

```tsx
{
  hasOlder
    ? t('postagens.emptyRecent', 'Nenhuma postagem recente.')
    : t('postagens.empty', 'Nenhuma postagem disponível ainda.');
}
```

9. Directly before `{!isLoading && !fatalError && (<PostDetailDialog`, add the load button (outside the grid/empty/noResults branches so it always shows when there is older history):

```tsx
{
  !isLoading && !fatalError && hasOlder && (
    <div className="hub-fade-up flex flex-col items-center gap-2 py-6">
      {olderError && !isLoadingOlder && (
        <p className="text-[13px] hub-tx2">
          {t('postagens.olderError', 'Não foi possível carregar os posts anteriores.')}
        </p>
      )}
      <button
        type="button"
        onClick={loadOlder}
        disabled={isLoadingOlder}
        className="hub-btn-secondary rounded-[4px] px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {isLoadingOlder
          ? t('postagens.loadingOlder', 'Carregando…')
          : olderError
            ? t('postagens.retryOlder', 'Tentar novamente')
            : t('postagens.loadOlder', 'Carregar posts anteriores')}
      </button>
    </div>
  );
}
```

10. The dialog mount: change `{!isLoading && !fatalError && (` to `{!isLoading && !fatalError && !(wantsSingle && single.isPending) && (` and its props:

```tsx
          posts={singlePost ? [singlePost] : visiblePosts}
          approvals={singlePost ? (single.data?.postApprovals ?? []) : approvals}
          standalone={!!singlePost}
```

(`fatalError` is still `isError && data === undefined`.)

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run apps/hub/src/pages/__tests__/postagensPage.test.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/hub/src/pages/PostagensPage.tsx apps/hub/src/components/posts/PostDetailDialog.tsx packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json apps/hub/src/pages/__tests__/postagensPage.test.tsx
git commit -m "feat(hub): Postagens carrega posts anteriores sob demanda e abre links antigos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Home calendar fetches older months by range

**Files:**

- Modify: `apps/hub/src/components/PostCalendar.tsx` (props `onMonthChange`, `loading`, `notice`)
- Modify: `apps/hub/src/lib/postView.ts` (add `localMonthRange`)
- Modify: `apps/hub/src/pages/HomePage.tsx`
- Modify: `packages/i18n/locales/pt/hubHome.json`, `packages/i18n/locales/en/hubHome.json` (keys under `calendar`)
- Test: `apps/hub/src/components/__tests__/PostCalendar.test.tsx`, `apps/hub/src/lib/__tests__/localMonthRange.test.ts`, create `apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx`

**Interfaces:**

- Consumes: `hubPostsQuery`, `hubPostsRangeQuery` (Task 6), `mergeById`.
- Produces: `localMonthRange(year: number, month: number): { from: string; to: string }` in `postView.ts`; `PostCalendar` props `onMonthChange?: (year: number, month: number) => void; loading?: boolean; notice?: ReactNode`.

- [ ] **Step 1: Strings**

`packages/i18n/locales/pt/hubHome.json`, inside `"calendar"`:

```json
    "rangeError": "Não foi possível carregar este mês.",
    "rangeRetry": "Tentar novamente",
```

`packages/i18n/locales/en/hubHome.json`, inside `"calendar"`:

```json
    "rangeError": "Couldn't load this month.",
    "rangeRetry": "Try again",
```

- [ ] **Step 2: Write the failing tests**

`apps/hub/src/lib/__tests__/localMonthRange.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { localMonthRange } from '../postView';

describe('localMonthRange', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('returns the local month boundaries as ISO instants', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(localMonthRange(2025, 10)).toEqual({
      from: '2025-11-01T03:00:00.000Z',
      to: '2025-12-01T03:00:00.000Z',
    });
    expect(localMonthRange(2025, 11).to).toBe('2026-01-01T03:00:00.000Z');
  });
});
```

Append to `PostCalendar.test.tsx` inside `describe('PostCalendar')`:

```tsx
it('reports the shown month on mount and on navigation, and renders loading and notice', () => {
  vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
  const onMonthChange = vi.fn();
  render(<PostCalendar posts={[]} onMonthChange={onMonthChange} loading notice={<p>aviso</p>} />);
  expect(onMonthChange).toHaveBeenLastCalledWith(2026, 3);
  fireEvent.click(screen.getAllByRole('button', { name: 'Mês anterior' })[0]);
  expect(onMonthChange).toHaveBeenLastCalledWith(2026, 2);
  expect(screen.getByTestId('post-calendar-grid')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('aviso')).toBeInTheDocument();
});
```

`apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchPostsInRange: vi.fn() }));
vi.mock('../../components/dashboard/DashboardSection', () => ({ DashboardSection: () => null }));
// The fake calendar exposes what Home passes and lets the test pick the shown month.
vi.mock('../../components/PostCalendar', () => ({
  PostCalendar: (props: {
    posts: Array<{ titulo: string }>;
    onMonthChange?: (y: number, m: number) => void;
    loading?: boolean;
    notice?: React.ReactNode;
  }) => (
    <div>
      <span>Cal: {props.posts.map((p) => p.titulo).join(', ')}</span>
      {props.loading && <span>carregando-mes</span>}
      {props.notice}
      <button onClick={() => props.onMonthChange?.(2025, 10)}>nov-2025</button>
      <button onClick={() => props.onMonthChange?.(2026, 8)}>set-2026</button>
    </div>
  ),
}));

import { fetchPosts, fetchPostsInRange } from '../../api';
import { localMonthRange } from '../../lib/postView';
import { HomePage } from '../HomePage';

const posts = vi.mocked(fetchPosts);
const range = vi.mocked(fetchPostsInRange);
const hubValue = {
  bootstrap: {
    workspace: { name: 'M', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'Ana',
    cliente_foto_url: null,
    is_active: true,
    cliente_id: 14,
  },
  token: 'tk',
  workspace: 'mesaas',
} as never;

const p = (id: number, titulo: string, status = 'agendado') => ({
  id,
  titulo,
  status,
  scheduled_at: '2026-09-10T10:00:00.000Z',
});

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={['/mesaas/hub/tk']}>
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Home calendar range', () => {
  beforeEach(() => {
    posts.mockReset();
    range.mockReset();
  });

  it('fetches a month that starts before historyCutoff once, by its local bounds, and merges it', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
      olderCursor: 'x|0',
    } as never);
    range.mockResolvedValue({
      posts: [p(2, 'Antigo', 'postado'), p(1, 'Recente')],
      postApprovals: [],
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(await screen.findByText('Cal: Recente, Antigo')).toBeInTheDocument();
    const { from, to } = localMonthRange(2025, 10);
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith('tk', from, to);
  });

  it('does not fetch a month that starts after the cutoff', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('set-2026'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('does not fetch any month when historyCutoff is null (or absent: old backend)', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: null,
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('shows the shell posts and a retry when a month fails', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    range.mockRejectedValue(new Error('x'));
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(
      await screen.findByText('Não foi possível carregar este mês.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cal: Recente')).toBeInTheDocument();
    range.mockResolvedValue({ posts: [p(2, 'Antigo', 'postado')], postApprovals: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Cal: Recente, Antigo')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run apps/hub/src/lib/__tests__/localMonthRange.test.ts apps/hub/src/components/__tests__/PostCalendar.test.tsx apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx`
Expected: FAIL.

- [ ] **Step 4: `localMonthRange`**

Append to `apps/hub/src/lib/postView.ts`:

```ts
/** The local calendar month [first instant, first instant of next month), as ISO strings:
 * the same local-day bucketing PostCalendar uses to place posts. */
export function localMonthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(year, month, 1).toISOString(),
    to: new Date(year, month + 1, 1).toISOString(),
  };
}
```

- [ ] **Step 5: PostCalendar props**

Change `import { useState } from 'react';` to `import { useEffect, useState, type ReactNode } from 'react';`. Props:

```ts
interface Props {
  posts: HubPost[];
  /** Called with the shown month on mount and on every navigation. */
  onMonthChange?: (year: number, month: number) => void;
  /** The shown month's older posts are still loading. */
  loading?: boolean;
  /** Rendered under the header (e.g. a failed-month notice with a retry). */
  notice?: ReactNode;
}
```

Signature: `export function PostCalendar({ posts, onMonthChange, loading, notice }: Props) {`. After the `useState` lines:

```ts
useEffect(() => {
  onMonthChange?.(year, month);
}, [year, month, onMonthChange]);
```

Render `{notice}` right after the desktop header block (the `<div className="hidden md:flex items-center justify-between mb-5">...</div>`). On the day grid, `<div className="grid grid-cols-7 gap-x-0 gap-y-0.5 md:gap-1.5">` (right under the `{/* Day grid */}` comment), add `data-testid="post-calendar-grid"`, `aria-busy={loading ? 'true' : undefined}` and append `${loading ? ' opacity-60 transition-opacity' : ''}` to its `className`.

- [ ] **Step 6: HomePage**

Imports: `useCallback, useMemo, useState` from `react`; replace `import { useQuery } from '@tanstack/react-query';` (keep) and `import { fetchPosts } from '../api';` with `import { hubPostsQuery, hubPostsRangeQuery } from '../queries';`, `import { mergeById } from '../lib/mergeById';`, and add `localMonthRange` to the `../lib/postView` import.

Replace `const { data, isLoading } = useQuery({ queryKey: ['hub-posts', token], queryFn: () => fetchPosts(token) });` with `const { data, isLoading } = useQuery(hubPostsQuery(token));`. Below the existing `const posts = allPosts.filter(...)` line add:

```tsx
// Months that start before the shell's window are fetched on demand by scheduled_at range
// (the shell holds every post scheduled after the cutoff, so later months are complete).
const [shown, setShown] = useState<{ year: number; month: number } | null>(null);
const handleMonthChange = useCallback(
  (year: number, month: number) => setShown({ year, month }),
  [],
);
const historyCutoff = data?.historyCutoff ?? null;
const monthRange = shown ? localMonthRange(shown.year, shown.month) : null;
const needsRange =
  monthRange !== null &&
  historyCutoff !== null &&
  Date.parse(monthRange.from) < Date.parse(historyCutoff);
const rangeQuery = useQuery({
  ...hubPostsRangeQuery(token, monthRange?.from ?? '', monthRange?.to ?? ''),
  enabled: needsRange,
});
const calendarPosts = useMemo(
  () =>
    mergeById(posts, needsRange ? (rangeQuery.data?.posts ?? []) : []).filter(
      (p) => CALENDAR_STATUSES.has(p.status) || isInProduction(p),
    ),
  [posts, needsRange, rangeQuery.data?.posts],
);
```

Replace `<PostCalendar posts={posts} />` with:

```tsx
<PostCalendar
  posts={calendarPosts}
  onMonthChange={handleMonthChange}
  loading={needsRange && rangeQuery.isFetching}
  notice={
    needsRange && rangeQuery.isError && !rangeQuery.isFetching ? (
      <p className="mb-3 flex items-center gap-2 text-[12.5px] hub-tx2">
        {t('calendar.rangeError', 'Não foi possível carregar este mês.')}
        <button
          type="button"
          onClick={() => void rangeQuery.refetch()}
          className="font-semibold underline"
        >
          {t('calendar.rangeRetry', 'Tentar novamente')}
        </button>
      </p>
    ) : null
  }
/>
```

KPIs keep reading `allPosts` (the shell): unchanged.

- [ ] **Step 7: Run to verify pass**

Run the Step 3 command plus `npx vitest run apps/hub/src/pages/__tests__/contentPages.test.tsx` (its PostCalendar mock ignores the new props; its `fetchPosts` mock still resolves the shell). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/hub/src/components/PostCalendar.tsx apps/hub/src/lib/postView.ts apps/hub/src/pages/HomePage.tsx packages/i18n/locales/pt/hubHome.json packages/i18n/locales/en/hubHome.json apps/hub/src/components/__tests__/PostCalendar.test.tsx apps/hub/src/lib/__tests__/localMonthRange.test.ts apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx
git commit -m "feat(hub): calendário da Home busca meses antigos por intervalo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Aprovações invalidation and the message-chip fallback

**Files:**

- Modify: `apps/hub/src/pages/AprovacoesPage.tsx:146-149`
- Modify: `apps/hub/src/components/HubPostChip.tsx`
- Modify: `apps/hub/src/hooks/usePendingApprovalsCount.ts`
- Test: create `apps/hub/src/components/__tests__/HubPostChip.test.tsx`

**Interfaces:**

- Consumes: `hubPostsQuery`, `hubPostQuery`, `invalidateHubPosts` (Task 6).

- [ ] **Step 1: Write the failing test**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchPost: vi.fn() }));

import { fetchPost, fetchPosts } from '../../api';
import { HubPostChip } from '../HubPostChip';

const shell = vi.mocked(fetchPosts);
const single = vi.mocked(fetchPost);
const post = (id: number, titulo: string) => ({
  id,
  titulo,
  tipo: 'feed',
  status: 'postado',
  media: [],
  workflow_titulo: 'Fluxo',
});

function renderChip(postId: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HubPostChip postId={postId} titulo="Chip" base="/m/hub/tk" token="tk" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function hover() {
  // The hover handlers sit on the wrapper span around the link.
  fireEvent.mouseEnter(screen.getByRole('link').parentElement!);
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe('HubPostChip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    shell.mockReset();
    single.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('previews from the shell without a single-post request', async () => {
    shell.mockResolvedValue({ posts: [post(1, 'No shell')], postApprovals: [] } as never);
    renderChip(1);
    await hover();
    expect(await screen.findByTestId('hub-post-hover-preview')).toHaveTextContent('No shell');
    expect(single).not.toHaveBeenCalled();
  });

  it('falls back to the single post for an id outside the shell', async () => {
    shell.mockResolvedValue({ posts: [post(1, 'No shell')], postApprovals: [] } as never);
    single.mockResolvedValue({ posts: [post(77, 'Post antigo')], postApprovals: [] } as never);
    renderChip(77);
    await hover();
    expect(await screen.findByTestId('hub-post-hover-preview')).toHaveTextContent('Post antigo');
    expect(single).toHaveBeenCalledWith('tk', 77);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/hub/src/components/__tests__/HubPostChip.test.tsx`
Expected: the fallback test FAILS (no preview for id 77).

- [ ] **Step 3: Implement**

`HubPostChip.tsx`: replace `import { fetchPosts } from '../api';` with `import { hubPostQuery, hubPostsQuery } from '../queries';`, update the doc comment above the component to say the preview falls back to a single-post fetch for posts outside the cached shell, and replace the `useQuery` call plus the `const post = ...` line with:

```tsx
const { data } = useQuery({ ...hubPostsQuery(token), enabled: open });
const fromShell = data?.posts.find((p) => p.id === postId);
// Message chips can point at posts older than the shell: fetch just that one, only while
// the card is open (at most one hub-read hit per post per staleTime).
const { data: singleData } = useQuery({
  ...hubPostQuery(token, postId),
  enabled: open && data !== undefined && !fromShell,
});
const post = open ? (fromShell ?? singleData?.posts.find((p) => p.id === postId)) : undefined;
```

`AprovacoesPage.tsx`: add `import { invalidateHubPosts } from '../queries';` and change `handleInvalidate` to:

```tsx
const handleInvalidate = useCallback(() => invalidateHubPosts(qc, token), [qc, token]);
```

`usePendingApprovalsCount.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { hubPostsQuery } from '../queries';

// Every enviado_cliente post is in the bounded shell, whatever its date.
export function usePendingApprovalsCount(token: string): number {
  const { data } = useQuery(hubPostsQuery(token));
  return (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/hub/src/components/__tests__/HubPostChip.test.tsx apps/hub/src/hooks/__tests__/usePendingApprovalsCount.test.tsx apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/pages/__tests__/mensagensPage.test.tsx`
Expected: PASS. If `usePendingApprovalsCount.test.tsx` or `mensagensPage.test.tsx` mocks `../api` without the new functions and fails on import, add `fetchPost: vi.fn()` to that mock.

- [ ] **Step 5: Commit**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/hub/src/components/HubPostChip.tsx apps/hub/src/components/__tests__/HubPostChip.test.tsx apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/hooks/usePendingApprovalsCount.ts
git commit -m "feat(hub): chips de mensagem buscam o post antigo e invalidação poupa o histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Gate, PR, merge frontend, then deploy (reversed order)

The new frontend works against the old backend (no `olderCursor`/`historyCutoff`, and `post_id` is ignored but `posts.find(id)` still finds the post in the full list), so it merges first. The function deploys after.

- [ ] **Step 1: Full gate**

Run every command in the pre-push gate. Then `git checkout deno.lock` and the `npm ci` check.

- [ ] **Step 2: Old-backend smoke in the browser**

`.claude/launch.json` (temporary, do not commit): add `{ "name": "hub-env", "runtimeExecutable": "node", "runtimeArgs": ["scripts/with-env.mjs", "npm", "run", "dev:hub"], "port": 5175 }` and start it with `preview_start({name: "hub-env"})`. Against PROD (old function still deployed), open `/dk-marketing-medico/hub/8381033c-520a-4614-a67d-ac5fbb2af11a/postagens` and `/postagens/5061`: the list renders, no "Carregar posts anteriores" button, the deep link opens, no console errors.

- [ ] **Step 3: Push, PR, merge**

```bash
git push -u origin claude/hub-posts-bounded-modes
gh pr create --title "perf(hub): hub-posts limitado a 90 dias com posts anteriores sob demanda" --body "$(cat <<'EOF'
Segundo PR do spec docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md.

- hub-posts devolve tudo o que está em andamento mais os publicados dos últimos 90 dias; modos novos: `?before=` (páginas de 30 publicados mais antigos), `?from=&to=` (mês do calendário por data agendada) e `?post_id=` (post único, 404 para rascunho nunca enviado).
- Postagens ganha "Carregar posts anteriores" (aparece mesmo sem posts recentes); links antigos abrem pelo post único; o calendário da Home busca meses antigos por intervalo; chips de mensagem buscam o post antigo no hover.
- Aprovar/pedir correção refaz só o shell; páginas antigas ficam marcadas como velhas.

Ordem de deploy invertida: este frontend funciona com o backend atual, então o merge vem antes e o deploy de hub-posts (staging, smoke, prod) logo depois.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

CI green (check `e2e-secrets-guard`), then `gh pr merge <n> --squash`.

- [ ] **Step 4: Deploy the function from fresh main**

```bash
git fetch -q origin && git switch --detach origin/main
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-posts --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

Smoke prod (from the main checkout for `.env`):

```bash
cd /Users/eduardosouza/projects/sm-crm && set -a && . ./.env && set +a
T=8381033c-520a-4614-a67d-ac5fbb2af11a; B="$VITE_SUPABASE_URL/functions/v1/hub-posts?token=$T"; H="apikey: $VITE_SUPABASE_ANON_KEY"
curl -s -H "$H" "$B" | python3 -c "import sys,json; d=json.load(sys.stdin); print('shell', len(d['posts']), d.get('olderCursor'), d.get('historyCutoff'))"
curl -s -H "$H" "$B&post_id=5061" | python3 -c "import sys,json; d=json.load(sys.stdin); print('single', [p['id'] for p in d.get('posts', [])], d.get('error'))"
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" "$B&post_id=abc"
curl -s -H "$H" "$B&from=2026-08-01T03:00:00.000Z&to=2026-09-01T03:00:00.000Z" | python3 -c "import sys,json; d=json.load(sys.stdin); print('range', len(d['posts']))"
```

Expected: shell 200 with `olderCursor`/`historyCutoff` (null for a young client), single `[5061]`, `400`, range 200.

- [ ] **Step 5: Browser verification on prod data**

With the `hub-env` preview: Postagens (button appears only when `olderCursor` is set; for DK TESTE/young clients it is absent), Home calendar back-navigation several months (no errors; for a client with history older than 90 days, older months fill in), `/postagens/5061`, and the network panel's first-load `hub-posts` size compared with the pre-change size for the same client. Screenshot for the user. Remove the `hub-env` entry from `.claude/launch.json`.

- [ ] **Step 6: Memory**

Update `memory/project_hub_loading_speed.md`: PR 1 and PR 2 numbers, merge SHAs, deploy dates, and that the follow-ups (portal-visible properties, `blur_data_url`) are open.
