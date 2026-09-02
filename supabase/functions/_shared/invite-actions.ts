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
  const entries = [...byEmail.entries()];
  const passwordResults = await Promise.all(
    entries.map(([, u]) => adminClient.rpc("user_has_password", { p_user_id: u.id })),
  );
  entries.forEach(([key, u], i) => {
    const { data: pw, error: pwErr } = passwordResults[i];
    out.set(key, {
      user_id: u.id,
      email_confirmed: !!u.email_confirmed_at,
      confirmation_sent_at: u.confirmation_sent_at ?? null,
      invited_at: u.invited_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      has_password: coerceHasPassword(pw, pwErr),
      onboarding_complete: onboardedById.get(u.id) ?? false,
    });
  });
  return out;
}

/** Throw on a Supabase mutation error — never report success after a failed write. */
function ensureOk(error: unknown, op: string): void {
  if (error) {
    console.error(`[invite-actions:${op}]`, error);
    throw new Error(`invite_mutation_failed:${op}`);
  }
}

/** An insert's new row id, failing loudly rather than silently returning undefined. */
function insertedId(res: { data?: { id?: string } | null; error: unknown }, op: string): string {
  ensureOk(res.error, op);
  if (!res.data?.id) {
    console.error(`[invite-actions:${op}] insert reported no error but returned no id`);
    throw new Error(`invite_mutation_failed:${op}`);
  }
  return res.data.id;
}

export interface OrphanImpact {
  /** Workspaces where this user holds a membership row — deleted with the user. */
  memberWorkspaceIds: string[];
  /** OTHER workspaces holding a pending invite for this email. The rows survive
   * (no FK on the email) but their links die with the auth user, leaving an
   * invite that looks pending and can never be redeemed. */
  pendingWorkspaceIds: string[];
  /** De-duplicated union, minus the workspace being acted on. */
  otherWorkspaceIds: string[];
}

/**
 * Everything deleting this orphan auth user would destroy or invalidate.
 * Measured BEFORE any mutation so a caller can refuse; measuring only
 * workspace_members would miss the dead-link half entirely, which is the more
 * common of the two (the invited-user trigger creates no membership row).
 */
async function captureOrphanImpact(
  adminClient: any,
  userId: string,
  email: string,
  contaId: string,
): Promise<OrphanImpact> {
  const { data: memberships, error: membershipsErr } = await adminClient
    .from("workspace_members").select("workspace_id").eq("user_id", userId);
  ensureOk(membershipsErr, "capture_memberships");
  const memberWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];

  const { data: pending, error: pendingErr } = await adminClient
    .from("invites").select("conta_id")
    .eq("email", email).eq("status", "pending").neq("conta_id", contaId);
  ensureOk(pendingErr, "capture_pending_invites");
  const pendingWorkspaceIds = [...new Set((pending ?? []).map((i: any) => i.conta_id))] as string[];

  const otherWorkspaceIds = [...new Set([...memberWorkspaceIds, ...pendingWorkspaceIds])]
    .filter((id) => id !== contaId);

  return { memberWorkspaceIds, pendingWorkspaceIds, otherWorkspaceIds };
}

/**
 * Delete the orphan's profile, ALL of their membership rows, and the auth
 * record — every mutation's { error } checked. Capture the impact FIRST via
 * captureOrphanImpact: once this runs there is nothing left to measure.
 */
