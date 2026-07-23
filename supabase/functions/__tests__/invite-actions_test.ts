import { assert, assertEquals } from "./assert.ts";
import { getAuthStatesByEmails } from "../_shared/invite-actions.ts";

// Fake admin client: one listUsers page, plus rpc(user_has_password) and profiles reads.
function makeAdmin(opts: {
  users: Array<{ id: string; email: string; email_confirmed_at?: string | null; confirmation_sent_at?: string | null; invited_at?: string | null; last_sign_in_at?: string | null }>;
  passwords?: Record<string, boolean>;
  onboarded?: Record<string, boolean>;
}) {
  let listCalls = 0;
  return {
    _listCalls: () => listCalls,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_args: any) => {
          listCalls++;
          // single page then empty
          return Promise.resolve(listCalls === 1
            ? { data: { users: opts.users }, error: null }
            : { data: { users: [] }, error: null });
        },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, params: any) =>
      Promise.resolve({ data: opts.passwords?.[params.p_user_id] ?? null, error: null }),
    from: (_t: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => Promise.resolve({
          data: ids.map((id) => ({ id, onboarding_complete: opts.onboarded?.[id] ?? false })),
          error: null,
        }),
      }),
    }),
  };
}

Deno.test("getAuthStatesByEmails resolves everything in a single listUsers scan", async () => {
  const admin = makeAdmin({
    users: [
      { id: "u1", email: "a@x.com", email_confirmed_at: "2026-01-01T00:00:00Z", confirmation_sent_at: "2026-01-01T00:00:00Z" },
      { id: "u2", email: "b@x.com", email_confirmed_at: null, confirmation_sent_at: "2026-01-02T00:00:00Z" },
    ],
    passwords: { u1: true, u2: false },
    onboarded: { u1: true, u2: false },
  });

  // deno-lint-ignore no-explicit-any
  const states = await getAuthStatesByEmails(admin as any, ["A@x.com", "b@x.com", "missing@x.com"]);

  assertEquals(admin._listCalls(), 2); // one data page + one empty terminator, NOT one-per-email
  const a = states.get("a@x.com");
  assert(a, "expected a state for a@x.com");
  assertEquals(a!.email_confirmed, true);
  assertEquals(a!.has_password, true);
  assertEquals(a!.onboarding_complete, true);
  const b = states.get("b@x.com");
  assertEquals(b!.email_confirmed, false);
  assertEquals(b!.has_password, false);
  assertEquals(states.has("missing@x.com"), false);
});
