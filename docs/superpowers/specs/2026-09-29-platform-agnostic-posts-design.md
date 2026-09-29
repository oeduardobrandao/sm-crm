# Platform-agnostic posts: multi-destination content (design)

## Context

Mesaas assumes every post is an Instagram post. Examples:
- `workflow_posts.tipo` only allows feed, reels, stories and carrossel.
- The caption field only appears when the client has a connected Instagram account (`PostEditorBody.tsx:625`), so a client without Instagram cannot write a caption.
- Publishing, the Hub and the MCP tools all speak Instagram.

TikTok was added as a parallel copy of the Instagram code. Its `platform` column holds a single value (`instagram|tiktok|both`). On a `both` post, both publishers write the same `workflow_posts.status`, so a TikTok failure can block Instagram, and a TikTok retry resets the post to `agendado` (`_shared/tiktok-publish-utils.ts:532`, `tiktok-publish-cron/core.ts:325-340`).

Goal: the agency chooses, **per board (workflow)**, which platforms it produces for. The platform list starts with **Instagram** and **Geral** and later grows to TikTok, YouTube and others.

**One post can go to several destinations**, for example one vertical video published as IG Reels, TikTok and YouTube Shorts.

Decided with the user:
- **Where the choice lives:** per workflow or board.
- **Posts are cross-platform:** a list of destinations, not a single platform.
- **Captions are always separate per destination.** A newly added destination starts from the first destination's caption.
- **"Geral"** is never auto-published. The agency (CRM) and the client (Hub) can download it: its media plus that destination's caption.

## Design (recommended: "Option C", a destinations table with an Instagram compatibility layer)

### Data model
- **New table `post_targets`**
  - Columns: `id`, `conta_id`, `post_id` (FK, delete cascade), `platform`, `format`, `caption`, `title`, `settings jsonb`, `scheduled_at` (nullable override), `status`, `external_id`, `permalink`, `error`, `error_code`, `retry_count`, `processing_at`, `published_at`. Unique on (`post_id`, `platform`).
  - `status` values: `pendente`, `agendado`, `processando`, `publicado`, `falha`, `disponivel`.
  - Row-level security mirrors `workflow_posts` (`20260402_workflow_posts.sql:82-99`).
  - **What this table owns, by phase:**
    - From P1 it is the record of which destinations a post has and of every non-Instagram caption.
    - Publish state moves onto it one platform at a time: TikTok in P4, Instagram in P5.
    - Until then, `post_targets_resolved` derives each platform's status from the legacy columns:
      - Instagram: `instagram_media_id` means publicado, `status='falha_publicacao'` means falha, `publish_processing_at` means processando.
      - TikTok: taken from `tiktok_publish_status`.
    - This keeps the per-destination chips in P2 correct while the publishers still write the old columns.
- **Instagram keeps its existing columns** (`ig_caption`, `instagram_media_id`, `instagram_permalink`, `publish_*`) because too much depends on them:
  - `ig_caption` alone is read in 33 source files and 23 migrations.
  - Content versions, edit suggestions, comment anchors and the ICA triggers all read these columns.
  - A view, `post_targets_resolved`, merges them into the destinations view, so everything reads one shape.
- **One writer, no sync triggers.** `mark_target_published` and `mark_target_failed` replace `mark_platform_published` (current body at `20260807000001:67-122`).
  - For Instagram they also write the legacy columns in the same transaction.
  - Both must `REVOKE ALL … FROM public, anon, authenticated` and then `GRANT EXECUTE … TO service_role`, the same pair `20260925000001:53-54` uses. Without the grant the publishers get permission denied.
  - Both lock the `workflow_posts` row `FOR UPDATE` before reading the other destinations, the same order `mark_platform_published` uses (`20260807000001:86-88`). Without that, two publishers finishing at the same moment each miss the other's write and the post never reaches `postado`.
  - The publishers keep calling `mark_platform_published` until each one migrates (TikTok in P4, Instagram in P5). At that point it becomes a thin wrapper around `mark_target_*`.
