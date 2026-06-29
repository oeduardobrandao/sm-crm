export type InviteAction = "reinvite" | "add-direct" | "blocked-anomalous";

/**
 * Decide what to do when the invited e-mail already has an auth user.
 *
 * - "add-direct": the user has fully completed onboarding (actually set a
 *   usable password), so just add them to the new workspace.
 * - "reinvite": the user never finished the invite flow — whether they never
 *   confirmed their e-mail, or they clicked the invite link (which confirms the
 *   e-mail and mints a session) but never set a password. They are deleted and
 *   re-invited with a fresh set-password link instead of being silently marked
 *   "accepted". This closes the "confirmed-with-no-password" trap that surfaced
 *   to users as a "wrong password" error on login.
 * - "blocked-anomalous": a confirmed auth user with NO profile row. The trigger
 *   always creates a profile, so this state should be impossible; refuse to
 *   auto-delete it rather than risk wiping a real account.
 *
 * `onboardingComplete` is authoritative: a user known to have completed
 * onboarding is never wiped, regardless of the other signals.
 */
export function classifyExistingUser(
  args: { emailConfirmed: boolean; hasProfile: boolean; onboardingComplete: boolean },
): InviteAction {
  if (args.onboardingComplete) return "add-direct";
  if (args.emailConfirmed && !args.hasProfile) return "blocked-anomalous";
  return "reinvite";
}
