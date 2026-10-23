// Shared loader for "feedback em mídia" notes as the CLIENT sees them (Hub).
//
// Reads go through the service role, so this module is the only thing standing
// between internal notes and the client: it filters visibility in the query AND
// again in buildHubMediaNotes. It never selects `hub_token`.

export interface HubMediaNoteReplyDTO {
  id: number;
  author: "client" | "team";
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface HubMediaNoteDTO {
  id: number;
  post_id: number;
  media_kind: "image" | "video";
  /** current_link_id; null = nota de uma versão anterior da mídia. */
  link_id: number | null;
  /** current_slide_index when current, else slide_index_at_creation. */
  slide_index: number;
  is_previous_version: boolean;
  t_seconds: number | null;
  x: number | null;
  y: number | null;
  author: "client" | "team";
  author_name: string | null;
  body: string;
  status: "open" | "resolved";
  resolved_at: string | null;
  created_at: string;
  replies: HubMediaNoteReplyDTO[];
}

/** Row of `post_media_notes_v` (hub_token is never selected, so it is absent). */
export interface NoteViewRow {
  id: number;
  post_id: number;
  media_kind: "image" | "video";
  slide_index_at_creation: number;
  t_seconds: number | null;
  x: number | null;
  y: number | null;
  visibility: "client" | "internal";
  author_kind: "client" | "team";
  author_user_id: string | null;
  body: string;
  status: "open" | "resolved";
  resolved_at: string | null;
  created_at: string;
  current_link_id: number | null;
  current_slide_index: number | null;
  is_previous_version: boolean;
}

/** Row of `post_media_note_replies` (hub_token is never selected). */
export interface ReplyRow {
  id: number;
  note_id: number;
  author_kind: "client" | "team";
  author_user_id: string | null;
  body: string;
  created_at: string;
}

const NOTE_COLUMNS = [
  "id",
  "post_id",
  "media_kind",
  "slide_index_at_creation",
  "t_seconds",
  "x",
  "y",
  "visibility",
  "author_kind",
  "author_user_id",
  "body",
  "status",
  "resolved_at",
  "created_at",
  "current_link_id",
  "current_slide_index",
  "is_previous_version",
].join(", ");

const REPLY_COLUMNS = "id, note_id, author_kind, author_user_id, body, created_at";

/** Only team members have a displayable name; a client author is never named. */
function nameFor(
  kind: "client" | "team",
  userId: string | null,
  namesByUserId: Map<string, string>,
): string | null {
  if (kind !== "team" || !userId) return null;
  return namesByUserId.get(userId) ?? null;
}

export function buildHubMediaNotes(
  notes: NoteViewRow[],
  replies: ReplyRow[],
  namesByUserId: Map<string, string>,
): HubMediaNoteDTO[] {
  const repliesByNote = new Map<number, HubMediaNoteReplyDTO[]>();
  for (const r of replies) {
    const list = repliesByNote.get(r.note_id) ?? [];
    list.push({
      id: r.id,
      author: r.author_kind,
      author_name: nameFor(r.author_kind, r.author_user_id, namesByUserId),
      body: r.body,
      created_at: r.created_at,
    });
    repliesByNote.set(r.note_id, list);
  }

  return notes
    // Defense in depth: the query already filters, but a client must never see
    // an internal note even if a caller forgets the filter.
    .filter((n) => n.visibility === "client")
    .map((n) => {
      const current = !n.is_previous_version && n.current_link_id != null;
      return {
        id: n.id,
        post_id: n.post_id,
        media_kind: n.media_kind,
        link_id: n.current_link_id ?? null,
        slide_index: current && n.current_slide_index != null
          ? n.current_slide_index
          : n.slide_index_at_creation,
        is_previous_version: n.is_previous_version,
        t_seconds: n.t_seconds,
        x: n.x,
        y: n.y,
        author: n.author_kind,
        author_name: nameFor(n.author_kind, n.author_user_id, namesByUserId),
        body: n.body,
        status: n.status,
        resolved_at: n.resolved_at,
        created_at: n.created_at,
        replies: repliesByNote.get(n.id) ?? [],
      };
    });
}

// deno-lint-ignore no-explicit-any
type FromClient = { from: (table: string) => any };

function fail(scope: string, error: unknown): never {
  // Detail stays in the log; callers get a generic message.
  console.error(`[media-notes] ${scope} failed`, error);
  throw new Error("media_notes_load_failed");
}

/**
 * Notes visible to the client for the given posts, with replies and team names.
 * `db` is typed with `from` only because hub-post-history's DbClient has no `rpc`.
 */
export async function loadClientMediaNotes(
  db: FromClient,
  contaId: string,
  postIds: number[],
): Promise<HubMediaNoteDTO[]> {
  if (postIds.length === 0) return [];

  const notesRes = await db
    .from("post_media_notes_v")
    .select(NOTE_COLUMNS)
    .eq("conta_id", contaId)
    .in("post_id", postIds)
    .eq("visibility", "client")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (notesRes.error) fail("notes", notesRes.error);
  const notes = (notesRes.data ?? []) as NoteViewRow[];
  if (notes.length === 0) return [];

  const noteIds = notes.map((n) => n.id);
  const [repliesRes, membersRes] = await Promise.all([
    db
      .from("post_media_note_replies")
      .select(REPLY_COLUMNS)
      .in("note_id", noteIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    db.from("membros").select("crm_user_id, nome").eq("conta_id", contaId),
  ]);
  if (repliesRes.error) fail("replies", repliesRes.error);
  if (membersRes.error) fail("members", membersRes.error);

  const names = new Map<string, string>();
  for (const m of (membersRes.data ?? []) as Array<{ crm_user_id: string | null; nome: string | null }>) {
    if (m.crm_user_id && m.nome) names.set(m.crm_user_id, m.nome);
  }

  return buildHubMediaNotes(notes, (repliesRes.data ?? []) as ReplyRow[], names);
}
