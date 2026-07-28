import { createJsonResponder } from "../_shared/http.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { refineMapping } from "../_shared/import-ai.ts";
import type { ClienteRef, CommitContainerRow, CommitEntregaRow, CommitRow } from "./types.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Entitlements {
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  resolveEntitlements: (svc: DbClient, workspaceId: string) => Promise<Entitlements | null>;
  geminiKey: string | null;
}

/** Everything an action handler needs from the authenticated request. */
interface ActionCtx {
  db: DbClient;
  conta_id: string;
  userId: string;
  body: any;
  json: ReturnType<typeof createJsonResponder>;
}

// workflow_etapas is deliberately ABSENT: it has no conta_id column (it is
// tenant-scoped transitively through workflow_id), so a .eq("conta_id", ...)
// delete against it raises `column "conta_id" does not exist` and aborts the
// whole undo. It needs no explicit delete anyway — workflow_etapas.workflow_id
// is ON DELETE CASCADE from workflows (20260301_baseline_schema.sql:160).
// It DOES need protecting, though: portal_approvals cascades from IT in turn
// and holds real client data — see guardWorkflowEtapaApprovals below and the
// comment on WORKFLOW_CASCADE_CHILDREN.
const UNDO_ORDER = ["workflow_posts", "workflows", "workflow_templates", "ideias", "clientes"];
const BATCH_LIMIT = 200;
// preview is a pure counting pass over the WHOLE parsed file (commit is what gets
// sliced into BATCH_LIMIT batches), so it needs its own, larger ceiling — but it
// still needs one, so a malformed/huge payload can't be walked unbounded.
//
// THE CAP IS SIZED FOR EXPANDED COMMIT ROWS, NOT SOURCE ROWS. `body.rows` is the
// output of buildCommitRows, which emits SEVERAL wire rows per source row; a cap
// set to the source-row budget rejects uploads the wizard itself accepts, and
// since preview must pass before commit, such an import becomes a dead end that
// can never be committed at all.
//
// MAX_SOURCE_ROWS mirrors the browser's own upload cap
// (`MAX_ROWS` in apps/crm/src/pages/importar/parseFiles.ts). It is duplicated,
// not imported: the frontend is Vite/TS and this is Deno, and neither can import
// the other's module. The two are pinned together by the "browser source-row cap
// and PREVIEW_LIMIT stay in sync" test in __tests__/data-import_test.ts, which
// reads parseFiles.ts and fails if either literal is changed alone.
export const MAX_SOURCE_ROWS = 2000;
// Worst-case expansion, from buildCommitRows (apps/crm/src/pages/importar/):
//   posts collection:    1 post
//                      + 1 auto-created cliente  (worst case: the client column
//                        holds a DISTINCT name on every row, so resolveRef
//                        synthesizes one `auto-cliente:` row per source row)
//                      + 1 container             (preview calls buildCommitRows
//                        with maxPostsPerWorkflow = null, i.e. chunking OFF, so a
//                        client group yields exactly ONE container — and with a
//                        distinct client per row there are as many groups as rows)
//                      = 3 commit rows per source row  <- the ceiling
//   entregas collection: 1 entrega + 1 auto-created cliente = 2 per source row,
//                        plus 1 template per COLLECTION. A collection with r >= 1
//                        rows emits 1 + 2r <= 3r, so the template fits inside the
//                        spare third slot its own rows already carry.
//   ideias collection:   1 ideia + 1 auto-created cliente = 2 per source row.
//   roster (clientes):   1 cliente per source row.
// => 3 x MAX_SOURCE_ROWS = 6000 rows for any upload the browser permits.
//
// COLLECTION_ROW_ALLOWANCE covers the one term that is NOT per source row: an
// entregas collection with ZERO rows still pushes its template (buildCommitRows
// emits it before iterating rows), and a Notion zip can carry more collections
// than the 5-file limit suggests. A payload that exhausts even this allowance is
// mostly empty collections — precisely the malformed input the cap exists to
// refuse.
const COLLECTION_ROW_ALLOWANCE = 500;
export const PREVIEW_LIMIT = MAX_SOURCE_ROWS * 3 + COLLECTION_ROW_ALLOWANCE; // 6500
// Supabase's REST layer applies a project-level max-rows cap (commonly 1000), so
// every unbounded read has to be paged explicitly — the handler must not depend on
// that setting in either direction. A short page is the end-of-data signal.
const PAGE_SIZE = 500;
// `.in()` lists ride in the query string, so they are chunked to keep URLs sane.
const IN_CHUNK = 500;
// How long a job may sit in 'undoing' before a retry is allowed to resume it. An
// undo that is killed mid-flight (edge runtime CPU/wall kill) leaves the job in
// 'undoing' with commits locked out, which would be permanently stuck if a retry
// were refused unconditionally. Resuming is safe: the deletes are id-based and
// idempotent, the item read is redone from scratch, and no commit can have added
// rows in the meantime (import_commit_row refuses an 'undoing' job). The window
// only has to exceed the edge runtime's wall-clock ceiling, which is far below
// 5 minutes, so a genuinely concurrent second undo is still refused.
const UNDO_STALE_MS = 5 * 60 * 1000;
// The statuses a commit batch may be written into. Anything else means an undo
// has claimed the job.
const COMMITTABLE_STATUSES = ["committing", "completed"];

function chunked<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Audit writes for commit/undo happen AFTER the rows have already landed, and
 * they run inside the action's outer try — so a rejection there would report
 * `Internal error` (500) for work that actually succeeded, and the client would
 * retry a batch that is already committed. insertAuditLog swallows its own
 * failures today, but that is its contract, not ours: this wrapper makes the
 * "audit never changes the response" guarantee local and unconditional.
 */
async function auditQuietly(...args: Parameters<typeof insertAuditLog>): Promise<void> {
  try {
    await insertAuditLog(...args);
  } catch (e) {
    console.error("[data-import] audit log failed:", e);
  }
}

// --- undo guards -------------------------------------------------------------
// Each guard answers one question — "which of these ids must undo NOT delete?" —
// so the guard chain can be read (and tested) one link at a time.

