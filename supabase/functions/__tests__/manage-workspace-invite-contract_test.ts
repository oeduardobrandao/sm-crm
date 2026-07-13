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
