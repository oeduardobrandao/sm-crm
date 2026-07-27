import { createJsonResponder } from "../_shared/http.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import type { CommitRow } from "./types.ts";

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
// is ON DELETE CASCADE from workflows (20260301_baseline_schema.sql:159).
const UNDO_ORDER = ["workflow_posts", "workflows", "workflow_templates", "ideias", "clientes"];
const BATCH_LIMIT = 200;
// preview is a pure counting pass over the WHOLE parsed file (commit is what gets
// sliced into BATCH_LIMIT batches), so it needs its own, larger ceiling — but it
// still needs one, so a malformed/huge payload can't be walked unbounded.
const PREVIEW_LIMIT = 5000;
// Supabase's REST layer applies a project-level max-rows cap (commonly 1000), so
// every unbounded read has to be paged explicitly — the handler must not depend on
// that setting in either direction. A short page is the end-of-data signal.
const PAGE_SIZE = 500;
// `.in()` lists ride in the query string, so they are chunked to keep URLs sane.
const IN_CHUNK = 500;

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
 * workflow_posts pass. A post that already carries a platform id was published to
 * Instagram/TikTok; deleting it would drop the record of live content.
 * Returns the ids to SKIP.
 */
async function guardPublishedPosts(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const published = new Set<string>();
  for (const part of chunked(ids)) {
    const { data, error } = await db
      .from("workflow_posts")
      .select("id, instagram_media_id, tiktok_post_id")
      .eq("conta_id", conta_id)
      .in("id", part.map(Number))
      .or("instagram_media_id.not.is.null,tiktok_post_id.not.is.null");
    if (error) throw error;
    for (const p of (data ?? []) as any[]) published.add(String(p.id));
  }
  return [...published];
}

/**
 * workflows pass. workflow_posts.workflow_id is ON DELETE CASCADE, so deleting a
 * container workflow would silently destroy the very published post
 * guardPublishedPosts just protected — and any post the user added to it after
 * the import. Returns the ids to KEEP: any workflow that still holds posts.
 */
async function guardContainerWorkflows(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const part of chunked(ids)) {
    const { data, error } = await db
      .from("workflow_posts")
      .select("workflow_id")
      .eq("conta_id", conta_id)
      .in("workflow_id", part.map(Number));
    if (error) throw error;
    for (const r of (data ?? []) as any[]) keep.add(String(r.workflow_id));
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
 *   grep -rn "REFERENCES clientes(id) ON DELETE CASCADE" supabase/migrations/
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

    const ent = await deps.resolveEntitlements(db, conta_id);
    if (!ent?.features?.feature_csv_import) return json({ error: "upgrade_required" }, 403);

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    // Guard the indexOf: when the segment is absent it returns -1 and a bare
    // `parts[idx + 1]` silently reads parts[0], routing an unknown path to a real
    // action. Mirrors ideia-media-manage/handler.ts:43-44.
    const actionIdx = parts.indexOf("data-import");
    const action = actionIdx >= 0 ? (parts[actionIdx + 1] ?? "") : "";
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
        // AI refinement lands in Task 10; without a key the client keeps its heuristic proposal.
        return json({ proposal: null });
      }

      if (action === "preview") {
        const rows = (body.rows ?? []) as CommitRow[];
        // Same shape guard commit applies: without it `rows: "abc"` reaches
        // rows.filter() below and surfaces as an opaque 500.
        if (!Array.isArray(rows)) return json({ error: "Invalid payload" }, 400);
        // Distinct from commit's message on purpose: the two actions enforce
        // different caps (PREVIEW_LIMIT vs BATCH_LIMIT) and a shared string
        // leaves the client unable to tell which one it hit.
        if (rows.length > PREVIEW_LIMIT) return json({ error: "Preview batch too large" }, 400);
        const counts: Record<string, number> = { clientes: 0, posts: 0, entregas: 0, ideias: 0 };
        for (const r of rows) {
          if (r.kind === "cliente") counts.clientes++;
          else if (r.kind === "post") counts.posts++;
          else if (r.kind === "entrega") counts.entregas++;
          else if (r.kind === "ideia") counts.ideias++;
        }
        const warnings: string[] = [];
        const maxClients = ent.limits.max_clients;
        if (counts.clientes > 0 && maxClients != null) {
          // db is the service-role client (RLS bypassed) — every count MUST be
          // conta_id-scoped by hand or it returns a platform-wide total.
          const { count } = await db
            .from("clientes")
            .select("id", { count: "exact", head: true })
            .eq("conta_id", conta_id)
            .eq("status", "ativo");
          if ((count ?? 0) + counts.clientes > maxClients) {
            warnings.push(
              `${counts.clientes} novos clientes excedem o limite de ${maxClients} do seu plano (${count ?? 0} existentes).`,
            );
          }
        }
        const templateRows = rows.filter((r) => r.kind === "template").length;
        const maxTemplates = ent.limits.max_workflow_templates;
        if (templateRows > 0 && maxTemplates != null) {
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
        return json({
          counts,
          warnings,
          limits: {
            maxClients: ent.limits.max_clients ?? null,
            maxWorkflowTemplates: ent.limits.max_workflow_templates ?? null,
            maxPostsPerWorkflow: ent.limits.max_posts_per_workflow ?? null,
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
  const { data: job } = await db
    .from("import_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("conta_id", conta_id)
    .single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status === "undone") return json({ error: "Already undone" }, 400);
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
    await db.from("import_jobs").update({ status: "completed" }).eq("id", jobId).eq("conta_id", conta_id);
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
  const { data: job } = await db
    .from("import_jobs")
    .select("id, conta_id, status, created_at")
    .eq("id", jobId)
    .eq("conta_id", conta_id)
    .single();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status === "undone") return json({ error: "Already undone" }, 400);
  // 7-day undo window (spec: Limits & error handling)
  if (Date.now() - new Date(job.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
    return json({ error: "Undo window expired" }, 400);
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
    metadata: { deleted, skippedPublished, skippedWorkflows, skippedClientes },
  });
  return json({ deleted, skippedPublished, skippedWorkflows, skippedClientes });
}

/** Maps a CommitRow's wire fields onto the RPC's jsonb payload keys. */
function normalizePayload(row: CommitRow): Record<string, unknown> {
  const { kind, sourceKey: _sk, ...rest } = row as CommitRow & Record<string, unknown>;
  if (kind === "cliente" && (rest as { merge?: { clienteId: number } }).merge) {
    const { merge, ...fields } = rest as any;
    return { ...fields, mergeClienteId: merge.clienteId };
  }
  return rest as Record<string, unknown>;
}
