// deno-lint-ignore-file no-explicit-any
import { classifyExistingUser, coerceHasPassword } from "./invite-classify.ts";

export interface AuthState {
  user_id: string;
  email_confirmed: boolean;
  confirmation_sent_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  has_password: boolean | null;
  onboarding_complete: boolean;
}

export async function findAuthUserByEmail(adminClient: any, email: string) {
  let page = 1;
  const target = email.toLowerCase();
  while (true) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users;
    if (!users || users.length === 0) return null;
    const found = users.find((u: any) => u.email?.toLowerCase() === target);
    if (found) return found;
    page++;
  }
}

/**
 * Resolve auth state for many emails in ONE paged listUsers scan (not one per
 * email). Returns a Map keyed by lower-cased email; emails with no auth user
 * are simply absent from the Map.
 */
export async function getAuthStatesByEmails(
  adminClient: any,
  emails: string[],
): Promise<Map<string, AuthState>> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const byEmail = new Map<string, any>();

  let page = 1;
  while (wanted.size > byEmail.size) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users;
    if (!users || users.length === 0) break;
    for (const u of users) {
      const key = u.email?.toLowerCase();
      if (key && wanted.has(key) && !byEmail.has(key)) byEmail.set(key, u);
    }
    page++;
  }

  const ids = [...byEmail.values()].map((u) => u.id);
  const onboardedById = new Map<string, boolean>();
  if (ids.length) {
    const { data: profiles } = await adminClient
      .from("profiles").select("id, onboarding_complete").in("id", ids);
    for (const p of profiles ?? []) onboardedById.set(p.id, p.onboarding_complete === true);
  }

  const out = new Map<string, AuthState>();
  for (const [key, u] of byEmail) {
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: u.id });
    out.set(key, {
      user_id: u.id,
      email_confirmed: !!u.email_confirmed_at,
      confirmation_sent_at: u.confirmation_sent_at ?? null,
      invited_at: u.invited_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      has_password: coerceHasPassword(pw, pwErr),
      onboarding_complete: onboardedById.get(u.id) ?? false,
    });
  }
  return out;
}

export interface CancelResult {
  status: "cancelled";
  email: string;
  deletedUser: boolean;
  affectedWorkspaceIds: string[];
}

/**
 * Admin-side invite cancel. Only pending/expired invites may be cancelled
 * (accepted is live membership + history — refuse). When the invitee never
 * finished onboarding the orphan auth user is deleted globally; we capture its
 * full workspace_members set BEFORE the delete so callers can audit every
 * workspace the user vanished from.
 */
export async function cancelInvite(
  adminClient: any,
  args: { inviteId: string; contaId: string },
): Promise<CancelResult> {
  const { data: invite } = await adminClient
    .from("invites")
    .select("id, conta_id, email, status")
    .eq("id", args.inviteId)
    .eq("conta_id", args.contaId)
    .maybeSingle();

  if (!invite) throw new Error("invite_not_found");
  if (invite.status === "accepted") throw new Error("invite_not_cancellable");

  const email: string = invite.email;

  // Decide whether the orphan auth user should be deleted, and if so capture
  // its workspace set first.
  let deletedUser = false;
  let affectedWorkspaceIds: string[] = [];
  const authUser = await findAuthUserByEmail(adminClient, email);
  if (authUser) {
    const { data: profile } = await adminClient
      .from("profiles").select("onboarding_complete").eq("id", authUser.id).maybeSingle();
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: authUser.id });
    const action = classifyExistingUser({
      emailConfirmed: !!authUser.email_confirmed_at,
      hasProfile: !!profile,
      onboardingComplete: profile?.onboarding_complete === true,
      hasPassword: coerceHasPassword(pw, pwErr),
    });
    if (action === "reinvite" || action === "resend-link") {
      const { data: memberships, error: membershipsErr } = await adminClient
        .from("workspace_members").select("workspace_id").eq("user_id", authUser.id);
      if (membershipsErr) throw new Error("cancel_invite_capture_failed");
      affectedWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];

      const { error: profilesDeleteErr } = await adminClient
        .from("profiles").delete().eq("id", authUser.id);
      if (profilesDeleteErr) throw new Error("cancel_invite_delete_failed");

      const { error: membersDeleteErr } = await adminClient
        .from("workspace_members").delete().eq("user_id", authUser.id);
      if (membersDeleteErr) throw new Error("cancel_invite_delete_failed");

      const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(authUser.id);
      if (deleteUserErr) throw new Error("cancel_invite_delete_failed");

      deletedUser = true;
    }
  }

  const { error: finalDeleteErr } = await adminClient
    .from("invites").delete().eq("id", args.inviteId);
  if (finalDeleteErr) throw new Error("cancel_invite_final_delete_failed");

  // Always include the target workspace even when no global delete happened.
  if (!affectedWorkspaceIds.includes(args.contaId)) affectedWorkspaceIds.push(args.contaId);

  return { status: "cancelled", email, deletedUser, affectedWorkspaceIds };
}
