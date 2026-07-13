import { assert, assertEquals } from "./assert.ts";

const migrationUrl = new URL(
  "../../migrations/20260713000001_secure_workspace_invites.sql",
  import.meta.url,
);

Deno.test("workspace invite authorization comes from persisted invites and memberships", async () => {
  const sql = await Deno.readTextFile(migrationUrl);

  assert(sql.includes("lower(i.email) = lower(NEW.email)"));
  assert(sql.includes("i.status = 'pending'"));
  assert(sql.includes("i.expires_at > now()"));
  assert(sql.includes("v_invite.role::user_role"));
  assertEquals(sql.includes("NEW.raw_user_meta_data ->> 'role'"), false);
  assert(sql.includes("RAISE EXCEPTION 'invalid_workspace_invitation'"));
  assert(sql.includes("wm.user_id = auth.uid()"));
  assert(sql.includes("wm.workspace_id = p.active_workspace_id"));
});

Deno.test("acceptance RPC is transactional and service-role-only", async () => {
  const sql = await Deno.readTextFile(migrationUrl);

  assert(sql.includes("CREATE OR REPLACE FUNCTION public.accept_workspace_invite"));
  assert(sql.includes("ON CONFLICT (user_id, workspace_id) DO UPDATE"));
  assert(sql.includes("REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC"));
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role"));
});