/**
 * EVERY table that declares `REFERENCES workflow_posts(id) ON DELETE CASCADE`
 * and holds a row `import_commit_row` never writes itself — i.e. a table
 * whose rows, if any exist, were authored by the user after the import
 * landed the post. Column holding the post id + the table's tenant-scope
 * column, same {table, column, scopeCol} shape as CLIENTE_CASCADE_CHILDREN
 * below.
 *
 * post_property_values: import_commit_row never inserts into it (custom
 * field values are set through the post's own card UI, the same way
 * template_property_definitions is never written by the import — see
 * TEMPLATE_REFERENCING_TABLES below), so a surviving row means the user
 * recorded data against THIS post after the import landed it.
 *
 * post_media / post_file_links (task-9 gap #1): both hold the actual
 * uploaded cover image / video attached to the post after import — exactly
 * the "open the imported post and attach media" flow the wizard's own undo
 * copy promises to protect. import_commit_row never writes either table.
 * NOTE the schema differs from what was reported when this gap was filed:
 * post_media's *current* definition is 20260411_post_media.sql:11 (the
 * 20260409_instagram_scheduling.sql:22 version was DROPPED and replaced by
 * that migration, see its line 8), and — unlike the original report — it
 * DOES carry its own conta_id (20260411_post_media.sql:12), so it is scoped
 * like post_file_links, not like post_property_values.
 *
 * post_approvals / post_status_events (found in the task-9 sweep, not
 * previously reported or deferred): post_approvals is "per-post client
 * feedback" (20260402_workflow_posts.sql:58) — the exact post-level sibling
 * of portal_approvals below, and import_commit_row never writes it either.
 * post_status_events (20260606000001_post_status_events.sql:12) is an
 * append-only audit trail (status transitions + actor + the approval that
 * triggered them) captured by an AFTER UPDATE OF status trigger — import only
 * ever INSERTs a post (20260727000001_data_import_jobs.sql:418), never
 * UPDATEs its status, so the trigger cannot have fired for anything the
 * import itself did; any row here is a real status change made after import.
 *
 * post_comment_threads / post_edit_suggestions (task-9 final cascade-child
 * gap, now closed): a previous review round named both as a known,
 * intentional gap and deferred them rather than probing them. Both hold real
 * user-authored data import_commit_row never writes: post_comment_threads
 * (20260423_post_comment_threads.sql:4) is an inline PostEditor comment
 * thread anchored to a text selection; post_edit_suggestions
 * (20260521000001_post_edit_suggestions.sql:8) is a client-submitted edit
 * suggestion from the Hub. post_comment_threads also has its own child:
 * post_comments.thread_id (20260423_post_comment_threads.sql:18) is itself
 * `ON DELETE CASCADE` from post_comment_threads, so guarding the thread row
 * here protects the comments transitively — post_comments carries no
 * conta_id or post_id column of its own to probe directly, but it needs
 * none: it cannot survive without its thread, so there is no separate entry
 * for it in this list.
 *
 * Verified against the migrations on 2026-07-27:
 *   post_property_values   post_id  (none)      20260403_custom_properties.sql:27
 *   post_media             post_id  conta_id    20260411_post_media.sql:11-12
 *   post_file_links        post_id  conta_id    20260425000001_file_system_tables.sql:74,76
 *   post_approvals         post_id  (none)      20260402_workflow_posts.sql:60
 *   post_status_events     post_id  conta_id    20260606000001_post_status_events.sql:12-13
 *   post_comment_threads   post_id  conta_id    20260423_post_comment_threads.sql:4-5
 *   post_edit_suggestions  post_id  conta_id    20260521000001_post_edit_suggestions.sql:8-9
 *
 * The previous round's comment here also listed "post_designs" and "the
 * instagram_scheduling queue row" as unprobed cascade children; post_designs
 * (20260702000001_post_designs.sql) was dropped outright by
 * 20260705000001_designs_first_class.sql:25 and no longer exists, and no
 * separate "instagram_scheduling queue" table was ever found — both were
 * stale/inaccurate and have been removed from this list rather than carried
 * forward. designs.post_id (20260705000001_designs_first_class.sql:55) is
 * `ON DELETE SET NULL`, not CASCADE, so it does not belong in this list
 * either: deleting the post detaches the design instead of cascading it away.
 *
 * Re-derived against `grep -rni "references workflow_posts(id)"
 * supabase/migrations/` on 2026-07-27, every hit is accounted for above or in
 * this list, and every one of them is either CASCADE-and-guarded, CASCADE-and-
 * dropped/stale, or SET NULL (not a cascade-delete hazard at all). This list
 * is therefore exhaustive as of that grep.
 *
 * !!! ANY future table added with `REFERENCES workflow_posts(id) ON DELETE
 * CASCADE` that can hold user-authored data belongs in this list — the same
 * discipline as CLIENTE_CASCADE_CHILDREN, and a missing entry fails exactly
 * as silently. Re-derive with:
 *   grep -rni "references workflow_posts(id)" supabase/migrations/
 */
const PUBLISHED_POST_CASCADE_CHILDREN: Array<{ table: string; column: string; scopeCol: string | null }> = [
  { table: "post_property_values", column: "post_id", scopeCol: null },
  { table: "post_media", column: "post_id", scopeCol: "conta_id" },
  { table: "post_file_links", column: "post_id", scopeCol: "conta_id" },
  { table: "post_approvals", column: "post_id", scopeCol: null },
  { table: "post_status_events", column: "post_id", scopeCol: "conta_id" },
  { table: "post_comment_threads", column: "post_id", scopeCol: "conta_id" },
  { table: "post_edit_suggestions", column: "post_id", scopeCol: "conta_id" },
];

/**
 * workflow_posts pass. Returns the ids to SKIP — the union of two distinct
 * hazards:
 *   - a post that already carries a platform id was published to
 *     Instagram/TikTok; deleting it would drop the record of live content.
 *   - a post with a surviving row in any PUBLISHED_POST_CASCADE_CHILDREN
 *     table carries user-authored data the import never wrote, which undo
 *     must not cascade away.
 * The first is a column check on workflow_posts itself (not a cascade-child
 * probe, so it is not expressed via the declared list); the second is.
 */
async function guardPublishedPosts(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const skip = new Set<string>();
  for (const part of chunked(ids)) {
    const { data, error } = await db
      .from("workflow_posts")
      .select("id, instagram_media_id, tiktok_post_id")
      .eq("conta_id", conta_id)
      .in("id", part.map(Number))
      .or("instagram_media_id.not.is.null,tiktok_post_id.not.is.null");
    if (error) throw error;
    for (const p of (data ?? []) as any[]) skip.add(String(p.id));
  }
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    for (const child of PUBLISHED_POST_CASCADE_CHILDREN) {
      let q = db.from(child.table).select(child.column);
      if (child.scopeCol) q = q.eq(child.scopeCol, conta_id);
      const { data, error } = await q.in(child.column, numericPart);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        const v = r[child.column];
        if (v != null) skip.add(String(v));
      }
    }
  }
  return [...skip];
}

/**
 * EVERY table that declares `REFERENCES workflows(id) ON DELETE CASCADE` and
 * holds a row that must not be cascaded away silently, with the column
 * holding the workflow id and the table's tenant-scope column — the same
 * {table, column, scopeCol} shape as CLIENTE_CASCADE_CHILDREN below.
 *
 * workflow_posts is the ORIGINAL hazard this guard exists for: deleting a
 * container workflow would silently destroy the very published post
 * guardPublishedPosts just protected — and any post the user added to it
 * after the import. workflow_select_options and portal_tokens are two more,
 * reported by the previous review round and left unfixed then:
 * import_commit_row never writes either table, so any row there (an
 * on-the-fly select option added while working a custom field, a shared
 * portal link) is entirely user-authored, and both carry conta_id.
 *
 * Verified against the migrations on 2026-07-27:
 *   workflow_posts          workflow_id  conta_id  20260402_workflow_posts.sql:14
 *   workflow_select_options workflow_id  conta_id  20260403_custom_properties.sql:41
 *   portal_tokens           workflow_id  conta_id  20260415000001_portal_and_hub_tokens.sql:8
 *
 * !!! ANY future table added with `REFERENCES workflows(id) ON DELETE
 * CASCADE` MUST be added to this list — the same discipline as
 * CLIENTE_CASCADE_CHILDREN, and a missing entry fails exactly as silently:
 * undo deletes the workflow, Postgres cascades away rows this import never
 * created, and nothing appears in skippedWorkflows. Re-derive with:
 *   grep -rni "references workflows(id)" supabase/migrations/
 *
 * workflow_etapas ALSO cascades from workflows and is deliberately excluded
 * from this list (and, per the UNDO_ORDER note at the top of this file, from
 * UNDO_ORDER itself: it has no conta_id column). A previous version of this
 * comment claimed that was safe because workflow_etapas "holds no data of its
 * own beyond the workflow's own stage config, so there is nothing on it worth
 * protecting" — that claim was FALSE (task-9 finding, gap #2):
 * portal_approvals.workflow_etapa_id is itself `ON DELETE CASCADE` from
 * workflow_etapas (20260325_portal_approvals.sql:9) and stores the client's
 * real approval action + comment from the portal. import_commit_row writes
 * neither workflow_etapas (etapas come from the template's stage config) nor
 * portal_approvals (a client action recorded after the fact), so a surviving
 * approval is exactly the same class of hazard as anything in this list —
 * just one hop further down the cascade: workflows -> workflow_etapas ->
 * portal_approvals, both links CASCADE.
 *
 * That transitive hop doesn't fit THIS list's shape: every entry here is
 * probed with `.in(column, workflowIds)` directly against the workflow id,
 * but portal_approvals has no workflow_id column of its own to filter on.
 * Rather than force it in with a wrong column, or query a nonexistent
 * embedded-resource join the shared test mock (test/shared/supabaseMock.ts)
 * can't express, it gets its own chained step —
 * guardWorkflowEtapaApprovals below — that mirrors this list's per-entry
 * probe shape one level down: fetch the surviving workflow_etapas for these
 * workflow ids, then probe portal_approvals against THOSE ids, then map
 * survivors back to their workflow_id. guardContainerWorkflows merges its
 * result into the same `keep` set as this list.
 */
