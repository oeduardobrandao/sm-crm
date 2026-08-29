import { assert, assertEquals } from "./assert.ts";
import {
  type DbError,
  type ExpressPostCleanupDb,
  runExpressPostCleanupCron,
} from "../express-post-cleanup-cron/handler.ts";

/**
 * Generic in-memory fake of the four tables this cron touches:
 * `workflow_posts`, `workflows`, `post_file_links`, `files`. Rather than
 * scripting canned responses per call (several different filter shapes hit
 * the same table -- e.g. `workflows.select("id")` is used by both pass 1's
 * `.in().eq()` lookup and pass 2's `.like().eq().lt()` scan), the fake
 * interprets the filter chain against real in-memory rows, so every read
 * reflects the current state and every write (`update`/`delete`) mutates it
 * -- the same shape the real PostgREST client + Postgres give the handler.
 *
 * `errorOn` lets a test script a `{ data: null, error }` result for a given
 * table + operation; it receives the accumulated filters so a test can target
 * one specific query shape (e.g. only the `.is("workflow_id", null)` pass 3
 * scan) without also poisoning every other call against the same table.
 */
type Row = Record<string, unknown>;

type FilterOp =
  | { op: "eq"; column: string; value: unknown }
  | { op: "not"; column: string; operator: string; value: unknown }
  | { op: "is"; column: string; value: null }
  | { op: "like"; column: string; pattern: string }
  | { op: "lt"; column: string; value: string }
  | { op: "lte"; column: string; value: number }
  | { op: "in"; column: string; values: unknown[] };

function matchesRow(row: Row, filters: FilterOp[]): boolean {
  return filters.every((f) => {
    switch (f.op) {
      case "eq":
        return row[f.column] === f.value;
      case "not":
        assert(f.operator === "is" && f.value === null, `unsupported not() shape: ${f.operator}`);
        return row[f.column] !== null && row[f.column] !== undefined;
      case "is":
        return row[f.column] === null || row[f.column] === undefined;
      case "like": {
        assert(f.pattern.endsWith("%"), `unsupported like() pattern: ${f.pattern}`);
        const prefix = f.pattern.slice(0, -1);
        return typeof row[f.column] === "string" && (row[f.column] as string).startsWith(prefix);
      }
      case "lt":
        return (row[f.column] as string) < f.value;
      case "lte":
        return (row[f.column] as number) <= f.value;
      case "in":
        return f.values.includes(row[f.column]);
    }
  });
}

type ErrorHook = (table: string, op: "select" | "update" | "delete", filters: FilterOp[]) => DbError | null;

function makeSelectChain(table: string, rows: Row[], errorOn?: ErrorHook) {
  const filters: FilterOp[] = [];
  // deno-lint-ignore no-explicit-any
  const chain: any = {
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return chain;
    },
    not(column: string, operator: string, value: unknown) {
      filters.push({ op: "not", column, operator, value });
      return chain;
    },
    is(column: string, value: null) {
      filters.push({ op: "is", column, value });
      return chain;
    },
    like(column: string, pattern: string) {
      filters.push({ op: "like", column, pattern });
      return chain;
    },
    lt(column: string, value: string) {
      filters.push({ op: "lt", column, value });
      return chain;
    },
    lte(column: string, value: number) {
      filters.push({ op: "lte", column, value });
      return chain;
    },
    in(column: string, values: unknown[]) {
      filters.push({ op: "in", column, values });
      return chain;
    },
    then(onFulfilled: (v: { data: Row[] | null; error: DbError | null }) => unknown) {
      const err = errorOn?.(table, "select", filters) ?? null;
      if (err) return Promise.resolve(onFulfilled({ data: null, error: err }));
      const data = rows.filter((r) => matchesRow(r, filters));
      return Promise.resolve(onFulfilled({ data, error: null }));
    },
  };
  return chain;
}

