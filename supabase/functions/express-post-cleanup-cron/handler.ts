import { createJsonResponder } from "../_shared/http.ts";

// ---------------------------------------------------------------------------
// Auth wrapper: checks `x-cron-secret` BEFORE any work and delegates to `run`.
// ---------------------------------------------------------------------------

interface ExpressPostCleanupCronDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  cronSecret: string;
  run: (req: Request, json: ReturnType<typeof createJsonResponder>) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createExpressPostCleanupCronHandler(deps: ExpressPostCleanupCronDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    return deps.run(req, json);
  };
}

// ---------------------------------------------------------------------------
// Business logic: dependency-injected, testable without a network or a real
// database. `index.ts` wires the real supabase-js client in as `db` (cast --
// the client has no generated Database type, so its real filter-builder
// methods already satisfy this narrower duck-typed slice).
// ---------------------------------------------------------------------------

export interface DbError {
  message: string;
}

/** Narrow slice of the PostgREST filter-builder chain this function drives:
 * every read is a `.select()` followed by some combination of the operators
 * below, and every write is `.update()`/`.delete()` followed by `eq`/`in`. */
export interface FilterChain<T>
  extends PromiseLike<{ data: T[] | null; error: DbError | null }> {
  eq(column: string, value: unknown): FilterChain<T>;
  not(column: string, operator: string, value: unknown): FilterChain<T>;
  is(column: string, value: null): FilterChain<T>;
  like(column: string, pattern: string): FilterChain<T>;
  lt(column: string, value: string): FilterChain<T>;
  lte(column: string, value: number): FilterChain<T>;
  in(column: string, values: unknown[]): FilterChain<T>;
}

export interface MutationChain extends PromiseLike<{ error: DbError | null }> {
  eq(column: string, value: unknown): MutationChain;
  in(column: string, values: unknown[]): MutationChain;
}

export interface ExpressPostCleanupDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): {
    // deno-lint-ignore no-explicit-any
    select(columns: string): FilterChain<any>;
    update(patch: Record<string, unknown>): MutationChain;
    delete(): MutationChain;
  };
}

export interface ExpressPostCleanupCronResult {
  deleted: number;
  skipped: number;
  failed: number;
  concluded: number;
  avulso_deleted: number;
}

/**
 * Deletes any of `fileIds` that are now orphaned (`reference_count <= 0`).
 * Shared by pass 2 (legacy title-prefix workflow GC) and pass 3 (avulso draft
 * GC) -- both delete posts first, then sweep the files those posts referenced.
 */
async function deleteOrphanFiles(db: ExpressPostCleanupDb, fileIds: number[]): Promise<void> {
  const { data: orphanFiles } = await db
    .from("files")
    .select("id")
    .in("id", fileIds)
    .lte("reference_count", 0);

  for (const f of (orphanFiles ?? []) as Array<{ id: number }>) {
    const { error: fileDelErr } = await db.from("files").delete().eq("id", f.id);
    if (fileDelErr) {
      console.error(`Failed to delete orphan file ${f.id}:`, fileDelErr.message);
    }
  }
}

