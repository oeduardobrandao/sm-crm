import { assert } from "./assert.ts";

function assertMatch(value: string, pattern: RegExp) {
  assert(pattern.test(value), `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../manage-workspace-user/index.ts", import.meta.url),
);

Deno.test("accept-invite derives identity from the authenticated user and delegates atomically", () => {
  assertMatch(source, /if \(action === ["']accept-invite["']\)[\s\S]*\.rpc\(\s*["']accept_workspace_invite["']/);
  assertMatch(source, /p_user_id:\s*user\.id/);

  const acceptBranch = source.match(
    /if \(action === ["']accept-invite["']\) \{([\s\S]*?)\n\s*\}/,
  )?.[1] ?? "";

  assert(!/body\.email|const \{ email \} = body/.test(acceptBranch));
  assert(!/\.from\(["']workspace_members["']\)/.test(acceptBranch));
  assert(!/\.from\(["']profiles["']\)/.test(acceptBranch));
  assert(!/\.from\(["']invites["']\)/.test(acceptBranch));
});

Deno.test("accept-invite reports a generic not-found response", () => {
  assertMatch(source, /invite_not_found/);
  assertMatch(source, /Convite não encontrado ou expirado\./);
});

// Task 11: the actor gate on every administrative action (update-role, remove,
// cancel-invite) moved from a `callerRole` literal check to the permission
// model, gated on ('equipe', 'editar'). callerRole itself must stay loaded --
// the owner-protection guards further down (only owner assigns owner, an
// owner target can't be modified by a non-owner) still read it.
Deno.test("actor gate consults has_permission_for('equipe','editar') instead of a callerRole literal", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  assertMatch(
    source,
    /hasPermissionFor\(serviceClient,\s*user\.id,\s*workspaceId,\s*["']equipe["'],\s*["']editar["']\)/,
  );
  assert(
    !/if \(callerRole !== ["']owner["'] && callerRole !== ["']admin["']\)/.test(source),
    "the old role-literal gate must be gone, not merely bypassed",
  );
  // callerRole is still assigned from the membership row, for the owner-protection guards below.
  assertMatch(source, /const callerRole = callerMembership\.role;/);
});

// Second external-review round: "atribuição segue dono e admin" (spec decision).
// A custom-role actor (chassis 'agent') holding only 'equipe':'editar' could
// update-role a colleague to the legacy admin preset (all modules) -- a
// permission set the actor itself doesn't hold. update-role now ALSO requires
// callerRole owner/admin, on top of the equipe:editar actor gate; remove and
// cancel-invite stay on equipe:editar alone (not gated by this literal).
Deno.test("update-role additionally requires callerRole owner/admin, on top of equipe:editar", () => {
  assertMatch(
    source,
    /if \(action === ["']update-role["'] && callerRole !== ["']owner["'] && callerRole !== ["']admin["']\)/,
  );
  assertMatch(source, /Apenas donos e admins podem alterar funções\./);
  // This new check must sit BEFORE the cancel-invite/remove branches share no
  // dependency on it -- i.e. it must not accidentally gate those actions too.
  const updateRoleGateIndex = source.indexOf("Apenas donos e admins podem alterar funções.");
  const cancelInviteIndex = source.indexOf('action === "cancel-invite"');
  assert(updateRoleGateIndex > -1 && cancelInviteIndex > -1 && updateRoleGateIndex < cancelInviteIndex,
    "expected the update-role owner/admin gate before the cancel-invite branch");
});