function makeMutationChain(
  table: string,
  op: "update" | "delete",
  rows: Row[],
  apply: (matches: Row[]) => void,
  errorOn?: ErrorHook,
) {
  const filters: FilterOp[] = [];
  // deno-lint-ignore no-explicit-any
  const chain: any = {
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return chain;
    },
    in(column: string, values: unknown[]) {
      filters.push({ op: "in", column, values });
      return chain;
    },
    then(onFulfilled: (v: { error: DbError | null }) => unknown) {
      const err = errorOn?.(table, op, filters) ?? null;
      if (err) return Promise.resolve(onFulfilled({ error: err }));
      const matches = rows.filter((r) => matchesRow(r, filters));
      apply(matches);
      return Promise.resolve(onFulfilled({ error: null }));
    },
  };
  return chain;
}

interface Seed {
  workflow_posts?: Row[];
  workflows?: Row[];
  post_file_links?: Row[];
  files?: Row[];
}

function makeFakeDb(seed: Seed, errorOn?: ErrorHook) {
  const tables: Record<string, Row[]> = {
    workflow_posts: seed.workflow_posts ?? [],
    workflows: seed.workflows ?? [],
    post_file_links: seed.post_file_links ?? [],
    files: seed.files ?? [],
  };

  const db: ExpressPostCleanupDb = {
    from(table: string) {
      const rows = tables[table];
      assert(rows !== undefined, `fake db: unknown table ${table}`);
      return {
        select(_cols: string) {
          return makeSelectChain(table, rows, errorOn);
        },
        update(patch: Record<string, unknown>) {
          return makeMutationChain(table, "update", rows, (matches) => {
            for (const m of matches) Object.assign(m, patch);
          }, errorOn);
        },
        delete() {
          return makeMutationChain(table, "delete", rows, (matches) => {
            for (const m of matches) {
              const idx = rows.indexOf(m);
              if (idx >= 0) rows.splice(idx, 1);
            }
          }, errorOn);
        },
      };
    },
  };

  return { db, tables };
}

const CUTOFF = "2026-08-28T00:00:00.000Z";
const OLD = "2026-08-20T00:00:00.000Z"; // before cutoff
const RECENT = "2026-08-28T12:00:00.000Z"; // after cutoff

// ---------------------------------------------------------------------------
// Pass 1: conclude published express workflows
// ---------------------------------------------------------------------------

Deno.test("pass1: concludes a workflow whose posts are all express + postado", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 1, titulo: "Post Express - Cliente X", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 10, workflow_id: 1, is_express: true, status: "postado", created_at: OLD },
      { id: 11, workflow_id: 1, is_express: true, status: "postado", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.concluded, 1);
  assertEquals(tables.workflows[0].status, "concluido");
});

Deno.test("pass1: leaves a mixed workflow alone (one post is not express)", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 1, titulo: "Fluxo normal", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 10, workflow_id: 1, is_express: true, status: "postado", created_at: OLD },
      { id: 11, workflow_id: 1, is_express: false, status: "postado", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.concluded, 0);
  assertEquals(tables.workflows[0].status, "ativo");
});

Deno.test("pass1: leaves a workflow alone when a post is still rascunho", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 1, titulo: "Post Express - Cliente X", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 10, workflow_id: 1, is_express: true, status: "postado", created_at: OLD },
      { id: 11, workflow_id: 1, is_express: true, status: "rascunho", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.concluded, 0);
  assertEquals(tables.workflows[0].status, "ativo");
});

// ---------------------------------------------------------------------------
// Pass 2: GC abandoned legacy title-prefixed express workflows (unchanged)
// ---------------------------------------------------------------------------

Deno.test("pass2: deletes an abandoned legacy express workflow and its orphan file", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 2, titulo: "Post Express - Cliente Y", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 20, workflow_id: 2, is_express: true, status: "rascunho", created_at: OLD },
    ],
    post_file_links: [{ post_id: 20, file_id: 100 }],
    files: [{ id: 100, reference_count: 0 }],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 1);
  assertEquals(result.skipped, 0);
  assertEquals(result.failed, 0);
  assertEquals(tables.workflows.length, 0);
  assertEquals(tables.files.length, 0);
});