const WORKFLOW_CASCADE_CHILDREN: Array<{ table: string; column: string; scopeCol: string | null }> = [
  { table: "workflow_posts", column: "workflow_id", scopeCol: "conta_id" },
  { table: "workflow_select_options", column: "workflow_id", scopeCol: "conta_id" },
  { table: "portal_tokens", column: "workflow_id", scopeCol: "conta_id" },
];

/**
 * Transitive step for the workflows pass: workflows -> workflow_etapas ->
 * portal_approvals, both hops `ON DELETE CASCADE`. See the comment on
 * WORKFLOW_CASCADE_CHILDREN above for why this can't be one more entry in
 * that flat list.
 *
 * Verified against the migrations on 2026-07-27:
 *   workflow_etapas   workflow_id        (none)  20260301_baseline_schema.sql:160
 *   portal_approvals  workflow_etapa_id  (none)  20260325_portal_approvals.sql:9
 *
 * Neither table has a tenant column of its own (both are scoped transitively
 * through workflows), so — same trap as workflow_etapas' exclusion from
 * UNDO_ORDER — no `.eq(scopeCol, ...)` is applied to either probe; a scope
 * filter on a column that does not exist aborts the whole undo. The workflow
 * ids being probed are already conta-scoped (they come from the same
 * conta-scoped import_job_items read every other guard uses), so this is
 * defence in depth, not the isolation boundary.
 *
 * Returns the workflow ids to KEEP: any workflow with a still-living etapa
 * that itself has a still-living portal_approvals row.
 */
async function guardWorkflowEtapaApprovals(db: DbClient, ids: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    const { data: etapas, error: etapaErr } = await db
      .from("workflow_etapas")
      .select("id, workflow_id")
      .in("workflow_id", numericPart);
    if (etapaErr) throw etapaErr;
    const etapaRows = (etapas ?? []) as Array<{ id: number; workflow_id: number }>;
    if (etapaRows.length === 0) continue;
    const workflowByEtapa = new Map<number, number>();
    for (const e of etapaRows) workflowByEtapa.set(e.id, e.workflow_id);
    const etapaIds = etapaRows.map((e) => e.id);
    for (const etapaPart of chunked(etapaIds.map(String))) {
      const { data: approvals, error: apprErr } = await db
        .from("portal_approvals")
        .select("workflow_etapa_id")
        .in("workflow_etapa_id", etapaPart.map(Number));
      if (apprErr) throw apprErr;
      for (const a of (approvals ?? []) as Array<{ workflow_etapa_id: number }>) {
        const wf = workflowByEtapa.get(a.workflow_etapa_id);
        if (wf != null) keep.add(String(wf));
      }
    }
  }
  return [...keep];
}

/**
 * workflows pass. Returns the ids to KEEP: any workflow still referenced by a
 * surviving row in ANY table in WORKFLOW_CASCADE_CHILDREN, plus any workflow
 * whose etapa still has a surviving portal_approvals row (guardWorkflowEtapaApprovals).
 *
 * Runs after the workflow_posts pass has already issued its deletes for this
 * undo, so a plain query against the current table state is enough — the
 * same reasoning guardReferencedTemplates documents for its own re-query.
 * Every child table is probed unconditionally (no early exit), matching the
 * other three guards' stable query sequence.
 */
async function guardContainerWorkflows(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    for (const child of WORKFLOW_CASCADE_CHILDREN) {
      let q = db.from(child.table).select(child.column);
      if (child.scopeCol) q = q.eq(child.scopeCol, conta_id);
      const { data, error } = await q.in(child.column, numericPart);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        const v = r[child.column];
        if (v != null) keep.add(String(v));
      }
    }
  }
  for (const wf of await guardWorkflowEtapaApprovals(db, ids)) keep.add(wf);
  return [...keep];
}

/**
 * EVERY table that references `workflow_templates(id)`, whether the FK is
 * ON DELETE SET NULL or ON DELETE CASCADE, with the column holding the
 * template id and the table's tenant-scope column.
 *
 * Two different hazards share this list:
 *   - workflows.template_id (SET NULL) — deleting a template a surviving
 *     workflow still points at would silently null that workflow's
 *     template_id, orphaning the entrega configuration the workflows pass
 *     just decided to keep (guardContainerWorkflows). No data is destroyed,
 *     but the link is, with no error and no mention in any skipped* array.
 *   - template_property_definitions.template_id (CASCADE) — import_commit_row
 *     never writes a template_property_definitions row itself, so every one
 *     that exists was authored by the user after the import (custom property
 *     fields defined on the template). Deleting the template cascades it
 *     away, and post_property_values.property_definition_id cascades from
 *     THAT column in turn (20260403_custom_properties.sql:28) — losing the
 *     definition's row is enough to lose every value recorded against it, so
 *     no separate probe of post_property_values is needed.
 *
 * Verified against the migrations on 2026-07-27:
 *   workflows                      template_id  SET NULL  conta_id  20260301_baseline_schema.sql:150
 *   template_property_definitions  template_id  CASCADE   conta_id  20260403_custom_properties.sql:8
 *
 * !!! ANY future table added with `REFERENCES workflow_templates(id)` (SET
 * NULL or CASCADE) MUST be added to this list — the same discipline as
 * CLIENTE_CASCADE_CHILDREN below, and a missing CASCADE entry fails exactly
 * as silently: undo deletes the template, Postgres cascades away rows this
 * import never created, and nothing appears in skippedTemplates. Re-derive
 * with:
 *   grep -rni "references workflow_templates(id)" supabase/migrations/
 * The -i is load-bearing: some migrations write `references` in lowercase, so a
 * case-sensitive grep reports a SHORTER list and reads as "complete".
 */
const TEMPLATE_REFERENCING_TABLES: Array<{ table: string; column: string; scopeCol: string | null }> = [
  { table: "workflows", column: "template_id", scopeCol: "conta_id" },
  { table: "template_property_definitions", column: "template_id", scopeCol: "conta_id" },
];

/**
 * workflow_templates pass. Returns the ids to KEEP: any template still
 * referenced by a row in ANY table in TEMPLATE_REFERENCING_TABLES.
 *
 * Runs after the workflows pass has already issued its deletes for this undo, so
 * a plain query against the current `workflows` table state is enough — it will
 * only see rows that survived (never touched by this import, or kept because they
 * still hold posts). No locally cached "kept" set is needed, the same way
 * guardReferencedClientes re-queries its child tables rather than reasoning about
 * what earlier passes decided. Every referencing table is probed unconditionally
 * (no early exit), matching guardReferencedClientes's stable query sequence.
 */