- **`workflow_posts.platform` becomes a read-only derived value.** A one-way trigger fills it from the destinations: `instagram`, `tiktok`, `both`, or a new `other`.
  - `other` stops posts that are only Geral from ever matching the Instagram claim (`20260925000013:34`).
  - The P1 migration drops the inline CHECK constraint (`20260720000005:25-26`, auto-named `workflow_posts_platform_check`) and re-adds it with `'other'` included.
  - **Every TikTok-based check becomes an Instagram-based check**, so a post that is only Geral cannot become an Instagram automation target:
    - Checks that *include* Instagram posts (`<> 'tiktok'`, `!== 'tiktok'`) become `IN ('instagram','both')`.
    - Checks that *exclude* them (`= 'tiktok'`) become `NOT IN ('instagram','both')`.
    - Sites: the latest definitions of `resolve_ica_workflow_post_target` and `reconcile_unlinked_automation_targets` (`20260914000001`), `link_pending_instagram_automations` and `sweep_pending_instagram_automation_links` (`20260830000002`), plus `AutomationFormDialog.tsx:129`, `PostAutomationSection.tsx:72`, `TrialReelPanel.tsx:20`, `WorkflowGridView.tsx:72`, `publishErrorBlockVisibility.ts:23` and `PostEditorBody.tsx:501`.
  - The `platform` union widens in P1 in `store/posts.ts:89`, `apps/hub/src/types.ts:67`, `AutoSchedulePromptDialog.tsx:24`, `postLabels.ts:35` and Hub `PostCard.tsx:33-40`, because P1 already creates the first posts that are only Geral.
  - **Writes to `platform` from an old frontend during the deploy window:** a guarded BEFORE UPDATE trigger turns them into destination changes. A GUC prevents loops. The mapping is removed in P4.
- **Post status comes from the destinations.** A guarded `recompute_post_publish_status(post)` runs through `record_post_status_change`, so status events and automations still fire. The guards:
  - It runs only when a destination that auto-publishes changes state.
  - It runs only while `post.status IN ('agendado','falha_publicacao','postado')`.
  - It never runs for a post with no auto-publishing destinations.
  - It never downgrades a post that is already `postado`.
  - Given those guards: `postado` when every auto-publishing destination is `publicado`, and `falha_publicacao` when any of them is `falha`.
  - Geral never blocks `postado` and never triggers a recompute. A post that is only Geral reaches `postado` through the existing manual path.
  - It shares a recursion GUC with the trigger that derives `platform`.
- **Where the platform lists live:**
  - `workflows.plataformas text[] DEFAULT '{instagram}'`.
  - `workflow_templates.plataformas`, copied into a workflow when it is created, not propagated afterwards. Templates are saved through `update_workflow_template` with explicit params (`store/workflows.ts:84`, latest `20260925130002`), so the RPC is copied forward with a new `p_plataformas` param that the 3-way merge ignores.
  - `clientes.plataformas_padrao` for posts avulsos. It defaults from the client's connected accounts, otherwise `{geral}`. It must also be added to the `clientes` column GRANT, to `clientes_v` and to `CLIENTE_SAFE_COLUMNS`.
  - A trigger fills in destinations from the board when a post is created without any. It drops any platform that has no native format for the post's `tipo` (TikTok for `stories`), so a stories post on an Instagram+TikTok board never gets a TikTok destination that would fail. The editor disables the same combinations. It also rejects a destination whose platform the board doesn't list.
  - A seeded destination takes its status from the post's status at insert time. Data import inserts rows already `postado` (`data-import/handler.ts:1300`), and the recompute must never regress them.

### Formats
- `tipo` stays as the platform-neutral content format. Renaming it would break both claim RPCs, both publish utils, the MCP zod enum and five or more frontend lists.
- It is relabeled through the registry: feed → Imagem, carrossel → Carrossel, reels → Vídeo vertical, stories → Stories.
- The registry maps the content format to each platform's native format, and that result is stored in `post_targets.format`, so publishers never branch on `tipo`:
  - Instagram: IMAGE, CAROUSEL, REELS, STORIES.
  - TikTok: video or photo; no stories.
  - YouTube (future): Shorts.
  - Geral: any format.

### Shared platform registry
- `supabase/functions/_shared/platform-registry.ts` holds ids, labels, icons, caption and title limits, the native-format map, whether a platform auto-publishes, and its plan feature flag (`feature_tiktok`).
- It is plain TypeScript with no Deno globals.
- The CRM and the Hub import it through a new Vite alias, `@mesaas/platforms` (alongside the existing ones in `apps/crm/vite.config.ts:12`, `apps/hub/vite.config.ts:10`).
- It replaces the duplicated tipo lists and the hardcoded 2200 limits (`useCaptionDraft.ts:12`, `PostEditor.tsx:525`, MCP `tools.ts:191,207`).
- **Wiring the alias:**
  - Add it to the Vite alias blocks.
  - Add it to `paths` in `apps/{crm,hub,admin}/tsconfig.json`.
  - Add it to the root `vitest.config.ts:10-16`.
