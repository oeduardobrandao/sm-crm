import { assert, assertEquals } from "./assert.ts";
import {
  handleAddWorkspaceNote,
  handleDeleteWorkspaceNote,
  handleListWorkspaceNotes,
  NOTE_MAX_LENGTH,
} from "../platform-admin/workspace-notes.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (same pattern as platform-admin-workspace-overrides_test.ts).
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "order", "limit", "insert", "delete"]) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return rec;
      };
    }
    rec.single = () => {
      calls.push({ table, method: "single", args: [] });
      return Promise.resolve(next());
    };
    rec.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(next());
    };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = {
    from: (t: string) => {
      calls.push({ table: t, method: "from", args: [t] });
      return recorder(t);
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const HEADERS = { "Content-Type": "application/json" };
const ADMIN = { id: "admin-1", email: "a@mesaas.com.br" };

Deno.test("list-workspace-notes returns every author's notes, newest first, flagging only mine", async () => {
  const { db, calls } = makeFakeDb({
    admin_workspace_notes: [{
      data: [
        { id: "n2", body: "da outra", created_at: "2026-11-23T10:00:00Z", author_id: "admin-2", author_email: "b@x" },
        { id: "n1", body: "minha", created_at: "2026-11-22T10:00:00Z", author_id: "admin-1", author_email: "a@x" },
        { id: "n0", body: "antiga", created_at: "2026-01-01T00:00:00Z", author_id: null, author_email: null },
      ],
      error: null,
    }],
  });

  const res = await handleListWorkspaceNotes(db, { workspace_id: "ws-1" }, ADMIN.id, HEADERS);
  assertEquals(res.status, 200);
  const { notes } = await res.json();
  assertEquals(notes.map((n: { id: string }) => n.id), ["n2", "n1", "n0"]);
  assertEquals(notes.map((n: { is_mine: boolean }) => n.is_mine), [false, true, false]);
  assertEquals(notes[0].author_email, "b@x");
  // No author filter: every admin sees every note of the workspace.
  const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args[0]);
  assertEquals(eqs, ["workspace_id"]);
  const order = calls.find((c) => c.method === "order");
  assertEquals(order?.args, ["created_at", { ascending: false }]);
  // author_id never leaves the server.
  assertEquals("author_id" in notes[0], false);
});

Deno.test("list-workspace-notes requires workspace_id", async () => {
  const { db } = makeFakeDb({});
  const res = await handleListWorkspaceNotes(db, {}, ADMIN.id, HEADERS);
  assertEquals(res.status, 400);
});

Deno.test("add-workspace-note trims, stamps the author and does not need a plan", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { id: "ws-1" }, error: null }],
    admin_workspace_notes: [{
      data: { id: "n9", body: "ligou pedindo desconto", created_at: "2026-11-23T12:00:00Z", author_id: "admin-1", author_email: ADMIN.email },
      error: null,
    }],
  });

  const res = await handleAddWorkspaceNote(db, { workspace_id: "ws-1", body: "  ligou pedindo desconto \n" }, ADMIN, HEADERS);
  assertEquals(res.status, 200);
  const insert = calls.find((c) => c.table === "admin_workspace_notes" && c.method === "insert");
  assert(insert, "expected an insert");
  assertEquals(insert.args[0], {
    workspace_id: "ws-1",
    author_id: "admin-1",
    author_email: ADMIN.email,
    body: "ligou pedindo desconto",
  });
  const { note } = await res.json();
  assertEquals(note.is_mine, true);
  assertEquals(calls.some((c) => c.table === "workspace_plan_overrides"), false);
});

Deno.test("add-workspace-note rejects an empty or oversized body without writing", async () => {
  for (const body of ["   ", "", undefined, 42, "x".repeat(NOTE_MAX_LENGTH + 1)]) {
    const { db, calls } = makeFakeDb({ workspaces: [{ data: { id: "ws-1" }, error: null }] });
    const res = await handleAddWorkspaceNote(db, { workspace_id: "ws-1", body }, ADMIN, HEADERS);
    assertEquals(res.status, 400, `body=${String(body).slice(0, 10)}`);
    assertEquals(calls.some((c) => c.method === "insert"), false);
  }
});

Deno.test("add-workspace-note answers 404 for an unknown workspace", async () => {
  const { db, calls } = makeFakeDb({ workspaces: [{ data: null, error: null }] });
  const res = await handleAddWorkspaceNote(db, { workspace_id: "nope", body: "oi" }, ADMIN, HEADERS);
  assertEquals(res.status, 404);
  assertEquals(calls.some((c) => c.method === "insert"), false);
});

Deno.test("delete-workspace-note deletes my own note, scoped by author", async () => {
  const { db, calls } = makeFakeDb({
    admin_workspace_notes: [
      { data: { id: "n1", author_id: "admin-1" }, error: null },
      { data: null, error: null },
    ],
  });
  const res = await handleDeleteWorkspaceNote(db, { note_id: "n1" }, ADMIN.id, HEADERS);
  assertEquals(res.status, 200);
  const delIdx = calls.findIndex((c) => c.method === "delete");
  assert(delIdx >= 0, "expected a delete");
  const filters = calls.slice(delIdx + 1).filter((c) => c.method === "eq").map((c) => c.args);
  assertEquals(filters, [["id", "n1"], ["author_id", "admin-1"]]);
});

Deno.test("delete-workspace-note refuses another admin's note and the unattributed legacy note", async () => {
  for (const author_id of ["admin-2", null]) {
    const { db, calls } = makeFakeDb({
      admin_workspace_notes: [{ data: { id: "n2", author_id }, error: null }],
    });
    const res = await handleDeleteWorkspaceNote(db, { note_id: "n2" }, ADMIN.id, HEADERS);
    assertEquals(res.status, 403);
    assertEquals(calls.some((c) => c.method === "delete"), false);
  }
});

Deno.test("delete-workspace-note answers 404 for a missing note", async () => {
  const { db } = makeFakeDb({ admin_workspace_notes: [{ data: null, error: null }] });
  const res = await handleDeleteWorkspaceNote(db, { note_id: "gone" }, ADMIN.id, HEADERS);
  assertEquals(res.status, 404);
});