async function guardReferencedTemplates(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    for (const ref of TEMPLATE_REFERENCING_TABLES) {
      let q = db.from(ref.table).select(ref.column);
      if (ref.scopeCol) q = q.eq(ref.scopeCol, conta_id);
      const { data, error } = await q.in(ref.column, numericPart);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        const v = r[ref.column];
        if (v != null) keep.add(String(v));
      }
    }
  }
  return [...keep];
}

/**
 * EVERY table that declares `REFERENCES clientes(id) ON DELETE CASCADE`, with the
 * column holding the cliente id and the table's tenant-scope column.
 *
 * `scopeCol: null` means the table has NO tenant column of its own (it is scoped
 * transitively through clientes). Adding a `.eq("conta_id", …)` to those raises
 * `column "conta_id" does not exist` and aborts the entire undo — the same trap
 * that keeps workflow_etapas out of UNDO_ORDER. The ids being probed are already
 * known to be this tenant's clientes (they come from a conta-scoped
 * import_job_items read), so the scope filter is defence in depth, not the
 * isolation boundary.
 *
 * Verified against the migrations on 2026-07-27:
 *   workflows              cliente_id  conta_id      20260301_baseline_schema.sql:148
 *   instagram_accounts     client_id   (none)        20260301_baseline_schema.sql:174
 *   analytics_reports      client_id   conta_id      20260306_analytics_module.sql:37
 *   hub_briefing_questions cliente_id  conta_id      20260410120000_hub_briefing_questions.sql:3
 *   ideias                 cliente_id  workspace_id  20260414114009_ideias.sql:5
 *   client_hub_tokens      cliente_id  conta_id      20260415000001_portal_and_hub_tokens.sql:27
 *   hub_brand              cliente_id  (none)        20260415000001_portal_and_hub_tokens.sql:47
 *   hub_brand_files        cliente_id  (none)        20260415000001_portal_and_hub_tokens.sql:68
 *   hub_pages              cliente_id  conta_id      20260415000001_portal_and_hub_tokens.sql:89
 *   briefings              cliente_id  conta_id      20260616120000_briefings_table.sql:3
 *   tiktok_accounts        client_id   (none)        20260718000001_tiktok_core.sql:6
 *
 * !!! ANY future table added with `REFERENCES clientes(id) ON DELETE CASCADE`
 * MUST be added to this list. This is a hand-maintained mirror of the schema and
 * a missing entry fails SILENTLY: undo deletes the cliente, Postgres cascades
 * away rows this import never created (an OAuth-linked Instagram account, a live
 * hub token, the client's own briefing answers), and nothing appears in
 * skippedClientes. That omission is exactly the bug this list exists to prevent,
 * and it has already recurred once. Re-derive the list with:
 *   grep -rni "references clientes(id) on delete cascade" supabase/migrations/
 * The -i is load-bearing: `ideias` writes `references` in lowercase, so the
 * case-sensitive form returns 14 rows instead of 15 and reads as "complete".
 * `ON DELETE SET NULL` references (designs, ai_image_generations, and the two
 * baseline finance tables) are deliberately absent — those rows survive.
 */
const CLIENTE_CASCADE_CHILDREN: Array<{ table: string; column: string; scopeCol: string | null }> = [
  { table: "workflows", column: "cliente_id", scopeCol: "conta_id" },
  { table: "ideias", column: "cliente_id", scopeCol: "workspace_id" },
  { table: "instagram_accounts", column: "client_id", scopeCol: null },
  { table: "tiktok_accounts", column: "client_id", scopeCol: null },
  { table: "analytics_reports", column: "client_id", scopeCol: "conta_id" },
  { table: "briefings", column: "cliente_id", scopeCol: "conta_id" },
  { table: "hub_briefing_questions", column: "cliente_id", scopeCol: "conta_id" },
  { table: "client_hub_tokens", column: "cliente_id", scopeCol: "conta_id" },
  { table: "hub_brand", column: "cliente_id", scopeCol: null },
  { table: "hub_brand_files", column: "cliente_id", scopeCol: null },
  { table: "hub_pages", column: "cliente_id", scopeCol: "conta_id" },
];

/**
 * clientes pass — the LAST and most dangerous one. Returns the ids to KEEP: any
 * cliente still referenced by a surviving row in ANY table that cascades from it.
 *
 * The workflow_posts and workflows passes have already run, so "still referenced"
 * means exactly "not deleted by this undo". Every child table is probed
 * unconditionally (no early exit) so the query sequence is stable and each probe
 * is independently assertable.
 */
async function guardReferencedClientes(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    for (const child of CLIENTE_CASCADE_CHILDREN) {
      let q = db.from(child.table).select(child.column);
      if (child.scopeCol) q = q.eq(child.scopeCol, conta_id);
      const { data, error } = await q.in(child.column, numericPart);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) keep.add(String(r[child.column]));
    }
  }
  return [...keep];
}

