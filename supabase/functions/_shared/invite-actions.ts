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
