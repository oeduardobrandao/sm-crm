import { assert, assertEquals } from "./assert.ts";
import {
  generateApiKey,
  hashToken,
  hasScope,
  MCP_TOKEN_PREFIX,
  McpScopeError,
  mcpKeyActive,
  requireScope,
} from "../_shared/mcp-token.ts";

Deno.test("hashToken is deterministic, 64 hex chars", async () => {
  const a = await hashToken("mesaas_sk_abc");
  const b = await hashToken("mesaas_sk_abc");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]+$/.test(a), "hash should be lowercase hex");
});

Deno.test("generateApiKey: prefixed, hash matches raw, suffix is last 4", async () => {
  const { raw, hash, suffix } = await generateApiKey();
  assert(raw.startsWith(MCP_TOKEN_PREFIX), "raw should be prefixed");
  assertEquals(await hashToken(raw), hash);
  assertEquals(raw.slice(-4), suffix);
});

Deno.test("mcpKeyActive gates on feature, revocation and expiry", () => {
  const now = "2026-06-22T00:00:00.000Z";
  assertEquals(mcpKeyActive({ revoked_at: null, expires_at: null }, true, now), true);
  assertEquals(mcpKeyActive({ revoked_at: null, expires_at: null }, false, now), false); // feature off
  assertEquals(mcpKeyActive({ revoked_at: now, expires_at: null }, true, now), false); // revoked
  assertEquals(mcpKeyActive({ revoked_at: null, expires_at: "2020-01-01T00:00:00Z" }, true, now), false); // expired
  assertEquals(mcpKeyActive({ revoked_at: null, expires_at: "2999-01-01T00:00:00Z" }, true, now), true); // future
});

Deno.test("hasScope / requireScope", () => {
  const ctx = { conta_id: "w", scopes: ["posts:read"], key_id: "k", created_by: "u" };
  assertEquals(hasScope(ctx.scopes, "posts:read"), true);
  assertEquals(hasScope(ctx.scopes, "posts:write"), false);
  requireScope(ctx, "posts:read"); // must not throw
  let threw = false;
  try {
    requireScope(ctx, "clientes:read");
  } catch (e) {
    threw = e instanceof McpScopeError;
  }
  assert(threw, "expected McpScopeError for missing scope");
});
