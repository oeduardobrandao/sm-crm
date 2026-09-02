import { assert } from "./assert.ts";

// invite-user/index.ts wraps its handler in Deno.serve, which no test in this
// suite invokes directly (it would bind a real network listener). Every other
// Deno.serve-wrapped edge function in this repo is instead covered by a
// source-contract test (see manage-workspace-invite-contract_test.ts) that
// asserts the expected logic is present in the compiled source. This mirrors
// that convention for the role_id validation added in Task 6.

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../invite-user/index.ts", import.meta.url),
);

Deno.test("invite-user: a non-uuid role_id is rejected with 400 'Papel inválido.'", () => {
  assertMatch(source, /UUID_RE\.test\(roleId\)/, "expected a UUID-format check on roleId");
  assertMatch(source, /Papel inválido\./, "expected the 'Papel inválido.' message");
  // The validation block must return an explicit 400 — NOT a bare `throw`,
  // which this file's outer catch (internalServerError) collapses to a
  // generic 500 for every other thrown Error here. Only the explicit-status
  // pattern used by the sibling membroId validation actually reaches the
  // client as 400.
  const roleIdBlock = source.match(/const roleId: string \| null[\s\S]*?\n {4}\}\n/)?.[0] ?? "";
  assert(roleIdBlock.length > 0, "expected a role_id validation block");
  assertMatch(roleIdBlock, /status:\s*400/, "expected the role_id rejection to respond 400");
  assert(!/throw new Error\(['"]Papel inválido/.test(source), "must not rely on the generic 500 catch-all for this validation");
});

Deno.test("invite-user: role_id is validated against workspace_roles scoped to the caller's own workspace", () => {
  assertMatch(source, /from\(['"]workspace_roles['"]\)/, "expected a workspace_roles lookup");
  assertMatch(source, /\.eq\(['"]id['"],\s*roleId\)/, "expected the lookup to filter by id");
  assertMatch(source, /\.eq\(['"]conta_id['"],\s*caller\.workspaceId\)/, "expected the lookup scoped to caller.workspaceId (not a body-supplied workspace)");
});

Deno.test("invite-user: a non-string body.role_id is treated as absent, not rejected", () => {
  assertMatch(
    source,
    /typeof body\.role_id === ['"]string['"]\s*\?\s*body\.role_id\s*:\s*null/,
    "expected a non-string role_id to fall back to null rather than fail validation",
  );
});

Deno.test("invite-user: roleId is threaded into the inviteOrResend call alongside the legacy role", () => {
  const inviteOrResendCall = source.match(/await inviteOrResend\(adminClient, \{[\s\S]*?\}, \{/)?.[0] ?? "";
  assert(inviteOrResendCall.length > 0, "expected an inviteOrResend(adminClient, {...}, {...}) call");
  assertMatch(inviteOrResendCall, /role,/, "expected the legacy role to still be passed through unchanged");
  assertMatch(inviteOrResendCall, /roleId,/, "expected roleId to be passed alongside role");
});
