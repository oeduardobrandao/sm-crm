// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { buildHubMediaNotes, loadClientMediaNotes } from "../_shared/media-notes.ts";
import { unknownMediaNoteColumns } from "./media-notes-columns.ts";

function noteRow(over: Record<string, unknown> = {}): any {
  return {
    id: 1,
    conta_id: "c1",
    post_id: 10,
    file_id: 5,
    slide_index_at_creation: 0,
    media_kind: "image",
    t_seconds: null,
    x: 0.25,
    y: 0.5,
    visibility: "client",
    author_kind: "client",
    author_user_id: null,
    body: "Trocar a cor",
    status: "open",
    resolved_by: null,
    resolved_at: null,
    created_at: "2026-10-23T10:00:00Z",
    updated_at: "2026-10-23T10:00:00Z",
    current_link_id: 41,
    current_slide_index: 2,
    is_previous_version: false,
    ...over,
  };
}

function replyRow(over: Record<string, unknown> = {}): any {
  return {
    id: 100,
    note_id: 1,
    conta_id: "c1",
    author_kind: "team",
    author_user_id: "u1",
    body: "Feito",
    created_at: "2026-10-23T11:00:00Z",
    ...over,
  };
}

Deno.test("buildHubMediaNotes maps a current note", () => {
  const [dto] = buildHubMediaNotes([noteRow()], [], new Map());
  assertEquals(dto.link_id, 41);
  assertEquals(dto.slide_index, 2);
  assertEquals(dto.is_previous_version, false);
  assertEquals(dto.author, "client");
  assertEquals(dto.x, 0.25);
  assertEquals(dto.replies, []);
});

Deno.test("buildHubMediaNotes keeps snapshot index for versão anterior", () => {
  const [dto] = buildHubMediaNotes(
    [noteRow({ current_link_id: null, current_slide_index: null, slide_index_at_creation: 1, is_previous_version: true })],
    [],
    new Map(),
  );
  assertEquals(dto.link_id, null);
  assertEquals(dto.slide_index, 1);
  assertEquals(dto.is_previous_version, true);
});

Deno.test("buildHubMediaNotes drops non-client visibility rows", () => {
  const out = buildHubMediaNotes(
    [noteRow({ id: 1 }), noteRow({ id: 2, visibility: "internal" })],
    [replyRow({ note_id: 2 })],
    new Map(),
  );
  assertEquals(out.map((n) => n.id), [1]);
});

Deno.test("team reply gets member name, falls back to null", () => {
  const names = new Map([["u1", "Bianca"]]);
  const [hit] = buildHubMediaNotes([noteRow()], [replyRow()], names);
  assertEquals(hit.replies[0].author_name, "Bianca");
  assertEquals(hit.replies[0].author, "team");

  const [miss] = buildHubMediaNotes([noteRow()], [replyRow({ author_user_id: "u9" })], names);
  assertEquals(miss.replies[0].author_name, null);
});

Deno.test("buildHubMediaNotes names a team note author and never names a client", () => {
  const names = new Map([["u1", "Bianca"]]);
  const out = buildHubMediaNotes(
    [
      noteRow({ id: 1, author_kind: "team", author_user_id: "u1" }),
      noteRow({ id: 2, author_kind: "client", author_user_id: "u1" }),
    ],
    [],
    names,
  );
  assertEquals(out[0].author_name, "Bianca");
  assertEquals(out[1].author_name, null);
});

Deno.test("buildHubMediaNotes attaches replies to their note in order and never leaks hub_token", () => {
  const out = buildHubMediaNotes(
    [noteRow({ id: 1, hub_token: "secret" }), noteRow({ id: 2 })],
    [
      replyRow({ id: 100, note_id: 1, hub_token: "secret" }),
      replyRow({ id: 101, note_id: 2 }),
      replyRow({ id: 102, note_id: 1 }),
    ],
    new Map(),
  );
  assertEquals(out[0].replies.map((r) => r.id), [100, 102]);
  assertEquals(out[1].replies.map((r) => r.id), [101]);
  assert(!JSON.stringify(out).includes("secret"));
  assert(!("hub_token" in out[0]));
});

