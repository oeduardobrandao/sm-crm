// deno-lint-ignore-file no-explicit-any
import { classifyExistingUser, coerceHasPassword } from "./invite-classify.ts";
import { sendPendingWorkspaceInvite } from "./invite-pending.ts";
import { sendInviteEmail } from "./invite-email.ts";
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import { seatsAvailable } from "./invite-seats.ts";

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

export interface InviteOrResendInput {
  contaId: string;
  email: string;
  role: "owner" | "admin" | "agent";
  invitedBy: string;
  redirectBase: string;
}
export interface InviteOrResendOpts {
  /** true (CRM/invite-user): add-direct adds an onboarded non-member. false
   * (admin resend): report instead of adding — membership mgmt is out of scope. */
  addOnboarded: boolean;
}
export type InviteRoute =
  | "added" | "already-member" | "already-onboarded" | "resent-link" | "reinvited"
  | "invited" | "plan-limit-exceeded" | "blocked-anomalous";
export interface InviteOutcome { route: InviteRoute; affectedWorkspaceIds?: string[]; }

/** Throw on a Supabase mutation error — never report success after a failed write. */
function ensureOk(error: unknown, op: string): void {
  if (error) throw new Error(`invite_mutation_failed:${op}`);
}

/**
 * THE invite-or-resend primitive shared by invite-user (CRM, addOnboarded:true)
 * and admin-resend-invite (portal, addOnboarded:false). Classifies BEFORE any
 * mutation so a blocked-anomalous / failed path never destroys the invite; the
 * seat check excludes a matching pending row (a resend consumes no new seat);
 * every mutation's { error } is inspected.
 */
