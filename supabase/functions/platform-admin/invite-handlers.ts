import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthStatesByEmails } from "../_shared/invite-actions.ts";
import { computeInviteFlags } from "./invites-enrich.ts";

export async function handleGetWorkspaceInvites(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { count } = await svc.from("invites")
    .select("*", { count: "exact", head: true }).eq("conta_id", body.workspace_id);
  const { data: rows, error } = await svc.from("invites")
    .select("id, email, role, status, created_at, accepted_at, expires_at, invited_by")
    .eq("conta_id", body.workspace_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const invites = rows ?? [];
  const states = await getAuthStatesByEmails(svc, invites.map((r) => r.email));

  // Which of these users are members of THIS workspace?
  const userIds = [...states.values()].map((s) => s.user_id);
  const memberIds = new Set<string>();
  if (userIds.length) {
    const { data: members } = await svc.from("workspace_members")
      .select("user_id").eq("workspace_id", body.workspace_id).in("user_id", userIds);
    for (const m of members ?? []) memberIds.add(m.user_id);
  }

  const enriched = invites.map((r) => {
    const auth = states.get(r.email.toLowerCase()) ?? null;
    const flags = computeInviteFlags(r); // link_expired from the invite's own created_at
    return {
      ...r,
      silent_add: flags.silent_add,
      link_expired: flags.link_expired,
      auth_state: auth ? { ...auth, is_member: memberIds.has(auth.user_id) } : null,
    };
  });

  return new Response(JSON.stringify({ invites: enriched, total: count ?? enriched.length }), { status: 200, headers });
}