export function createDataImportHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const db = deps.createDb();
    const {
      data: { user },
      error: authErr,
    } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    // Guard the indexOf: when the segment is absent it returns -1 and a bare
    // `parts[idx + 1]` silently reads parts[0], routing an unknown path to a real
    // action. Mirrors ideia-media-manage/handler.ts:43-44.
    const actionIdx = parts.indexOf("data-import");
    const action = actionIdx >= 0 ? (parts[actionIdx + 1] ?? "") : "";

    // The entitlement gate only covers actions that consume NEW use of the
    // feature. `undo` is cleanup of a previously authorized action, not new
    // use of it — whether csv import is gated at all is still an open pricing
    // question, and if a workspace's plan or flag flips inside the 7-day undo
    // window, the customer must still be able to undo (and, symmetrically,
    // resume a half-finished commit) or the job becomes permanently
    // unrecoverable through the wizard. `commit` is left ungated for the same
    // reason: it only ever resumes a job `start` already created under the
    // gate, and it is the ownership check inside handleCommit — not this gate
    // — that refuses a foreign or nonexistent jobId. Leaving commit ungated
    // here does not let an ungated workspace begin a fresh import, because a
    // commit requires a jobId only a gated `start` can mint.
    const GATE_REQUIRED_ACTIONS = new Set(["start", "analyze", "preview"]);
    let ent: Entitlements | null = null;
    if (GATE_REQUIRED_ACTIONS.has(action)) {
      ent = await deps.resolveEntitlements(db, conta_id);
      if (!ent?.features?.feature_csv_import) return json({ error: "upgrade_required" }, 403);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* actions validate below */
    }
    const ctx: ActionCtx = { db, conta_id, userId: user.id, body, json };

    try {
      if (action === "start") {
        const source = String(body.source ?? "");
        if (!["trello", "notion", "clickup", "csv"].includes(source)) return json({ error: "Invalid source" }, 400);
        const { data, error } = await db
          .from("import_jobs")
          .insert({ conta_id, created_by: user.id, source, total_rows: Number(body.totalRows ?? 0) })
          .select("id")
          .single();
        if (error) throw error;
        return json({ jobId: data.id });
      }

      if (action === "analyze") {
        // No key configured (GEMINI_API_KEY unset, same as the analytics
        // functions): the client keeps its already-computed heuristic
        // proposal, no fetch attempted.
        if (!deps.geminiKey) return json({ proposal: null });
        const proposal = await refineMapping(body.summary, body.heuristic, deps.geminiKey);
        return json({ proposal });
      }

      if (action === "preview") {
        // GATE_REQUIRED_ACTIONS includes "preview", so reaching here means the
        // gate above already ran and returned early on a falsy ent — this cast
        // just tells the compiler what the runtime already guarantees.
        const entitlements = ent as Entitlements;
        const rows = (body.rows ?? []) as CommitRow[];
        // Same shape guard commit applies: without it `rows: "abc"` reaches
        // rows.filter() below and surfaces as an opaque 500.
        if (!Array.isArray(rows)) return json({ error: "Invalid payload" }, 400);
        // Distinct from commit's message on purpose: the two actions enforce
        // different caps (PREVIEW_LIMIT vs BATCH_LIMIT) and a shared string
        // leaves the client unable to tell which one it hit.
        if (rows.length > PREVIEW_LIMIT) return json({ error: "Preview batch too large" }, 400);
        const counts: Record<string, number> = { clientes: 0, posts: 0, entregas: 0, ideias: 0 };
        // counts.clientes (below) is the DISPLAY number in the prévia's "Clientes"
        // tile — every roster row of kind 'cliente', matching the plain row-count
        // semantics of the posts/entregas/ideias tiles next to it. newClientes is
        // the separate CAP-DRIVING number: only rows that will actually INSERT a
        // new clientes row. A "mesclar com existente" row (CommitClienteRow.merge
        // set) is still `kind: 'cliente'` on the wire, but import_commit_row's
        // merge branch (20260727000001_data_import_jobs.sql:221-253) only UPDATEs
        // the pre-existing cliente — it never inserts, so it never trips
        // trg_limit_clientes. Counting it toward the cap warning below described a
        // commit outcome that can never happen (0 real growth still read as
        // "N novos clientes excedem o limite").
        let newClientes = 0;
        for (const r of rows) {
          if (r.kind === "cliente") {
            counts.clientes++;
            if (!r.merge) newClientes++;
          } else if (r.kind === "post") counts.posts++;
          else if (r.kind === "entrega") counts.entregas++;
          else if (r.kind === "ideia") counts.ideias++;
        }
        const warnings: string[] = [];
        const maxClients = entitlements.limits.max_clients;
        if (newClientes > 0 && maxClients != null) {
          // db is the service-role client (RLS bypassed) — every count MUST be
          // conta_id-scoped by hand or it returns a platform-wide total.
          //
          // No `.eq("status", ...)` here: the trigger that actually enforces this
          // cap (trg_limit_clientes -> enforce_plan_count_limit('max_clients',
          // 'direct', 'conta_id', 'conta_id'), 20260611130003_count_triggers.sql:3-4)
          // passes no status predicate (TG_ARGV[4] is absent), so it counts every
          // clientes row for the workspace regardless of status. A workspace with
          // pausado/encerrado clients would otherwise be undercounted here, see no
          // warning, and hit plan_limit:max_clients failures partway through commit.
          const { count } = await db
            .from("clientes")
            .select("id", { count: "exact", head: true })
            .eq("conta_id", conta_id);
          if ((count ?? 0) + newClientes > maxClients) {
            warnings.push(
              `${newClientes} novos clientes excedem o limite de ${maxClients} do seu plano (${count ?? 0} existentes).`,
            );
          }
        }
        const templateRows = rows.filter((r) => r.kind === "template").length;
        const maxTemplates = entitlements.limits.max_workflow_templates;
        if (templateRows > 0 && maxTemplates != null) {
          // Matches trg_limit_templates -> enforce_plan_count_limit(
          // 'max_workflow_templates', 'direct', 'conta_id', 'conta_id')
          // (20260611130003_count_triggers.sql:19-21): no status predicate there
          // either, and workflow_templates has no status column at all
          // (20260301_baseline_schema.sql:134-141), so this count already matches
          // what the trigger enforces with nothing further to drop.
          const { count } = await db
            .from("workflow_templates")
            .select("id", { count: "exact", head: true })
            .eq("conta_id", conta_id);
          if ((count ?? 0) + templateRows > maxTemplates) {
            warnings.push(
              `${templateRows} novos modelos de fluxo excedem o limite de ${maxTemplates} do seu plano (${count ?? 0} existentes).`,
            );
          }
        }
        // max_posts_per_workflow is the third cap the design promises at preview
        // time ("surfacing warnings up front instead of letting commit fail
        // mid-way"). Preview is called with buildCommitRows(..., null) — chunking
        // is deliberately OFF so preview counts stay stable — so every post of a
        // given client still shares ONE containerKey here, and a group larger
        // than the cap is exactly the group the commit step will split into
        // numbered containers. Warn, do not block: nothing is lost.
        //
        // perContainer is built unconditionally (not just under the maxPosts
        // guard below) because the max_active_workflows_per_client check further
        // down also needs each container's post count, to project how many
        // 'ativo' workflows a still-unchunked preview container will actually
        // become once commit rebuilds it with the real cap.
        const maxPosts = entitlements.limits.max_posts_per_workflow;
        const perContainer = new Map<string, number>();
        for (const r of rows) {
          if (r.kind !== "post") continue;
          const key = String((r as { containerKey?: unknown }).containerKey ?? "");
          perContainer.set(key, (perContainer.get(key) ?? 0) + 1);
        }
        if (counts.posts > 0 && maxPosts != null) {
          const over = [...perContainer.values()].filter((n) => n > maxPosts);
          if (over.length > 0) {
            const largest = Math.max(...over);
            warnings.push(
              over.length === 1
                ? `Um calendário do import tem ${largest} posts, acima do limite de ${maxPosts} posts por calendário do seu plano — os posts serão divididos automaticamente em vários calendários, sem perder nenhuma linha.`
                : `${over.length} calendários do import têm até ${largest} posts, acima do limite de ${maxPosts} posts por calendário do seu plano — os posts serão divididos automaticamente em vários calendários, sem perder nenhuma linha.`,
            );
          }
        }
        // max_active_workflows_per_client is the fourth (and previously missing)
        // cap the design promises at preview time. The trigger that enforces it —
        // trg_limit_workflows -> enforce_plan_count_limit(
        // 'max_active_workflows_per_client', 'direct', 'conta_id', 'cliente_id',
        // "status = 'ativo'") (20260611130003_count_triggers.sql:33-37) — differs
        // from the other three triggers in TWO ways that shape this check:
        //   - it scopes the count PER CLIENT (cliente_id), not per workspace, so
        //     the warning below groups by client instead of counting one
        //     workspace-wide total; and
        //   - it filters to status='ativo' (both the trigger's own WHEN guard
        //     and its status predicate agree), so only 'ativo' rows count —
        //     archived/concluded workflows never touch this cap.
        // Both 'container' and 'entrega' rows insert exactly one 'ativo' row into
        // workflows each (20260727000001_data_import_jobs.sql:294-316: the
        // `container` branch and the `entrega` branch each do a single `insert
        // into public.workflows (...) values (..., 'ativo', ...)`), so every
        // incoming container/entrega row is one unit against this cap — EXCEPT
        // that preview runs with post-chunking off (buildCommitRows(..., null)),
        // so a client's whole posts collection arrives as ONE container row here
        // no matter how many posts it holds. Commit rebuilds with the plan's real
        // max_posts_per_workflow cap and SPLITS that same group into
        // ceil(postCount / maxPosts) separate 'ativo' workflows — so counting
        // "1 container row = 1 workflow" would undercount exactly the clients the
        // max_posts_per_workflow warning above just flagged. perContainer (built
        // above) gives each container's post count, which is projected forward
        // through the same ceil-division commit will actually apply.
        const maxActiveWorkflows = entitlements.limits.max_active_workflows_per_client;
        const containerRowsForWorkflows = rows.filter((r): r is CommitContainerRow => r.kind === "container");
        const entregaRowsForWorkflows = rows.filter((r): r is CommitEntregaRow => r.kind === "entrega");
        if (maxActiveWorkflows != null && (containerRowsForWorkflows.length > 0 || entregaRowsForWorkflows.length > 0)) {
          const clientGroupKey = (ref: ClienteRef): string =>
            ref.type === "existing" ? `existing:${ref.clienteId}` : `created:${ref.sourceKey}`;
          const incomingByClient = new Map<string, number>();
          for (const c of containerRowsForWorkflows) {
            const key = clientGroupKey(c.clienteRef);
            const postCount = perContainer.get(c.sourceKey) ?? 0;
            // A container is only ever emitted for a non-empty group, so it is
            // always at least one workflow, even if postCount ends up 0 here
            // (defensive — should not happen with well-formed rows).
            const workflowsFromThis = maxPosts != null ? Math.max(1, Math.ceil(postCount / maxPosts)) : 1;
            incomingByClient.set(key, (incomingByClient.get(key) ?? 0) + workflowsFromThis);
          }
          for (const e of entregaRowsForWorkflows) {
            const key = clientGroupKey(e.clienteRef);
            incomingByClient.set(key, (incomingByClient.get(key) ?? 0) + 1);
          }

          const existingClienteIds = [...incomingByClient.keys()]
            .filter((k) => k.startsWith("existing:"))
            .map((k) => Number(k.slice("existing:".length)));

          // Existing active workflow counts are fetched per-client (not via a
          // single head-count) because the cap is scoped per client: a combined
          // count across every referenced client would say nothing about any
          // ONE of them exceeding the limit. db is the service-role client, so
          // conta_id scoping is manual, same as the other three checks above.
          const existingActiveByClient = new Map<number, number>();
          const clienteNameById = new Map<number, string>();
          if (existingClienteIds.length > 0) {
            for (const part of chunked(existingClienteIds)) {
              const { data: wf, error: wfErr } = await db
                .from("workflows")
                .select("cliente_id")
                .eq("conta_id", conta_id)
                .eq("status", "ativo")
                .in("cliente_id", part);
              if (wfErr) throw wfErr;
              for (const w of (wf ?? []) as Array<{ cliente_id: number }>) {
                existingActiveByClient.set(w.cliente_id, (existingActiveByClient.get(w.cliente_id) ?? 0) + 1);
              }
              const { data: cl, error: clErr } = await db
                .from("clientes")
                .select("id, nome")
                .eq("conta_id", conta_id)
                .in("id", part);
              if (clErr) throw clErr;
              for (const c of (cl ?? []) as Array<{ id: number; nome: string }>) {
                clienteNameById.set(c.id, c.nome);
              }
            }
          }
          // Created (brand-new-this-import) clients have no prior workflows, and
          // their name is already in this same payload's own cliente rows.
          const nameByCreatedSourceKey = new Map<string, string>();
          for (const r of rows) {
            if (r.kind === "cliente") nameByCreatedSourceKey.set(r.sourceKey, r.nome);
          }

          for (const [key, incoming] of incomingByClient) {
            const isExisting = key.startsWith("existing:");
            const clienteId = isExisting ? Number(key.slice("existing:".length)) : null;
            const existingCount = clienteId != null ? (existingActiveByClient.get(clienteId) ?? 0) : 0;
            const total = existingCount + incoming;
            if (total > maxActiveWorkflows) {
              const name = isExisting
                ? (clienteNameById.get(clienteId as number) ?? `cliente #${clienteId}`)
                : (nameByCreatedSourceKey.get(key.slice("created:".length)) ?? "um dos clientes do import");
              warnings.push(
                `${name} ficaria com ${total} fluxos ativos, acima do limite de ${maxActiveWorkflows} fluxos ativos por cliente do seu plano (${existingCount} existentes).`,
              );
            }
          }
        }
        return json({
          counts,
          warnings,
          limits: {
            maxClients: entitlements.limits.max_clients ?? null,
            maxWorkflowTemplates: entitlements.limits.max_workflow_templates ?? null,
            maxPostsPerWorkflow: entitlements.limits.max_posts_per_workflow ?? null,
            maxActiveWorkflowsPerClient: entitlements.limits.max_active_workflows_per_client ?? null,
          },
        });
      }

      if (action === "commit") return await handleCommit(ctx);
      if (action === "undo") return await handleUndo(ctx);

      return json({ error: "Unknown action" }, 404);
    } catch (e) {
      console.error("[data-import] error:", e);
      return json({ error: "Internal error" }, 500);
    }
  };
}

