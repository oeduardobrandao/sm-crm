import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Notas do admin por workspace (migration 20261128000001): uma linha por nota, todo admin vê
// todas. Só o autor apaga a própria nota; não há edição.

export const NOTE_MAX_LENGTH = 5000;
const LIST_LIMIT = 200;

export interface WorkspaceNote {
  id: string;
  body: string;
  created_at: string;
  author_email: string | null;
  is_mine: boolean;
}

interface NoteRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_email: string | null;
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

function toNote(row: NoteRow, adminId: string): WorkspaceNote {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    author_email: row.author_email,
    is_mine: row.author_id !== null && row.author_id === adminId,
  };
}

export async function handleListWorkspaceNotes(
  svc: SupabaseClient,
  body: { workspace_id?: unknown },
  adminId: string,
  headers: Record<string, string>,
) {
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!workspaceId) return json({ error: "workspace_id is required" }, 400, headers);

  const { data, error } = await svc
    .from("admin_workspace_notes")
    .select("id, body, created_at, author_id, author_email")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;

  const notes = ((data ?? []) as NoteRow[]).map((r) => toNote(r, adminId));
  return json({ notes }, 200, headers);
}

export async function handleAddWorkspaceNote(
  svc: SupabaseClient,
  body: { workspace_id?: unknown; body?: unknown },
  admin: { id: string; email: string },
  headers: Record<string, string>,
) {
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!workspaceId) return json({ error: "workspace_id is required" }, 400, headers);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return json({ error: "A nota está vazia." }, 400, headers);
  if (text.length > NOTE_MAX_LENGTH) {
    return json({ error: `A nota passa de ${NOTE_MAX_LENGTH} caracteres.` }, 400, headers);
  }

  const { data: ws, error: wsError } = await svc
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError) throw wsError;
  if (!ws) return json({ error: "Workspace não encontrado." }, 404, headers);

  const { data, error } = await svc
    .from("admin_workspace_notes")
    .insert({ workspace_id: workspaceId, author_id: admin.id, author_email: admin.email, body: text })
    .select("id, body, created_at, author_id, author_email")
    .single();
  if (error) throw error;

  return json({ note: toNote(data as NoteRow, admin.id) }, 200, headers);
}

export async function handleDeleteWorkspaceNote(
  svc: SupabaseClient,
  body: { note_id?: unknown },
  adminId: string,
  headers: Record<string, string>,
) {
  const noteId = typeof body.note_id === "string" ? body.note_id : "";
  if (!noteId) return json({ error: "note_id is required" }, 400, headers);

  const { data: note, error: readError } = await svc
    .from("admin_workspace_notes")
    .select("id, author_id")
    .eq("id", noteId)
    .maybeSingle();
  if (readError) throw readError;
  if (!note) return json({ error: "Nota não encontrada." }, 404, headers);
  if ((note as { author_id: string | null }).author_id !== adminId) {
    return json({ error: "Só o autor pode excluir a nota." }, 403, headers);
  }

  // author_id no filtro de novo: a checagem acima e o delete são duas idas ao banco.
  const { error } = await svc
    .from("admin_workspace_notes")
    .delete()
    .eq("id", noteId)
    .eq("author_id", adminId);
  if (error) throw error;

  return json({ message: "Nota excluída" }, 200, headers);
}