export async function inviteOrResend(
  adminClient: any,
  input: InviteOrResendInput,
  opts: InviteOrResendOpts,
): Promise<InviteOutcome> {
  const email = input.email.toLowerCase();

  // (1) Seat pre-check. The pending count EXCLUDES a matching pending row for
  // this email (it is being replaced, not added — finding 3), so members +
  // pending-for-OTHER-emails < limit correctly leaves room for this one row.
  const limit = await effectivePlanLimit(adminClient, input.contaId, "max_team_members");
  const [membersRes, pendingRes] = await Promise.all([
    adminClient.from("workspace_members").select("*", { count: "exact", head: true })
      .eq("workspace_id", input.contaId),
    adminClient.from("invites").select("*", { count: "exact", head: true })
      .eq("conta_id", input.contaId).eq("status", "pending").neq("email", email),
  ]);
  ensureOk(membersRes.error, "count_members");
  ensureOk(pendingRes.error, "count_pending");
  if (!seatsAvailable({ limit, members: membersRes.count ?? 0, pendingInvites: pendingRes.count ?? 0 })) {
    return { route: "plan-limit-exceeded" };
  }

  // (2) Classify the existing auth user BEFORE mutating anything.
  const existingUser = await findAuthUserByEmail(adminClient, email);
  if (existingUser) {
    const { data: prof } = await adminClient
      .from("profiles").select("onboarding_complete, id").eq("id", existingUser.id).maybeSingle();
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: existingUser.id });
    const action = classifyExistingUser({
      emailConfirmed: !!existingUser.email_confirmed_at,
      hasProfile: !!prof,
      onboardingComplete: prof?.onboarding_complete === true,
      hasPassword: coerceHasPassword(pw, pwErr),
    });

    // No mutation yet — safe to bail on the non-actionable states.
    if (action === "blocked-anomalous") return { route: "blocked-anomalous" };

    if (action === "add-direct") {
      const { data: membership } = await adminClient
        .from("workspace_members").select("id")
        .eq("user_id", existingUser.id).eq("workspace_id", input.contaId).maybeSingle();
      if (membership) return { route: "already-member" };
      if (!opts.addOnboarded) return { route: "already-onboarded" }; // admin: report, don't add
      // CRM: add the member (finding-2 fix for the CRM path).
      await deletePriorInvites(adminClient, email, input.contaId);
      const mIns = await adminClient.from("workspace_members")
        .insert({ user_id: existingUser.id, workspace_id: input.contaId, role: input.role });
      ensureOk(mIns.error, "member_insert");
      const { data: existingProfile } = await adminClient
        .from("profiles").select("id").eq("id", existingUser.id).maybeSingle();
      if (!existingProfile) {
        const pIns = await adminClient.from("profiles").insert({
          id: existingUser.id, conta_id: input.contaId, role: input.role,
          nome: existingUser.user_metadata?.nome || email.split("@")[0],
          active_workspace_id: input.contaId, onboarding_complete: true,
        });
        ensureOk(pIns.error, "profile_insert");
      }
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(),
      });
      ensureOk(iIns.error, "invite_insert_accepted");
      return { route: "added" };
    }

    if (action === "resend-link") {
      await deletePriorInvites(adminClient, email, input.contaId);
      const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: input.redirectBase + "/configurar-senha" },
      });
      if (linkErr || !link?.properties?.action_link) throw new Error("generate_link_failed");
      const { data: conta } = await adminClient
        .from("contas").select("nome").eq("id", input.contaId).maybeSingle();
      await sendInviteEmail({ to: email, actionLink: link.properties.action_link, workspaceName: conta?.nome || "seu workspace" });
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy, status: "pending",
      });
      ensureOk(ins.error, "invite_insert_pending");
      return { route: "resent-link" };
    }

    // reinvite: never-confirmed. Capture the user's workspaces for audit BEFORE
    // deleting, then delete + fresh invite.
    const { data: memberships } = await adminClient
      .from("workspace_members").select("workspace_id").eq("user_id", existingUser.id);
    const affectedWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];
    if (!affectedWorkspaceIds.includes(input.contaId)) affectedWorkspaceIds.push(input.contaId);
    await deletePriorInvites(adminClient, email, input.contaId);
    ensureOk((await adminClient.from("profiles").delete().eq("id", existingUser.id)).error, "profile_delete");
    ensureOk((await adminClient.from("workspace_members").delete().eq("user_id", existingUser.id)).error, "member_delete");
    ensureOk((await adminClient.auth.admin.deleteUser(existingUser.id)).error, "user_delete");
    await sendNewUserInvite(adminClient, input, email);
    return { route: "reinvited", affectedWorkspaceIds };
  }

  // (3) New user.
  await deletePriorInvites(adminClient, email, input.contaId);
  await sendNewUserInvite(adminClient, input, email);
  return { route: "invited" };
}

async function deletePriorInvites(adminClient: any, email: string, contaId: string): Promise<void> {
  const { error } = await adminClient.from("invites").delete()
    .eq("email", email).eq("conta_id", contaId).in("status", ["pending", "expired"]);
  ensureOk(error, "prior_invites_delete");
}

async function sendNewUserInvite(adminClient: any, input: InviteOrResendInput, email: string): Promise<void> {
  await sendPendingWorkspaceInvite({
    createPendingInvite: async (p) => {
      const { data, error } = await adminClient.from("invites").insert({
        conta_id: p.contaId, email: p.email, role: p.role, invited_by: p.invitedBy, status: "pending",
      }).select("id").single();
      if (error || !data) throw error ?? new Error("invite_insert_failed");
      return data;
    },
    sendAuthInvite: async (p) => {
      const { error } = await adminClient.auth.admin.inviteUserByEmail(p.email, {
        data: { conta_id: p.contaId, role: p.role, nome: p.email.split("@")[0] },
        redirectTo: p.redirectTo,
      });
      if (error) throw error;
    },
    deletePendingInvite: async (id) => { await adminClient.from("invites").delete().eq("id", id); },
  }, {
    contaId: input.contaId, email, role: input.role, invitedBy: input.invitedBy,
    redirectTo: input.redirectBase + "/configurar-senha",
  });
}
