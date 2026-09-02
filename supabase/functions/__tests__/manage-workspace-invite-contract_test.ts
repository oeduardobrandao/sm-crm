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
