// Real columns of the Feedback em mídia tables and view, copied from
// supabase/migrations/20261025000001_post_media_notes.sql. The query mock accepts any
// column name, so a handler that selects or filters a column that does not exist
// (C1: `approval_id` instead of `post_approval_id`) passes every mock test and only
// fails as a 400 in PostgREST. media-notes-columns_test.ts checks these lists against
// the migration file itself, so they cannot drift from it either.
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";

export const MEDIA_NOTE_TABLE_COLUMNS: Record<string, readonly string[]> = {
  post_media_notes: [
    "id",
    "conta_id",
    "post_id",
    "file_id",
    "slide_index_at_creation",
    "media_kind",
    "t_seconds",
    "x",
    "y",
    "visibility",
    "author_kind",
    "author_user_id",
    "hub_token",
    "body",
    "status",
    "resolved_by",
    "resolved_at",
    "created_at",
    "updated_at",
  ],
  post_media_note_replies: [
    "id",
    "note_id",
    "conta_id",
    "author_kind",
    "author_user_id",
    "hub_token",
    "body",
    "created_at",
  ],
  post_approval_media_notes: ["post_approval_id", "note_id"],
  // The view: every note column except hub_token, plus the three computed ones.
  post_media_notes_v: [
    "id",
    "conta_id",
    "post_id",
    "file_id",
    "slide_index_at_creation",
    "media_kind",
    "t_seconds",
    "x",
    "y",
    "visibility",
    "author_kind",
    "author_user_id",
    "body",
    "status",
    "resolved_by",
    "resolved_at",
    "created_at",
    "updated_at",
    "current_link_id",
    "current_slide_index",
    "is_previous_version",
  ],
};

const COLUMN_FILTERS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "not",
  "ilike",
  "contains",
  "order",
]);

/** Top-level comma split of a PostgREST select string (embeds keep their parentheses). */
function splitSelect(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Every column a select string names on `table`, embeds of the media-note tables included. */
export function selectedColumns(table: string, select: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const item of splitSelect(select)) {
    const embed = item.match(/^(?:\w+:)?(\w+)(?:!\w+)?\((.*)\)$/s);
    if (embed) {
      if (embed[1] in MEDIA_NOTE_TABLE_COLUMNS) found.push(...selectedColumns(embed[1], embed[2]));
      continue;
    }
    const name = item.includes(":") ? item.split(":").pop()!.trim() : item;
    found.push([table, name]);
  }
  return found;
}

/** Unknown [table, column] pairs read by the recorded calls on the media-note tables. */
export function unknownMediaNoteColumns(calls: QueryCall[]): string[] {
  const bad: string[] = [];
  const check = (table: string, column: string) => {
    const known = MEDIA_NOTE_TABLE_COLUMNS[table];
    if (known && column !== "*" && !known.includes(column)) bad.push(`${table}.${column}`);
  };
  for (const call of calls) {
    for (const args of call.selectArgs) {
      if (typeof args[0] === "string") {
        for (const [t, c] of selectedColumns(call.table, args[0])) check(t, c);
      }
    }
    if (!(call.table in MEDIA_NOTE_TABLE_COLUMNS)) continue;
    for (const m of call.modifiers) {
      const col = m.args[0];
      // `workflow_posts.cliente_id` filters an embed, not this table.
      if (COLUMN_FILTERS.has(m.method) && typeof col === "string" && !col.includes(".")) {
        check(call.table, col);
      }
    }
  }
  return bad;
}
