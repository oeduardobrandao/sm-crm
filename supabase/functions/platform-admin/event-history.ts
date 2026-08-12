import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ListWorkspaceEventsBody {
  workspace_id?: string;
  offset?: number;
  limit?: number;
  event_types?: string[];
}

export async function handleListWorkspaceEvents(
  svc: SupabaseClient,
  body: ListWorkspaceEventsBody,
  headers: Record<string, string>,
): Promise<Response> {
  const { workspace_id, offset = 0, limit = 20, event_types } = body;

  if (!workspace_id) {
    return new Response(
      JSON.stringify({ error: "workspace_id is required" }),
      { status: 400, headers },
    );
  }

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  let query = svc
    .from("audit_log")
    .select("id, created_at, action, resource_type, resource_id, actor_user_id, metadata", {
      count: "exact",
    })
    .eq("conta_id", workspace_id)
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (event_types && event_types.length > 0) {
    query = query.in("action", event_types);
  }

  const { data: rows, count, error } = await query;
  if (error) throw error;

  const events = rows ?? [];
  const total = count ?? 0;

  const actorIds = [...new Set(
    events
      .map((e) => e.actor_user_id as string | null)
      .filter(Boolean) as string[],
  )];

  const nameById = new Map<string, string>();
  const emailById = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, nome")
      .in("id", actorIds);
    for (const p of profiles ?? []) {
      nameById.set(p.id, p.nome);
    }

    const authResults = await Promise.all(
      actorIds.map((uid) => svc.auth.admin.getUserById(uid)),
    );
    for (const r of authResults) {
      if (r.data?.user?.email) {
        emailById.set(r.data.user.id, r.data.user.email);
      }
    }
  }

  const enriched = events.map((e) => ({
    id: e.id,
    created_at: e.created_at,
    action: e.action,
    resource_type: e.resource_type,
    resource_id: e.resource_id,
    actor_name: (e.actor_user_id ? nameById.get(e.actor_user_id as string) : null) ?? null,
    actor_email: (e.actor_user_id ? emailById.get(e.actor_user_id as string) : null) ?? null,
    metadata: e.metadata,
  }));

  return new Response(
    JSON.stringify({ events: enriched, total }),
    { status: 200, headers },
  );
}