export async function runExpressPostCleanupCron(
  db: ExpressPostCleanupDb,
  cutoff: string,
): Promise<ExpressPostCleanupCronResult> {
  // ---- Pass 1: conclude published express workflows -----------------------
  // An approval-mode express post publishes only after the client approves,
  // with nobody left on the page to conclude the workflow (publish-now mode
  // concludes it client-side). Close any express workflow whose posts were
  // all published so it doesn't linger on the board.
  // Candidates come from the posts' is_express marker, never from the
  // workflow title: the title is user-editable in the drawer, so it can both
  // falsely match a renamed regular workflow and miss a renamed express one.
  // `.not("workflow_id", "is", null)` excludes avulso express posts (no
  // workflow to conclude) -- without it the first published avulso express
  // injects `null` into the `.in("id", candidateIds)` lookup below.
  let concluded = 0;
  const { data: expressPostRows, error: expressErr } = await db
    .from("workflow_posts")
    .select("workflow_id")
    .eq("is_express", true)
    .eq("status", "postado")
    .not("workflow_id", "is", null);

  if (expressErr) throw expressErr;

  const candidateIds = [
    ...new Set((expressPostRows ?? []).map((r: { workflow_id: number }) => r.workflow_id)),
  ];

  if (candidateIds.length > 0) {
    const { data: activeExpress, error: activeErr } = await db
      .from("workflows")
      .select("id")
      .in("id", candidateIds)
      .eq("status", "ativo");

    if (activeErr) throw activeErr;

    for (const wf of (activeExpress ?? []) as Array<{ id: number }>) {
      const { data: posts } = await db
        .from("workflow_posts")
        .select("id, status, is_express")
        .eq("workflow_id", wf.id);

      // Conclude only when every post is a published express post; a mixed
      // workflow (someone added a regular post to it) is left alone.
      const allExpressPostado = (posts ?? []).length > 0 &&
        (posts ?? []).every(
          (p: { status: string; is_express: boolean }) =>
            p.status === "postado" && p.is_express === true,
        );
      if (!allExpressPostado) continue;

      const { error: concludeErr } = await db
        .from("workflows")
        .update({ status: "concluido" })
        .eq("id", wf.id);

      if (concludeErr) {
        console.error(`Failed to conclude workflow ${wf.id}:`, concludeErr.message);
        continue;
      }
      concluded++;
    }
  }

  // ---- Pass 2: GC abandoned legacy express workflows (title-prefix) -------
  // Legacy path: express posts created inside a disposable "Post Express -"
  // workflow (pre-avulso). Kept during the transition; removing it is a
  // follow-up once Task 17 stops creating these workflows.
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  const { data: orphanWorkflows, error: fetchErr } = await db
    .from("workflows")
    .select("id")
    .like("titulo", "Post Express -%")
    .eq("status", "ativo")
    .lt("created_at", cutoff);

  if (fetchErr) throw fetchErr;

  for (const wf of (orphanWorkflows ?? []) as Array<{ id: number }>) {
    const { data: posts } = await db
      .from("workflow_posts")
      .select("id, status")
      .eq("workflow_id", wf.id);

    const allRascunho = (posts ?? []).every((p: { status: string }) => p.status === "rascunho");
    if (!allRascunho) {
      skipped++;
      continue;
    }

    const postIds = (posts ?? []).map((p: { id: number }) => p.id);

    let fileIds: number[] = [];
    if (postIds.length > 0) {
      const { data: links } = await db
        .from("post_file_links")
        .select("file_id")
        .in("post_id", postIds);
      fileIds = [...new Set((links ?? []).map((l: { file_id: number }) => l.file_id))];
    }

    const { error: delErr } = await db
      .from("workflows")
      .delete()
      .eq("id", wf.id);

    if (delErr) {
      console.error(`Failed to delete workflow ${wf.id}:`, delErr.message);
      failed++;
      continue;
    }

    if (fileIds.length > 0) {
      await deleteOrphanFiles(db, fileIds);
    }

    deleted++;
  }

  // ---- Pass 3: GC abandoned avulso express drafts --------------------------
  // An avulso express post (workflow_id NULL, Task 17) has no disposable
  // workflow to anchor pass 2's title-prefix scan, so it needs its own
  // predicate: is_express drafts, disjoint from passes 1-2 via
  // `workflow_id IS NULL`. There's no workflow to delete here -- the posts
  // themselves are the unit of deletion, so this deletes workflow_posts
  // directly rather than relying on a workflow's cascade.
  let avulsoDeleted = 0;

  const { data: avulsoDrafts, error: avulsoErr } = await db
    .from("workflow_posts")
    .select("id")
    .eq("is_express", true)
    .is("workflow_id", null)
    .eq("status", "rascunho")
    .lt("created_at", cutoff);

  if (avulsoErr) throw avulsoErr;

  const avulsoPostIds = (avulsoDrafts ?? []).map((p: { id: number }) => p.id);

  if (avulsoPostIds.length > 0) {
    const { data: links } = await db
      .from("post_file_links")
      .select("file_id")
      .in("post_id", avulsoPostIds);
    const fileIds = [...new Set((links ?? []).map((l: { file_id: number }) => l.file_id))];

    const { error: delErr } = await db
      .from("workflow_posts")
      .delete()
      .in("id", avulsoPostIds);

    if (delErr) {
      console.error("Failed to delete avulso express drafts:", delErr.message);
    } else {
      avulsoDeleted = avulsoPostIds.length;
      if (fileIds.length > 0) {
        await deleteOrphanFiles(db, fileIds);
      }
    }
  }

  return { deleted, skipped, failed, concluded, avulso_deleted: avulsoDeleted };
}