async function handleCommit({ db, conta_id, userId, body, json }: ActionCtx): Promise<Response> {
  const jobId = Number(body.jobId);
  const rows = (body.rows ?? []) as CommitRow[];
  if (!jobId || !Array.isArray(rows)) return json({ error: "Invalid payload" }, 400);
  if (rows.length > BATCH_LIMIT) return json({ error: "Commit batch too large" }, 400);
  // Job ownership is checked HERE, not only inside the RPC. `db` is the
  // service-role client (RLS bypassed): a foreign jobId makes every row fail
  // inside import_commit_row, but control still fell through to the
  // `final` update below and flipped ANOTHER workspace's job row to
  // 'completed' — resurrecting an undone job in that tenant's history/undo UI.
  //
  // `status` is selected, not just `id`: an existence-only probe passes an
  // already-undone job. import_commit_row refuses to write to one
  // (20260727000001_data_import_jobs.sql:89-90), so every row fails — but
  // control still reached the `final` update, flipping 'undone' -> 'completed',
  // re-arming the undo button on a job that was already undone and corrupting
  // the very history the audit trail exists to record. Reject it up front, the
  // same way undo already does.
  // .maybeSingle(), NOT .single(): a foreign/stale/mistyped jobId is a routine
  // zero-row result, not a failure. PostgREST's .single() sends
  // `Accept: application/vnd.pgrst.object+json`; on zero rows it replies 406
  // and postgrest-js surfaces THAT as a non-null `error` (code PGRST116) with
  // `data: null` — so the ordinary "not found" case would always take the
  // `jobErr` branch below and return a noisy 500 instead of a clean 404.
  // .maybeSingle() returns `data: null, error: null` for zero rows, leaving
  // `error` populated only for a genuine query failure. Do not "simplify" this
  // back to .single() — the mock used in tests replays whatever is queued and
  // cannot reproduce PostgREST's real 406, so it will not catch a revert.
  const { data: job, error: jobErr } = await db
    .from("import_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("conta_id", conta_id)
    .maybeSingle();
  // A genuine query failure (timeout, connection loss) must not present as
  // "job not found" — that masks a backend problem as routine user error and
  // sends the client down the wrong recovery path. Reserve 404 for a row that
  // is genuinely absent; log the real failure internally and never let its
  // text reach the client.
  if (jobErr) {
    console.error("[data-import] commit job ownership probe failed:", jobErr);
    return json({ error: "Internal error" }, 500);
  }
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status === "undone") return json({ error: "Already undone" }, 400);
  // 'undoing' is refused for exactly the same reason, one step earlier: undo has
  // claimed this job and is deleting its rows right now. Anything committed from
  // here is invisible to the undo already in flight and would be orphaned when it
  // finishes. This check is best-effort (a batch that got past it keeps running);
  // the authoritative gate is inside import_commit_row, which re-reads the job
  // status on every single row.
  if (job.status === "undoing") return json({ error: "Undo in progress" }, 400);
  const results: any[] = [];
  for (const row of rows) {
    const { data, error } = await db.rpc("import_commit_row", {
      p_conta_id: conta_id,
      p_job_id: jobId,
      p_source_row_key: row.sourceKey,
      p_kind: row.kind,
      p_payload: normalizePayload(row),
    });
    if (error) {
      console.error("[data-import] commit row failed:", row.sourceKey, error);
      // The plan-count triggers (20260611130003_count_triggers.sql) fire
      // INSIDE the RPC and raise `plan_limit_exceeded:<key>` — a bulk import
      // on a limited plan hits this partway through. Translate it into a
      // user-legible reason instead of a generic failure; the job stays
      // resumable, since committed rows are skipped on retry.
      const raw = String((error as { message?: string }).message ?? "");
      const limitKey = raw.startsWith("plan_limit_exceeded:") ? raw.slice("plan_limit_exceeded:".length).trim() : null;
      results.push({
        sourceKey: row.sourceKey,
        table: null,
        rowId: null,
        skipped: false,
        failed: true,
        reason: limitKey ? `plan_limit:${limitKey}` : "error",
      });
    } else {
      results.push({ sourceKey: row.sourceKey, table: data.table, rowId: data.row_id, skipped: data.skipped });
    }
  }
  // Last batch marks the job completed (client sets final on its last slice).
  if (body.final === true) {
    // conta-scoped as defence in depth, on top of the ownership check above.
    // `.in("status", …)` closes the same window one more time: an undo may have
    // claimed the job WHILE this batch was running (its rows all failed inside
    // the RPC, but control still arrives here), and an unconditional update would
    // flip 'undoing'/'undone' back to 'completed' — cancelling the undo's lockout
    // and re-arming the undo button on a job that was already being undone.
    await db
      .from("import_jobs")
      .update({ status: "completed" })
      .eq("id", jobId)
      .eq("conta_id", conta_id)
      .in("status", COMMITTABLE_STATUSES);
  }
  await auditQuietly(db, {
    conta_id,
    actor_user_id: userId,
    action: "import_commit_batch",
    resource_type: "import_job",
    resource_id: String(jobId),
    metadata: { rows: rows.length, failed: results.filter((r: any) => r.failed).length },
  });
  return json({ results });
}

