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

// workflow_etapas is deliberately ABSENT: it has no conta_id column (it is
// tenant-scoped transitively through workflow_id), so a .eq("conta_id", ...)
// delete against it raises `column "conta_id" does not exist` and aborts the
// whole undo. It needs no explicit delete anyway — workflow_etapas.workflow_id
// is ON DELETE CASCADE from workflows (20260301_baseline_schema.sql:159).
const UNDO_ORDER = ["workflow_posts", "workflows", "workflow_templates", "ideias", "clientes"];
const BATCH_LIMIT = 200;

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
    const action = parts[parts.indexOf("data-import") + 1] ?? "";
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* actions validate below */
    }

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

      if (action === "commit") {
        const jobId = Number(body.jobId);
        const rows = (body.rows ?? []) as CommitRow[];
        if (!jobId || !Array.isArray(rows)) return json({ error: "Invalid payload" }, 400);
        if (rows.length > BATCH_LIMIT) return json({ error: "Batch too large" }, 400);
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
            const limitKey = raw.startsWith("plan_limit_exceeded:")
              ? raw.slice("plan_limit_exceeded:".length).trim()
              : null;
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
          await db.from("import_jobs").update({ status: "completed" }).eq("id", jobId);
        }
        await insertAuditLog(db, {
          conta_id,
          actor_user_id: user.id,
          action: "import_commit_batch",
          resource_type: "import_job",
          resource_id: String(jobId),
          metadata: { rows: rows.length, failed: results.filter((r: any) => r.failed).length },
        });
        return json({ results });
      }

      if (action === "undo") {
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
        const { data: items, error: itemsErr } = await db
          .from("import_job_items")
          .select("table_name, row_id, source_row_key, ordinal, merged")
          .eq("job_id", jobId)
          .eq("merged", false);
        if (itemsErr) throw itemsErr;

        const byTable = new Map<string, string[]>();
        for (const it of items ?? []) {
          byTable.set(it.table_name, [...(byTable.get(it.table_name) ?? []), it.row_id]);
        }
        const skippedPublished: string[] = [];
        const skippedWorkflows: string[] = [];
        let deleted = 0;
        for (const table of UNDO_ORDER) {
          let ids = byTable.get(table) ?? [];
          if (!ids.length) continue;
          if (table === "workflow_posts") {
            const { data: published } = await db
              .from("workflow_posts")
              .select("id, instagram_media_id, tiktok_post_id")
              .in("id", ids.map(Number))
              .or("instagram_media_id.not.is.null,tiktok_post_id.not.is.null");
            const publishedIds = new Set((published ?? []).map((p: any) => String(p.id)));
            skippedPublished.push(...publishedIds);
            ids = ids.filter((id) => !publishedIds.has(id));
          }
          if (table === "workflows") {
            // workflow_posts.workflow_id is ON DELETE CASCADE, so deleting a
            // container workflow would silently destroy the very published post
            // the guard above just protected — and any post the user added to it
            // after the import. Keep any workflow that still holds posts.
            const { data: remaining } = await db
              .from("workflow_posts")
              .select("workflow_id")
              .in("workflow_id", ids.map(Number));
            const keep = new Set((remaining ?? []).map((r: any) => String(r.workflow_id)));
            skippedWorkflows.push(...keep);
            ids = ids.filter((id) => !keep.has(id));
          }
          if (ids.length) {
            const numeric = table !== "ideias";
            // ideias is scoped by workspace_id, every other target by conta_id
            // (both hold the workspace uuid).
            const scopeCol = table === "ideias" ? "workspace_id" : "conta_id";
            const { error } = await db
              .from(table)
              .delete()
              .in("id", numeric ? ids.map(Number) : ids)
              .eq(scopeCol, conta_id);
            if (error) throw error;
            deleted += ids.length;
          }
        }
        await db.from("import_jobs").update({ status: "undone" }).eq("id", jobId);
        await insertAuditLog(db, {
          conta_id,
          actor_user_id: user.id,
          action: "import_undo",
          resource_type: "import_job",
          resource_id: String(jobId),
          metadata: { deleted, skippedPublished, skippedWorkflows },
        });
        return json({ deleted, skippedPublished, skippedWorkflows });
      }

      return json({ error: "Unknown action" }, 404);
    } catch (e) {
      console.error("[data-import] error:", e);
      return json({ error: "Internal error" }, 500);
    }
  };
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