- **Formatting:** the file sits under `supabase/functions/`, which is outside the reach of the `lint` and `format` scripts. `deno fmt` owns it, and a parity test pins its exports.
- **Why `_shared` and not `packages/`:** edge code must not import from `packages/` (`data-import/types.ts:4-6`).

### Geral export
- `file-zip` gets a `post_target` token type. The zip holds the ordered media plus a generated `legenda.txt`, built the way the LEIA-ME manifest already is (`file-zip/handler.ts:31-38`).
- Tokens are issued:
  - in the CRM, via `file-manage` zip-token (`handler.ts:739-788`);
  - in the Hub, via `hub-posts`, scoped to the hub token and only for approved posts. The Hub gets its own rate-limit key; it does not share `zip-gen:${contaId}` (10 per 600s, `file-manage/handler.ts:741`).
- **Approving a post that has no auto-publishing destination** (in `hub-approve/handler.ts:222-227` and in the CRM):
  - Approve it and flip Geral to `disponivel`.
  - Do not move it to `agendado`. Nothing would ever claim it, and it would sit in `agendado` forever.
  - Hide "Agendar" in `ScheduleButton.tsx` and `scheduleApprovedPost.ts:30-31` when the post has no destination that publishes.
- A post with a single media file gets a direct signed link plus a "Copiar legenda" button.
- The Geral destination switches to `disponivel` when the post is approved.

### MCP (additive only, existing agents keep working)
- `get_post` and `list_posts` gain `targets[]`.
- New tool `set_post_targets`.
- `create_post` gains an optional `platforms[]`; without it, the board's platforms apply.
- `ig_caption` stays as an alias for the Instagram caption, and the `tipo` enum is unchanged.

### Scheduling (decided)
- The post keeps a single publish time, `workflow_posts.scheduled_at`, which every destination uses by default.
- `post_targets.scheduled_at` is a nullable per-destination override, for example TikTok one hour later.
- **Split across phases**, because through P3 no destination can use the override (only Instagram and Geral ship, and Geral ignores scheduling):
  - The nullable column is added in P1.
  - P4 wires the behaviour: the claims and reorder read `COALESCE(pt.scheduled_at, wp.scheduled_at)`, reorder moves the overrides too, and the check that the time is at least 10 minutes away (`instagram-publish-utils.ts:100-104`) validates the effective time. The same copy-forward adds a `processing_at` check on each destination to the reorder lock.
  - The "Horário próprio" option on each destination tab also ships in P4.
- In the UI, the single "Agendar" button stays.
- Geral ignores scheduling.

### UX (approved from mockups)
1. **Novo fluxo / board settings / templates:** "Plataformas deste fluxo" chips (Instagram, TikTok if the plan allows it, YouTube "em breve", Geral). New posts start with every chip the board has selected.
2. **Post editor:**
   - The media and the neutral "Formato" select sit on the left.
   - A "Destinos" toggle row, limited to the board's platforms.
   - One caption tab per destination. The tab shows the native format ("Vídeo vertical → Reels / Vídeo TikTok / Shorts"), a status pill and a per-platform character counter. YouTube adds a Título field.
   - A newly enabled destination starts with the first destination's caption.
   - The Geral tab offers "Baixar conteúdo" and "Copiar legenda".
3. **Board card:** one status pill per destination (Publicado / Agendado / Falhou / Disponível / Aguardando aprovação).
4. **Hub:** one "Aprovar" for the whole post. Every destination's caption is shown in its own labeled block. "Baixar (Geral)" appears once the post is approved.
5. **Geral download:** a zip with the ordered media plus `legenda.txt`. A post with a single file gets a direct link plus "Copiar legenda" instead.

### Approval assumption
The client approves the post as a whole in the Hub: the media plus every destination's caption. Destinations are not approved individually.

Content versions, edit suggestions and comment anchors stay Instagram-caption-only for now. Extending them to other destinations' captions is a later phase.

## Phases (one PR each, shippable independently)

