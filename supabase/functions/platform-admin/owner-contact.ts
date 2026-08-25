import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withTimeout } from "./pricing.ts";

const OWNER_LOOKUP_CONCURRENCY = 8;
const OWNER_LOOKUP_TIMEOUT_MS = 5000;

export interface OwnerContact {
  name: string;
  email: string | null;
  telefone: string | null;
  marketing_opt_in: boolean;
}

/**
 * Resolves the "owner" of each given workspace for admin display/export purposes.
 * workspace_members only constrains UNIQUE(user_id, workspace_id) -- more than one
 * role='owner' row per workspace is possible -- so ties are broken by preferring the
 * owner-role member who is also the workspace's creator (workspaces.created_by),
 * falling back to earliest joined_at then user_id when the creator isn't among the
 * owner-role rows (or created_by is null). This must match the tie-break
 * admin_list_workspaces uses (migration 20260825000010) so both paths agree on "the
 * owner" for the same workspace.
 *
 * A workspace with no owner-role row has no entry in the returned map -- callers must
 * treat a missing entry as "no owner", not an error.
 */
export async function fetchOwnerContacts(
  svc: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, OwnerContact>> {
  const result = new Map<string, OwnerContact>();
  if (workspaceIds.length === 0) return result;

  const { data: members, error: membersError } = await svc
    .from("workspace_members")
    .select("workspace_id, user_id, joined_at")
    .in("workspace_id", workspaceIds)
    .eq("role", "owner")
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true });
  if (membersError) throw membersError;

  const { data: workspaces, error: workspacesError } = await svc
    .from("workspaces")
    .select("id, created_by")
    .in("id", workspaceIds);
  if (workspacesError) throw workspacesError;

  const createdByByWorkspace = new Map(
    ((workspaces ?? []) as Array<{ id: string; created_by: string | null }>).map((w) => [
      w.id,
      w.created_by,
    ]),
  );

  // Group the already joined_at/user_id-sorted owner-role user_ids by workspace,
  // preserving sort order within each group.
  const ownerUserIdsByWorkspace = new Map<string, string[]>();
  for (const m of (members ?? []) as Array<{ workspace_id: string; user_id: string }>) {
    const list = ownerUserIdsByWorkspace.get(m.workspace_id);
    if (list) {
      list.push(m.user_id);
    } else {
      ownerUserIdsByWorkspace.set(m.workspace_id, [m.user_id]);
    }
  }

  const ownerByWorkspace = new Map<string, string>();
  for (const [workspaceId, userIds] of ownerUserIdsByWorkspace) {
    const createdBy = createdByByWorkspace.get(workspaceId) ?? null;
    const creatorIsOwner = createdBy !== null && userIds.includes(createdBy);
    ownerByWorkspace.set(workspaceId, creatorIsOwner ? createdBy : userIds[0]);
  }

  const ownerUserIds = [...new Set(ownerByWorkspace.values())];
  if (ownerUserIds.length === 0) return result;

  const { data: profiles, error: profilesError } = await svc
    .from("profiles")
    .select("id, nome, telefone, marketing_opt_in")
    .in("id", ownerUserIds);
  if (profilesError) throw profilesError;

  const profileById = new Map(
    ((profiles ?? []) as Array<{
      id: string;
      nome: string | null;
      telefone: string | null;
      marketing_opt_in: boolean | null;
    }>).map((p) => [p.id, p]),
  );

  const emailById = new Map<string, string | null>();
  for (let i = 0; i < ownerUserIds.length; i += OWNER_LOOKUP_CONCURRENCY) {
    const batch = ownerUserIds.slice(i, i + OWNER_LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (userId) => {
        try {
          const { data } = await withTimeout(
            svc.auth.admin.getUserById(userId),
            OWNER_LOOKUP_TIMEOUT_MS,
            "owner email lookup",
          );
          emailById.set(userId, data?.user?.email ?? null);
        } catch (err) {
          console.error(
            `[platform-admin] owner email lookup failed for ${userId}:`,
            (err as Error).message,
          );
          emailById.set(userId, null);
        }
      }),
    );
  }

  for (const [workspaceId, userId] of ownerByWorkspace) {
    const profile = profileById.get(userId);
    result.set(workspaceId, {
      name: profile?.nome ?? "Unknown",
      email: emailById.get(userId) ?? null,
      telefone: profile?.telefone ?? null,
      marketing_opt_in: profile?.marketing_opt_in ?? false,
    });
  }

  return result;
}
