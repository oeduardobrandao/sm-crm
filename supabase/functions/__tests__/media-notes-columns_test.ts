import { assertEquals } from "./assert.ts";
import { MEDIA_NOTE_TABLE_COLUMNS, selectedColumns, unknownMediaNoteColumns } from "./media-notes-columns.ts";

const MIGRATION = new URL(
  "../../migrations/20261025000001_post_media_notes.sql",
  import.meta.url,
).pathname;

function tableColumns(sql: string, table: string): string[] {
  const body = sql.match(new RegExp(`CREATE TABLE ${table} \\(\\n([\\s\\S]*?)\\n\\);`))?.[1];
  if (!body) throw new Error(`CREATE TABLE ${table} not found`);
  // Column definitions sit at exactly two spaces; constraint continuations are deeper.
  return body
    .split("\n")
    .filter((l) => /^ {2}[a-z_]+\s/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);
}

function viewColumns(sql: string): string[] {
  const select = sql.match(/CREATE VIEW post_media_notes_v[\s\S]*?SELECT\n([\s\S]*?)\nFROM post_media_notes n/)?.[1];
  if (!select) throw new Error("CREATE VIEW post_media_notes_v not found");
  return select
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const alias = item.match(/\bAS\s+(\w+)$/i);
      return alias ? alias[1] : item.replace(/^n\./, "");
    });
}

Deno.test("media-note column lists match migration 20261025000001", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  for (const table of ["post_media_notes", "post_media_note_replies", "post_approval_media_notes"]) {
    assertEquals([...MEDIA_NOTE_TABLE_COLUMNS[table]], tableColumns(sql, table), table);
  }
  assertEquals([...MEDIA_NOTE_TABLE_COLUMNS.post_media_notes_v], viewColumns(sql), "post_media_notes_v");
});

Deno.test("selectedColumns reads aliases and media-note embeds, skips other embeds", () => {
  assertEquals(selectedColumns("post_approvals", "*, post_approval_media_notes(note_id)"), [
    ["post_approvals", "*"],
    ["post_approval_media_notes", "note_id"],
  ]);
  assertEquals(
    selectedColumns("post_media_notes", "post_id, created_at, workflow_posts!inner(titulo, conta_id)"),
    [["post_media_notes", "post_id"], ["post_media_notes", "created_at"]],
  );
});

Deno.test("unknownMediaNoteColumns flags a wrong column in select, filter and order", () => {
  const bad = unknownMediaNoteColumns([
    {
      table: "post_approval_media_notes",
      operation: "select",
      selectArgs: [["approval_id, note_id"]],
      modifiers: [
        { method: "in", args: ["approval_id", [1]] },
        { method: "order", args: ["note_id", { ascending: true }] },
        { method: "eq", args: ["workflow_posts.conta_id", "x"] },
      ],
    },
  ]);
  assertEquals(bad, ["post_approval_media_notes.approval_id", "post_approval_media_notes.approval_id"]);
});