| # | Scope | Key files |
|---|---|---|
| **P0** | Registry, Vite alias, relabeled formats, duplicated tipo lists removed. No database changes. | `pages/entregas/postLabels.ts`, `PostEditorBody.tsx:360-379`, `NewAvulsoDialog.tsx`, `ExpressPostPage.tsx`, `importar/buildCommitRows.ts`, `services/dataImport.ts`, `store/mensagens.ts` |
| **P1** | Migration (prefix above `20260928160001`):<br>• `plataformas` on workflows, templates and clientes<br>• `post_targets` with RLS, plus the resolved view<br>• backfill from `platform`: a `both` post becomes 2 rows; the TikTok caption comes from `tiktok_caption`; status derives from `instagram_media_id` / `tiktok_publish_status`<br>• the seed trigger, the derived `platform`, and the `mark_target_*` RPCs<br>Also: a board platform picker (new workflow step, board settings, templates), and `PlatformSelector` writes destinations. | new migration, `store/posts.ts:89`, `store/workflows.ts`, `PlatformSelector.tsx`, `StepBasics.tsx` |
| **P2** | Per-destination caption tabs in the editor, which also removes the gate that hid the caption without a connected Instagram account. Per-destination status chips. The "connected account" check now controls only publish/schedule. | `PostEditorBody.tsx:625`, `InstagramCaptionField.tsx`, `useCaptionDraft.ts`, `ScheduleButton.tsx` |
| **P3** | Geral destination, zip export (CRM and Hub), per-destination caption labels in the Hub. Approving a post that is only Geral no longer moves it to `agendado` (hub-approve, ScheduleButton). | `file-zip`, `file-manage`, `hub-posts`, `apps/hub/.../PostDetailDialog.tsx:528,735` |
| **P4** | TikTok moves fully onto `post_targets`: the claim reads target status, the cron/webhook/utils write the target, and the `tiktok_*` columns are frozen. | `tiktok-publish-cron/core.ts`, `_shared/tiktok-publish-utils.ts`, `tiktok-webhook/handler.ts`, claim (latest `20260830000002`) |
| **P5** | The Instagram claim filters on target status (latest `20260925000013`), and `hub-approve` validates and schedules per platform; posts that are only Geral skip validation. | `instagram-publish-cron`, `hub-approve/handler.ts:209-240`, `_shared/instagram-publish-utils.ts:84-175` |
| **P6** | MCP additions. | `mcp/tools.ts`, `mcp/queries.ts` |
| Later | YouTube publisher; versions, suggestions and comments on non-Instagram captions (note: P4 moving the TikTok caption to `post_targets.caption` drops TikTok caption versioning, `20260923000001:160`, until this lands); retiring the `tiktok_*` columns; neutral copy across the ~170 remaining "Instagram" strings (done alongside the phases that touch each area). | — |

## Risk hot spots
- **Copying RPCs forward.** Any claim or reorder RPC change must copy the full latest body into the new migration. The `reorder_post_schedules` lock check (`20260923000009:149-150`) must also check each target's `processing_at`.
- **Recursion.** The status recompute must not re-trigger itself, and it must still record `post_status_events`.
- **Backfill.** A `both` post that is already published on one platform must get the right per-destination status.
- **Deploy order.** Migrations and functions go out before the frontend merges, because a merge deploys the frontend immediately.
- **Contract changes.** Update tests in both `apps/**/__tests__` and `supabase/functions/__tests__`.

## Process after approval
1. Write this design to `docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md` on branch `claude/platform-agnostic-config-0e0db5` (already level with `origin/main`) and commit it. Optionally run `codex-spec-review`.
2. Use `superpowers:writing-plans` to write the P0+P1 implementation plan, then execute it phase by phase, one PR per phase.

## Verification (per phase)
- Gates: `npm run lint`, `npm run format:check`, all four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`. Entitlement/RLS psql suites for `post_targets`, including a test pinning the ACL on the `mark_target_*` RPCs.
- **P1:** apply the migration on a local Supabase, then check that the backfill row counts equal the posts per `platform` (a `both` post counts twice) and that no Instagram claim matches a post with `platform = 'other'`.
- **P2/P3:** in the Browser pane against staging (`npm run dev:all:env`), check that:
  - a Geral-only board post shows a caption with no Instagram connected;
  - a cross-platform post shows separate caption tabs;
  - the zip downloads from both the CRM and the Hub.
- **P4/P5:** staging end-to-end publish of a post going to Instagram and TikTok; a forced TikTok failure must not block the Instagram publish.