async function handleUndo({ db, conta_id, userId, body, json }: ActionCtx): Promise<Response> {
  const jobId = Number(body.jobId);
  // .maybeSingle(), NOT .single() — same reasoning as commit's probe above:
  // .single() turns PostgREST's real zero-row 406 into a non-null `error`
  // (PGRST116), which would send every foreign/stale/mistyped jobId down the
  // `jobErr` -> 500 branch instead of the intended 404. The shared test mock
  // cannot reproduce that 406 (it replays whatever is queued regardless of
  // which method is called), so nothing here will fail if this is reverted to
  // .single() — do not "simplify" it back.
  const { data: job, error: jobErr } = await db
    .from("import_jobs")
    .select("id, conta_id, status, created_at, undo_started_at")
    .eq("id", jobId)
    .eq("conta_id", conta_id)
    .maybeSingle();
  // Same distinction as commit's probe: a real query failure here (timeout,
  // connection loss) is not "job not found" and must not be reported as one —
  // that hides a backend problem behind a routine-looking 404. Log internally,
  // return a generic 500, never the error text.
  if (jobErr) {
    console.error("[data-import] undo job ownership probe failed:", jobErr);
    return json({ error: "Internal error" }, 500);
  }
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status === "undone") return json({ error: "Already undone" }, 400);
  // A job already claimed by another undo is refused — two undos racing over the
  // same job would both report the same deletions and double-audit them. The
  // refusal is time-bounded on purpose: an undo killed mid-flight (edge runtime
  // kill) leaves the job in 'undoing' with commits locked out, and an
  // unconditional refusal would make that state permanently unrecoverable
  // through the wizard. Past UNDO_STALE_MS the claim is treated as abandoned and
  // the retry resumes — safe because the item read is redone from scratch, the
  // deletes are id-based and idempotent (a row already gone is simply not
  // returned, so `deleted` stays honest), and no commit can have added rows in
  // the meantime. A missing undo_started_at on an 'undoing' row is inconsistent
  // state, so it too is treated as resumable rather than as a permanent block.
  if (job.status === "undoing") {
    const claimedAt = job.undo_started_at ? new Date(job.undo_started_at).getTime() : null;
    if (claimedAt !== null && Number.isFinite(claimedAt) && Date.now() - claimedAt < UNDO_STALE_MS) {
      return json({ error: "Undo in progress" }, 400);
    }
  }
  // 7-day undo window (spec: Limits & error handling)
  if (Date.now() - new Date(job.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
    return json({ error: "Undo window expired" }, 400);
  }
  // CLAIM THE JOB BEFORE READING ITS ITEMS. Ordering is the whole point: the read
  // below defines the set of rows this undo will ever delete, so any commit that
  // lands a row after it is orphaned — the job ends 'undone', a retried undo
  // short-circuits on "Already undone", and nothing can ever clean those rows up
  // through the wizard. Flipping to 'undoing' first makes import_commit_row
  // refuse every subsequent row, including the remaining rows of a batch that is
  // already inside its RPC loop.
  //
  // THE CLAIM IS A COMPARE-AND-SET, and its result is CHECKED. The status read
  // above and this write are two separate round trips: between them, another undo
  // request can pass the very same checks. An unconditional update lets BOTH
  // claim the job, both snapshot the items, and both delete and report a
  // successful undo — and, worse, an update that silently affects zero rows (or
  // fails outright) leaves the job still committable while the code below starts
  // deleting, which is exactly the orphaning the 'undoing' state exists to
  // prevent. So the update is predicated on the EXACT state that was read:
  //
  //   - `.eq("status", job.status)` — the fresh case. Two racing undos both read
  //     'completed'; the first flips it to 'undoing', the second's predicate no
  //     longer matches and it updates nothing.
  //   - plus, for a stale-'undoing' resume, `undo_started_at` pinned to the value
  //     that was read (`.is(..., null)` when the row carries none — PostgREST
  //     cannot express NULL equality through `.eq`). Without it, the status
  //     predicate alone is satisfied by 'undoing' -> 'undoing' and two resumes of
  //     the same stale claim would both proceed. With it, the first resume stamps
  //     a new undo_started_at and the second matches zero rows.
  //
  // `.select("id")` makes the update RETURN the rows it changed, which is the
  // only way to tell "claimed it" from "someone else got there first" — a bare
  // update reports neither.
  let claim = db
    .from("import_jobs")
    .update({ status: "undoing", undo_started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("conta_id", conta_id)
    .eq("status", job.status);
  if (job.status === "undoing") {
    claim = job.undo_started_at == null
      ? claim.is("undo_started_at", null)
      : claim.eq("undo_started_at", job.undo_started_at);
  }
  const { data: claimed, error: claimErr } = await claim.select("id");
  // A genuine write failure is not "someone else claimed it": log it internally
  // and return the generic 500, never the database text (same rule as the probes
  // above). Either way NOTHING below this point runs — the item read and every
  // delete are past this gate.
  if (claimErr) {
    console.error("[data-import] undo claim failed:", claimErr);
    return json({ error: "Internal error" }, 500);
  }
  // Zero rows means the compare-and-set lost the race. Reuse the SAME string the
  // read-time refusal above returns: it already maps to pt-BR copy in
  // apps/crm/src/services/dataImport.ts (ERROR_MESSAGES['Undo in progress']),
  // and the user-facing situation is identical — another undo owns this job.
  // Adding a new string here would need the same key added there.
  if (((claimed ?? []) as unknown[]).length !== 1) {
    return json({ error: "Undo in progress" }, 400);
  }
  // `.eq("merged", false)` is LOAD-BEARING, not a filter for tidiness.
  // A "mesclar com existente" row records the pre-existing cliente the
  // import merged INTO, so it can resolve clienteRef and be skipped on
  // resume — but that cliente belongs to the customer and predates the
  // import. Deleting it here would cascade through their workflows,
  // etapas, posts, ideias, instagram_accounts and folders. The spec is
  // explicit: undo restores creations only, merges are never undone.
  //
  // Paged: an unpaged read is silently truncated by the project's max-rows
  // cap. Undo would then delete only the first page and STILL mark the job
  // `undone`, after which a retry returns `Already undone` and the rest is
  // permanently un-undoable.
  //
  // The loop advances by the number of rows ACTUALLY returned and stops only on
  // an EMPTY page. Breaking on `length < PAGE_SIZE` would re-introduce the very
  // dependency this pagination removes: if the project's PostgREST `max-rows` is
  // ever set below PAGE_SIZE, the first page comes back short, the read stops
  // there, and undo deletes a subset while still marking the job `undone`.
  const items: Array<{ table_name: string; row_id: string }> = [];
  for (let from = 0; ; ) {
    const { data: page, error: itemsErr } = await db
      .from("import_job_items")
      .select("table_name, row_id, source_row_key, ordinal, merged")
      .eq("job_id", jobId)
      .eq("conta_id", conta_id)
      .eq("merged", false)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (itemsErr) throw itemsErr;
    const rowsPage = (page ?? []) as Array<{ table_name: string; row_id: string }>;
    if (rowsPage.length === 0) break;
    items.push(...rowsPage);
    from += rowsPage.length;
  }

  const byTable = new Map<string, string[]>();
  for (const it of items) {
    byTable.set(it.table_name, [...(byTable.get(it.table_name) ?? []), it.row_id]);
  }
  const skippedPublished: string[] = [];
  const skippedWorkflows: string[] = [];
  const skippedTemplates: string[] = [];
  const skippedClientes: string[] = [];
  let deleted = 0;
  for (const table of UNDO_ORDER) {
    let ids = byTable.get(table) ?? [];
    if (!ids.length) continue;
    if (table === "workflow_posts") {
      const published = await guardPublishedPosts(db, conta_id, ids);
      skippedPublished.push(...published);
      const skip = new Set(published);
      ids = ids.filter((id) => !skip.has(id));
    }
    if (table === "workflows") {
      const keptIds = await guardContainerWorkflows(db, conta_id, ids);
      skippedWorkflows.push(...keptIds);
      const keep = new Set(keptIds);
      ids = ids.filter((id) => !keep.has(id));
    }
    if (table === "workflow_templates") {
      const keptIds = await guardReferencedTemplates(db, conta_id, ids);
      skippedTemplates.push(...keptIds);
      const keep = new Set(keptIds);
      ids = ids.filter((id) => !keep.has(id));
    }
    if (table === "clientes") {
      const keptIds = await guardReferencedClientes(db, conta_id, ids);
      skippedClientes.push(...keptIds);
      const keep = new Set(keptIds);
      ids = ids.filter((id) => !keep.has(id));
    }
    if (ids.length) {
      const numeric = table !== "ideias";
      // ideias is scoped by workspace_id, every other target by conta_id
      // (both hold the workspace uuid).
      const scopeCol = table === "ideias" ? "workspace_id" : "conta_id";
      for (const part of chunked(ids)) {
        // `.select("id")` makes the delete return the rows it actually removed,
        // so `deleted` reports reality — a row filtered out by the scope guard or
        // already gone must not inflate the number shown to the user.
        const { data: removed, error } = await db
          .from(table)
          .delete()
          .in("id", numeric ? part.map(Number) : part)
          .eq(scopeCol, conta_id)
          .select("id");
        if (error) throw error;
        deleted += ((removed ?? []) as unknown[]).length;
      }
    }
  }
  await db.from("import_jobs").update({ status: "undone" }).eq("id", jobId).eq("conta_id", conta_id);
  await auditQuietly(db, {
    conta_id,
    actor_user_id: userId,
    action: "import_undo",
    resource_type: "import_job",
    resource_id: String(jobId),
    metadata: { deleted, skippedPublished, skippedWorkflows, skippedTemplates, skippedClientes },
  });
  return json({ deleted, skippedPublished, skippedWorkflows, skippedTemplates, skippedClientes });
}

/** Maps a CommitRow's wire fields onto the RPC's jsonb payload keys. */
function normalizePayload(row: CommitRow): Record<string, unknown> {
  const { kind, sourceKey: _sk, ...rest } = row as CommitRow & Record<string, unknown>;
  if (kind === "cliente" && (rest as { merge?: { clienteId: number } }).merge) {
    const { merge, ...fields } = rest as any;
    return { ...fields, mergeClienteId: merge.clienteId };
  }
  if (kind === "post") return normalizePostPayload(rest as Record<string, unknown>);
  return rest as Record<string, unknown>;
}

// The importable post statuses, mirroring the allow-list inside import_commit_row
// (supabase/migrations/20260727000001_data_import_jobs.sql). 'agendado' and
// 'falha_publicacao' are deliberately absent: the publish crons claim on
// 'agendado' and imported posts carry no media.
const IMPORTABLE_POST_STATUSES = new Set([
  "rascunho",
  "revisao_interna",
  "aprovado_interno",
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "postado",
]);

/**
 * Applies the post status/date clamp at the wire boundary, so the payload handed
 * to the RPC can never describe a post as published on a date it was not.
 *
 * The RPC remains AUTHORITATIVE — it re-derives all three fields itself, because
 * /data-import/commit is not the only conceivable caller and the database is the
 * last line. This mirror exists because it is the only layer the Deno suite can
 * observe (the RPC is mocked), and because the payload is what the audit trail
 * and any future replay would carry. Both implementations must agree; they are
 * commented as a pair. Any change here needs the same change in the migration.
 *
 * INVARIANT (both layers): publishedAt is non-null only when status is 'postado'.
 * The source date is never discarded on a downgrade — it moves to scheduledAt so
 * the post still lands on the calendar on the day the source tool said.
 */
function normalizePostPayload(fields: Record<string, unknown>): Record<string, unknown> {
  const rawStatus = typeof fields.status === "string" ? fields.status : "rascunho";
  let status = rawStatus.trim().toLowerCase();
  if (!IMPORTABLE_POST_STATUSES.has(status)) status = "rascunho";
  const scheduledAt = (fields.scheduledAt ?? null) as unknown;
  const publishedAt = (fields.publishedAt ?? null) as unknown;
  // Whichever key carried the date; publishedAt wins, matching the RPC's coalesce.
  const sourceAt = publishedAt ?? scheduledAt;
  const ms = typeof sourceAt === "string" ? Date.parse(sourceAt) : NaN;
  if (status === "postado") {
    if (!Number.isFinite(ms)) {
      // Dateless (or unparseable) 'postado' rows have no date to have been
      // published on — 'postado' with publishedAt null is an internally
      // inconsistent "published with nothing published" state. Downgrades to
      // 'rascunho', mirroring both the client wizard's postRow clamp
      // (buildCommitRows.ts) and the SQL clamp's matching branch.
      status = "rascunho";
    } else if (ms > Date.now()) {
      status = "aprovado_cliente";
    }
  }
  return status === "postado"
    ? { ...fields, status, scheduledAt, publishedAt: sourceAt }
    : { ...fields, status, scheduledAt: scheduledAt ?? publishedAt, publishedAt: null };
}