Deno.test("loadClientMediaNotes filters visibility client", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_media_notes_v", "select", { data: [noteRow()], error: null });
  db.queue("post_media_note_replies", "select", { data: [replyRow()], error: null });
  db.queue("membros", "select", { data: [{ crm_user_id: "u1", nome: "Bianca" }], error: null });

  const out = await loadClientMediaNotes(db, "c1", [10, 11]);

  const call = db.calls.find((c) => c.table === "post_media_notes_v")!;
  assert(call, "expected a post_media_notes_v query");
  const mods = call.modifiers.map((m) => JSON.stringify([m.method, ...m.args]));
  assert(mods.includes(JSON.stringify(["eq", "visibility", "client"])), "missing visibility=client");
  assert(mods.includes(JSON.stringify(["eq", "conta_id", "c1"])), "missing conta_id");
  assert(mods.includes(JSON.stringify(["in", "post_id", [10, 11]])), "missing post_id in");
  for (const call2 of db.calls) {
    for (const args of call2.selectArgs) {
      assert(!String(args[0] ?? "").includes("hub_token"), "must never select hub_token");
    }
  }
  assertEquals(out.length, 1);
  assertEquals(out[0].replies[0].author_name, "Bianca");

  const repliesCall = db.calls.find((c) => c.table === "post_media_note_replies")!;
  assert(
    repliesCall.modifiers.some((m) => m.method === "in" && m.args[0] === "note_id"),
    "replies must filter by note_id",
  );
  const membrosCall = db.calls.find((c) => c.table === "membros")!;
  assert(
    membrosCall.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "c1"),
    "membros must be scoped to the workspace",
  );
  // Every selected/filtered column exists in migration 20261026000001.
  assertEquals(unknownMediaNoteColumns(db.calls), []);
});

Deno.test("loadClientMediaNotes skips queries for no posts", async () => {
  const db = createSupabaseQueryMock();
  const out = await loadClientMediaNotes(db, "c1", []);
  assertEquals(out, []);
  assertEquals(db.calls.length, 0);
});

Deno.test("loadClientMediaNotes skips the follow-up queries when there are no notes", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_media_notes_v", "select", { data: [], error: null });
  const out = await loadClientMediaNotes(db, "c1", [10]);
  assertEquals(out, []);
  assertEquals(db.calls.length, 1);
});

Deno.test("loadClientMediaNotes throws a generic error when the query fails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_media_notes_v", "select", { data: null, error: { message: "boom internal detail" } });
  const original = console.error;
  console.error = () => {};
  try {
    let message = "";
    try {
      await loadClientMediaNotes(db, "c1", [10]);
    } catch (e) {
      message = (e as Error).message;
    }
    assert(message.length > 0, "expected a throw");
    assert(!message.includes("boom"), "must not leak the db detail");
  } finally {
    console.error = original;
  }
});

Deno.test("loadClientMediaNotes drains notes past a single page", async () => {
  const db = createSupabaseQueryMock();
  db.queue(
    "post_media_notes_v",
    "select",
    { data: [noteRow({ id: 1 })], error: null },
    { data: [noteRow({ id: 2 })], error: null },
  );
  db.queue("post_media_note_replies", "select", { data: [], error: null });
  db.queue("membros", "select", { data: [], error: null });
  const out = await loadClientMediaNotes(db, "c1", [10]);
  assertEquals(out.map((n) => n.id), [1, 2]);
  const ranges = db.calls
    .filter((c) => c.table === "post_media_notes_v")
    .map((c) => c.modifiers.find((m) => m.method === "range")?.args);
  assertEquals(ranges, [[0, 999], [1, 1000], [2, 1001]]);
});

for (const failing of ["post_media_note_replies", "membros"]) {
  Deno.test(`loadClientMediaNotes throws a generic error when ${failing} fails`, async () => {
    const db = createSupabaseQueryMock();
    db.queue("post_media_notes_v", "select", { data: [noteRow()], error: null });
    db.queue("post_media_note_replies", "select", failing === "post_media_note_replies"
      ? { data: null, error: { message: "boom internal detail" } }
      : { data: [], error: null });
    db.queue("membros", "select", failing === "membros"
      ? { data: null, error: { message: "boom internal detail" } }
      : { data: [], error: null });
    const original = console.error;
    console.error = () => {};
    try {
      let message = "";
      try {
        await loadClientMediaNotes(db, "c1", [10]);
      } catch (e) {
        message = (e as Error).message;
      }
      assert(message.length > 0, "expected a throw");
      assert(!message.includes("boom"), "must not leak the db detail");
    } finally {
      console.error = original;
    }
  });
}