async function deleteOrphanedAuthUser(adminClient: any, userId: string): Promise<void> {
  ensureOk((await adminClient.from("profiles").delete().eq("id", userId)).error, "profile_delete");
  ensureOk((await adminClient.from("workspace_members").delete().eq("user_id", userId)).error, "member_delete");
  ensureOk((await adminClient.auth.admin.deleteUser(userId)).error, "auth_user_delete");
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
 * impact via captureOrphanImpact BEFORE the delete — the union of its
 * workspace_members set AND any other workspaces holding a pending invite for
 * that email — so callers can audit every workspace the user vanished from.
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
      const impact = await captureOrphanImpact(adminClient, authUser.id, email, args.contaId);
      await deleteOrphanedAuthUser(adminClient, authUser.id);
      affectedWorkspaceIds = [...new Set([...impact.memberWorkspaceIds, ...impact.pendingWorkspaceIds])];
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
  /** Membro da equipe this invite links to (Equipe form). Stamped on every
   * invites row; the added route links membros.crm_user_id immediately. */
  membroId?: number | null;
  /** Custom workspace_roles.id, when the caller picked a granular role.
   * Stamped on every invites row alongside the legacy `role` display value
   * (role stays whatever the caller sent, unchanged). The add-direct route's
   * ACTUAL membership additionally collapses `role` to the 'agent' chassis
   * value whenever roleId is present — see that route below. */
  roleId?: string | null;
}
export interface InviteOrResendOpts {
  /** true (CRM/invite-user): add-direct adds an onboarded non-member. false
   * (admin resend): report instead of adding — membership mgmt is out of scope. */
  addOnboarded: boolean;
  /** true = the caller holds an explicit human confirmation for a reinvite whose
   * blast radius reaches other workspaces. Omitted/false = refuse with
   * "needs-confirmation" before mutating anything. invite-user passes true so
   * the CRM's own invite button behaves exactly as it does today. */
  confirmCrossWorkspace?: boolean;
}
export type InviteRoute =
  | "added" | "already-member" | "already-onboarded" | "resent-link" | "reinvited"
  | "invited" | "plan-limit-exceeded" | "blocked-anomalous" | "needs-confirmation";
export interface InviteOutcome {
  route: InviteRoute;
  affectedWorkspaceIds?: string[];
  /** Id of the invites row this call created. Present on added / resent-link /
   * reinvited / invited; absent on the no-op routes. Callers audit it as
   * resource_id — conta_id + email is not unique across history. */
  inviteId?: string;
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

  // Resolve the membro link for every invites row written below. When the
  // caller passes none (resend from Configurações / admin portal), inherit it
  // from the pending row being replaced: deletePriorInvites + re-insert would
  // otherwise silently drop a link created from the Equipe form.
  let membroId = input.membroId ?? null;
  if (membroId == null) {
    const { data: prior } = await adminClient
      .from("invites").select("membro_id")
      .eq("conta_id", input.contaId).eq("email", email).eq("status", "pending")
      .not("membro_id", "is", null).maybeSingle();
    membroId = prior?.membro_id ?? null;
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
      // Chassis rule: a custom role ALWAYS creates the membership as the
      // 'agent' chassis role + role_id — never the legacy role string. The
      // legacy `role` value from the body is preserved only on invites.role
      // below (display), never on the actual membership/profile row.
      const memberRole: "owner" | "admin" | "agent" = input.roleId ? "agent" : input.role;
      const mIns = await adminClient.from("workspace_members")
        .insert({ user_id: existingUser.id, workspace_id: input.contaId, role: memberRole, role_id: input.roleId ?? null });
      ensureOk(mIns.error, "member_insert");
      const { data: existingProfile } = await adminClient
        .from("profiles").select("id, active_workspace_id").eq("id", existingUser.id).maybeSingle();
      if (!existingProfile) {
        const pIns = await adminClient.from("profiles").insert({
          id: existingUser.id, conta_id: input.contaId, role: memberRole,
          nome: existingUser.user_metadata?.nome || email.split("@")[0],
          active_workspace_id: input.contaId, onboarding_complete: true,
        });
        ensureOk(pIns.error, "profile_insert");
      } else if (!existingProfile.active_workspace_id) {
        // Existing profile with NO active workspace (e.g. just removed from
        // their only membership) being silently re-added: restore it, or
        // they get a live session that every RLS-gated query returns empty
        // for. A profile that already points at a DIFFERENT, still-valid
        // workspace is left alone -- this add must not switch them away from
        // wherever they're actively working.
        const pUpd = await adminClient.from("profiles")
          .update({ active_workspace_id: input.contaId, conta_id: input.contaId })
          .eq("id", existingUser.id);
        ensureOk(pUpd.error, "profile_active_workspace_restore");
      }
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(), membro_id: membroId,
        role_id: input.roleId ?? null,
      }).select("id").single();
      if (membroId != null) {
        const upd = await adminClient.from("membros")
          .update({ crm_user_id: existingUser.id })
          .eq("id", membroId).eq("conta_id", input.contaId).is("crm_user_id", null);
        ensureOk(upd.error, "membro_link");
      }
      return { route: "added", inviteId: insertedId(iIns, "invite_insert_accepted") };
    }

    if (action === "resend-link") {
      await deletePriorInvites(adminClient, email, input.contaId);
      const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: input.redirectBase + "/configurar-senha" },
      });
      if (linkErr || !link?.properties?.action_link) {
        console.error("[invite-actions:resend-link] generateLink failed", linkErr);
        throw new Error("generate_link_failed");
      }
      const { data: conta } = await adminClient
        .from("contas").select("nome").eq("id", input.contaId).maybeSingle();
      await sendInviteEmail({ to: email, actionLink: link.properties.action_link, workspaceName: conta?.nome || "seu workspace" });
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "pending", membro_id: membroId, role_id: input.roleId ?? null,
      }).select("id").single();
      return { route: "resent-link", inviteId: insertedId(ins, "invite_insert_pending") };
    }

    // reinvite: never-confirmed. Measure the blast radius BEFORE touching
    // anything — this route deletes the auth user globally, which drops every
    // membership they hold and kills the invite links of pending invites for
    // this email in other workspaces.
    const impact = await captureOrphanImpact(adminClient, existingUser.id, email, input.contaId);
    if (impact.otherWorkspaceIds.length > 0 && !opts.confirmCrossWorkspace) {
      return { route: "needs-confirmation", affectedWorkspaceIds: impact.otherWorkspaceIds };
    }
    await deletePriorInvites(adminClient, email, input.contaId);
    await deleteOrphanedAuthUser(adminClient, existingUser.id);
    const affectedWorkspaceIds = [...new Set([
      ...impact.memberWorkspaceIds, ...impact.pendingWorkspaceIds, input.contaId,
    ])];
    const inviteId = await sendNewUserInvite(adminClient, input, email, membroId);
    return { route: "reinvited", affectedWorkspaceIds, inviteId };
  }

  // (3) New user.
  await deletePriorInvites(adminClient, email, input.contaId);
  const inviteId = await sendNewUserInvite(adminClient, input, email, membroId);
  return { route: "invited", inviteId };
}

