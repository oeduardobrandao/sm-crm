import { assertEquals } from "jsr:@std/assert";
import { resolveRoleUpdate } from "../manage-workspace-user/roleUpdate.ts";

const WS_ROLE_ID = "6b1f2e2e-1234-4abc-9def-0123456789ab";
const ROLE_ROW = { id: WS_ROLE_ID, nome: "Editor" };

Deno.test("role e roleId juntos -> 400 role_and_role_id_exclusive", () => {
  const res = resolveRoleUpdate({
    role: "admin",
    roleId: WS_ROLE_ID,
    callerRole: "owner",
    targetRoleRow: ROLE_ROW,
  });
  assertEquals(res, { error: "role_and_role_id_exclusive", status: 400 });
});

Deno.test("nenhum dos dois -> 400 role_required", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: undefined,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "role_required", status: 400 });
});

Deno.test("role e roleId ambos null (chaves ausentes no body) -> 400 role_required", () => {
  const res = resolveRoleUpdate({
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "role_required", status: 400 });
});

Deno.test("role inválida ('x') -> 400", () => {
  const res = resolveRoleUpdate({
    role: "x",
    roleId: undefined,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "role must be one of: owner, admin, agent", status: 400 });
});

Deno.test("role 'owner' com caller admin -> 403", () => {
  const res = resolveRoleUpdate({
    role: "owner",
    roleId: undefined,
    callerRole: "admin",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "Only owner can assign owner role", status: 403 });
});

// External-review parity check (Task 11 fix round): invite-user's equivalent
// owner-invite guard was `caller.role === 'admin' && role === 'owner'`, which
// missed a custom-role actor (chassis role='agent') that passed the actor
// gate via a delegated 'equipe':'editar' permission -- a privilege
// escalation, fixed there to `caller.role !== 'owner'`. This guard was
// already correct: it checks `callerRole !== "owner"`, so a custom-role
// actor (callerRole is always the 'agent' chassis, never a role name) is
// blocked exactly like a legacy admin.
Deno.test("role 'owner' com caller de papel custom (chassi 'agent') -> 403, mesma trava do admin legado", () => {
  const res = resolveRoleUpdate({
    role: "owner",
    roleId: undefined,
    callerRole: "agent",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "Only owner can assign owner role", status: 403 });
});

Deno.test("role 'owner' com caller owner -> ok, role_id vira null", () => {
  const res = resolveRoleUpdate({
    role: "owner",
    roleId: undefined,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, {
    update: { role: "owner", role_id: null },
    profileRole: "owner",
    audit: { new_role: "owner" },
  });
});

Deno.test("roleId não-uuid -> 400 invalid_role_id", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: "not-a-uuid",
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "invalid_role_id", status: 400 });
});

Deno.test("roleId uuid mas targetRoleRow null (não achado no workspace) -> 404 role_not_found", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: WS_ROLE_ID,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "role_not_found", status: 404 });
});

Deno.test("roleId ok -> chassi agent + role_id + audit com role_nome", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: WS_ROLE_ID,
    callerRole: "owner",
    targetRoleRow: ROLE_ROW,
  });
  assertEquals(res, {
    update: { role: "agent", role_id: WS_ROLE_ID },
    profileRole: "agent",
    audit: { new_role: "agent", role_id: WS_ROLE_ID, role_nome: "Editor" },
  });
});

Deno.test("roleId ok com caller admin -> também permitido (custom role não é 'owner')", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: WS_ROLE_ID,
    callerRole: "admin",
    targetRoleRow: ROLE_ROW,
  });
  assertEquals(res, {
    update: { role: "agent", role_id: WS_ROLE_ID },
    profileRole: "agent",
    audit: { new_role: "agent", role_id: WS_ROLE_ID, role_nome: "Editor" },
  });
});

Deno.test("role preset 'admin' ok -> role_id explicitamente null (limpa custom role anterior)", () => {
  const res = resolveRoleUpdate({
    role: "admin",
    roleId: undefined,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, {
    update: { role: "admin", role_id: null },
    profileRole: "admin",
    audit: { new_role: "admin" },
  });
});

Deno.test("role preset 'agent' ok", () => {
  const res = resolveRoleUpdate({
    role: "agent",
    roleId: undefined,
    callerRole: "admin",
    targetRoleRow: null,
  });
  assertEquals(res, {
    update: { role: "agent", role_id: null },
    profileRole: "agent",
    audit: { new_role: "agent" },
  });
});

Deno.test("role não-string (ex.: number) -> 400", () => {
  const res = resolveRoleUpdate({
    role: 123,
    roleId: undefined,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "role must be one of: owner, admin, agent", status: 400 });
});

Deno.test("roleId não-string (ex.: number) -> 400 invalid_role_id", () => {
  const res = resolveRoleUpdate({
    role: undefined,
    roleId: 123,
    callerRole: "owner",
    targetRoleRow: null,
  });
  assertEquals(res, { error: "invalid_role_id", status: 400 });
});