Deno.test("pass2: keeps a file still referenced elsewhere (reference_count > 0)", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 2, titulo: "Post Express - Cliente Y", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 20, workflow_id: 2, is_express: true, status: "rascunho", created_at: OLD },
    ],
    post_file_links: [{ post_id: 20, file_id: 100 }],
    files: [{ id: 100, reference_count: 1 }],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 1);
  assertEquals(tables.files.length, 1, "still-referenced file must survive");
});

Deno.test("pass2: skips a workflow when not every post is rascunho", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 2, titulo: "Post Express - Cliente Y", status: "ativo", created_at: OLD }],
    workflow_posts: [
      // "revisao_interna", not "postado": deliberately NOT a pass 1
      // conclusion candidate, so this isolates pass 2's own skip logic.
      { id: 20, workflow_id: 2, is_express: true, status: "revisao_interna", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 0);
  assertEquals(result.skipped, 1);
  assertEquals(tables.workflows.length, 1, "skipped workflow must survive");
});

Deno.test("pass2: leaves a workflow younger than the cutoff untouched", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 2, titulo: "Post Express - Cliente Y", status: "ativo", created_at: RECENT }],
    workflow_posts: [
      { id: 20, workflow_id: 2, is_express: true, status: "rascunho", created_at: RECENT },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 0);
  assertEquals(tables.workflows.length, 1);
});

Deno.test("pass2: counts a delete failure and continues (workflow survives)", async () => {
  const { db, tables } = makeFakeDb(
    {
      workflows: [{ id: 2, titulo: "Post Express - Cliente Y", status: "ativo", created_at: OLD }],
      workflow_posts: [
        { id: 20, workflow_id: 2, is_express: true, status: "rascunho", created_at: OLD },
      ],
    },
    (table, op) => (table === "workflows" && op === "delete" ? { message: "db down" } : null),
  );
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 0);
  assertEquals(result.failed, 1);
  assertEquals(tables.workflows.length, 1, "failed delete must not remove the row");
});

// ---------------------------------------------------------------------------
// Pass 3: GC abandoned avulso express drafts (new)
// ---------------------------------------------------------------------------

Deno.test("pass3: deletes an abandoned avulso express draft and its orphan file", async () => {
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 30, workflow_id: null, cliente_id: 5, is_express: true, status: "rascunho", created_at: OLD },
    ],
    post_file_links: [{ post_id: 30, file_id: 200 }],
    files: [{ id: 200, reference_count: 0 }],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.avulso_deleted, 1);
  assertEquals(tables.workflow_posts.length, 0);
  assertEquals(tables.files.length, 0);
});

Deno.test("pass3: keeps a file the avulso draft shared with something else", async () => {
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 30, workflow_id: null, cliente_id: 5, is_express: true, status: "rascunho", created_at: OLD },
    ],
    post_file_links: [{ post_id: 30, file_id: 200 }],
    files: [{ id: 200, reference_count: 1 }],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.avulso_deleted, 1);
  assertEquals(tables.files.length, 1);
});

Deno.test("pass3: leaves an avulso express draft younger than the cutoff untouched", async () => {
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 30, workflow_id: null, cliente_id: 5, is_express: true, status: "rascunho", created_at: RECENT },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.avulso_deleted, 0);
  assertEquals(tables.workflow_posts.length, 1);
});

Deno.test("pass3: leaves an avulso draft that is not express untouched", async () => {
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 30, workflow_id: null, cliente_id: 5, is_express: false, status: "rascunho", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.avulso_deleted, 0);
  assertEquals(tables.workflow_posts.length, 1);
});