async function deletePriorInvites(adminClient: any, email: string, contaId: string): Promise<void> {
  const { error } = await adminClient.from("invites").delete()
    .eq("email", email).eq("conta_id", contaId).in("status", ["pending", "expired"]);
  ensureOk(error, "prior_invites_delete");
}

/** Returns the id of the pending invites row it created. */
async function sendNewUserInvite(adminClient: any, input: InviteOrResendInput, email: string, membroId: number | null): Promise<string> {
  return await sendPendingWorkspaceInvite({
    createPendingInvite: async (p) => {
      const { data, error } = await adminClient.from("invites").insert({
        conta_id: p.contaId, email: p.email, role: p.role, invited_by: p.invitedBy,
        status: "pending", membro_id: p.membroId ?? null, role_id: p.roleId ?? null,
      }).select("id").single();
      if (error || !data) throw error ?? new Error("invite_insert_failed");
      return data;
    },
    // roleId deliberately NOT included in user_metadata: metadata.role stays
    // the legacy display value. The accept-invite RPC (Task 1) resolves the
    // real membership role from invites.role_id, not from this metadata.
    sendAuthInvite: async (p) => {
      const { error } = await adminClient.auth.admin.inviteUserByEmail(p.email, {
        data: { conta_id: p.contaId, role: p.role, nome: p.email.split("@")[0] },
        redirectTo: p.redirectTo,
      });
      if (error) throw error;
    },
    // Throw on a failed rollback so sendPendingWorkspaceInvite's catch actually
    // logs it — supabase-js RESOLVES with { error }, so ignoring it left a
    // phantom pending row with no trace anywhere.
    deletePendingInvite: async (id) => {
      const { error } = await adminClient.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
  }, {
    contaId: input.contaId, email, role: input.role, invitedBy: input.invitedBy,
    redirectTo: input.redirectBase + "/configurar-senha", membroId, roleId: input.roleId ?? null,
  });
}
