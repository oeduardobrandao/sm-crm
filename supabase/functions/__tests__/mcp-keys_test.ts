import { assert, assertEquals } from "./assert.ts";
import { MCP_AGENT_PRESET, MCP_ALLOWED_SCOPES, validateScopes } from "../_shared/mcp-token.ts";

Deno.test("validateScopes accepts non-empty allowlisted scopes", () => {
  assertEquals(validateScopes(["clientes:read", "posts:read"]), true);
  assertEquals(validateScopes([...MCP_AGENT_PRESET]), true);
});

Deno.test("validateScopes rejects empty / unknown / non-array", () => {
  assertEquals(validateScopes([]), false);
  assertEquals(validateScopes(["clientes:write"]), false); // write reserved for PR 3
  assertEquals(validateScopes(["bogus"]), false);
  assertEquals(validateScopes("posts:read"), false);
  assertEquals(validateScopes(null), false);
});

Deno.test("agent preset is read-only and within the allowlist", () => {
  for (const s of MCP_AGENT_PRESET) {
    assert((MCP_ALLOWED_SCOPES as readonly string[]).includes(s), `${s} in allowlist`);
    assert(s.endsWith(":read"), `${s} is read-only`);
  }
});
