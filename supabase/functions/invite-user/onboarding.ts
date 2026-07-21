export type InviteAction = "reinvite" | "resend-link" | "add-direct" | "blocked-anomalous";

/**
 * Decide what to do when the invited e-mail already has an auth user.
 *
 * - "add-direct": the user has fully completed onboarding (actually set a
 *   usable password), so just add them to the new workspace.
 *   `hasPassword === false` overrides `onboardingComplete`: a user with no password
 *   cannot log in, so they are routed to "resend-link" no matter what the flag says.
 * - "resend-link": the user confirmed their e-mail (clicked the invite link,
 *   which mints a session) but never set a password. Re-send a fresh
 *   set-password link to the SAME user — no delete — so the prior link and any
 *   in-flight set-password session are preserved.
 * - "reinvite": the user never even confirmed their e-mail. There is nothing
 *   in-flight to destroy, so delete and re-invite with a fresh link instead of
 *   silently marking them "accepted". This (together with "resend-link") closes
 *   the "confirmed-with-no-password" trap that surfaced as a "wrong password"
 *   error on login.
 * - "blocked-anomalous": a confirmed auth user with NO profile row. The trigger
 *   always creates a profile, so this state should be impossible; refuse to
 *   auto-delete it rather than risk wiping a real account.
 *
 * `onboardingComplete` is authoritative only while `hasPassword` is unknown.
 * An explicit `hasPassword: false` overrides it — a user with no password
 * cannot log in, so they are routed to "resend-link", or to "reinvite" (which
 * deletes the auth user) if they never confirmed their e-mail either.
 */
export function classifyExistingUser(
  args: {
    emailConfirmed: boolean;
    hasProfile: boolean;
    onboardingComplete: boolean;
    /**
     * Ground truth from auth.users.encrypted_password. `undefined`/`null` mean
     * "unknown" (RPC missing or failed) and preserve the flag-only behavior, so a
     * broken lookup degrades instead of blocking every invite. Only an explicit
     * `false` vetoes add-direct.
     */
    hasPassword?: boolean | null;
  },
): InviteAction {
  // onboarding_complete is not authoritative: the 20260629000001 backfill set it
  // true for every pre-existing profile, and the healPendingInvite bug (PR #175)
  // set it true for users who never set a password. Both pinned real people to
  // add-direct, which adds them to the workspace and mails nothing.
  if (args.onboardingComplete && args.hasPassword !== false) return "add-direct";
  if (args.emailConfirmed && !args.hasProfile) return "blocked-anomalous";
  // Confirmed but never set a password: re-send a fresh link to the SAME user
  // (non-destructive) instead of deleting + recreating them.
  if (args.emailConfirmed) return "resend-link";
  // Never confirmed: nothing in-flight to destroy — delete + fresh invite.
  return "reinvite";
}