Deno.test("pass3: leaves a parented express draft untouched (workflow_id set, no title match)", async () => {
  const { db, tables } = makeFakeDb({
    workflows: [{ id: 3, titulo: "Fluxo qualquer", status: "ativo", created_at: OLD }],
    workflow_posts: [
      { id: 31, workflow_id: 3, is_express: true, status: "rascunho", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.avulso_deleted, 0);
  assertEquals(result.deleted, 0, "not title-prefixed, so pass 2 does not touch it either");
  assertEquals(tables.workflow_posts.length, 1);
});

// ---------------------------------------------------------------------------
// Combined run: published avulso express (pass 1) + abandoned avulso draft
// (pass 3) together -- the scenario the brief calls out explicitly.
// ---------------------------------------------------------------------------

Deno.test("run: a published avulso express post does not break pass 1, while an abandoned avulso draft is cleaned by pass 3, in the same run", async () => {
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      // Published avulso express post: workflow_id NULL. Before the
      // `.not("workflow_id", "is", null)` fix, this row's null workflow_id
      // would land in candidateIds and poison the `.in("id", candidateIds)`
      // lookup against `workflows`.
      { id: 40, workflow_id: null, cliente_id: 7, is_express: true, status: "postado", created_at: OLD },
      // Abandoned avulso draft: pass 3's target.
      { id: 41, workflow_id: null, cliente_id: 7, is_express: true, status: "rascunho", created_at: OLD },
    ],
    post_file_links: [{ post_id: 41, file_id: 300 }],
    files: [{ id: 300, reference_count: 0 }],
  });

  const result = await runExpressPostCleanupCron(db, CUTOFF);

  assertEquals(result.concluded, 0, "no workflow candidates -- nothing to conclude");
  assertEquals(result.avulso_deleted, 1);
  assertEquals(tables.workflow_posts.length, 1, "only the published avulso post remains");
  assertEquals(tables.workflow_posts[0].id, 40);
  assertEquals(tables.files.length, 0, "orphan file from the deleted draft is swept");
});

Deno.test("run: pass 3 still executes even when there are no legacy orphan workflows to GC", async () => {
  // Regression guard for the removed early-return: the old code returned as
  // soon as pass 2 found zero title-prefixed workflows, which would have
  // skipped pass 3 entirely in what becomes the common post-avulso case.
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 50, workflow_id: null, cliente_id: 9, is_express: true, status: "rascunho", created_at: OLD },
    ],
  });
  const result = await runExpressPostCleanupCron(db, CUTOFF);
  assertEquals(result.deleted, 0);
  assertEquals(result.avulso_deleted, 1);
  assertEquals(tables.workflow_posts.length, 0);
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

Deno.test("run: throws when the pass 1 candidate select fails", async () => {
  const { db } = makeFakeDb(
    { workflow_posts: [] },
    (table, op, filters) =>
      table === "workflow_posts" && op === "select" && filters.some((f) => f.op === "not")
        ? { message: "boom" }
        : null,
  );
  let threw = false;
  try {
    await runExpressPostCleanupCron(db, CUTOFF);
  } catch (e) {
    threw = true;
    // The handler re-throws the PostgREST error object as-is (never wraps
    // it), so the caught value is the `{ message }` shape, not a string.
    assertEquals((e as DbError).message, "boom");
  }
  assert(threw, "expected runExpressPostCleanupCron to throw");
});

Deno.test("run: throws when the pass 3 draft select fails", async () => {
  const { db } = makeFakeDb(
    { workflow_posts: [] },
    // Only the pass 3 scan carries an `is()` filter (`workflow_id IS NULL`);
    // pass 1's candidate query does not, so this targets pass 3 specifically.
    (table, op, filters) =>
      table === "workflow_posts" && op === "select" && filters.some((f) => f.op === "is")
        ? { message: "kaput" }
        : null,
  );
  let threw = false;
  try {
    await runExpressPostCleanupCron(db, CUTOFF);
  } catch (e) {
    threw = true;
    assertEquals((e as DbError).message, "kaput");
  }
  assert(threw, "expected runExpressPostCleanupCron to throw");
});
