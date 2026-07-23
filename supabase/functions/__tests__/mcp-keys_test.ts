import { assert, assertEquals } from "./assert.ts";
import { MCP_AGENT_PRESET, MCP_ALLOWED_SCOPES, validateScopes } from "../_shared/mcp-token.ts";

Deno.test("validateScopes accepts non-empty allowlisted scopes", () => {
  assertEquals(validateScopes(["clientes:read", "posts:read"]), true);
  assertEquals(validateScopes([...MCP_AGENT_PRESET]), true);
  assertEquals(validateScopes(["templates:write"]), true);
});

Deno.test("validateScopes rejects empty / unknown / non-array", () => {
  assertEquals(validateScopes([]), false);
  assertEquals(validateScopes(["clientes:write"]), false); // clientes:write is not a granted scope
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

// Estúdio was retired from the MCP connector — a key can no longer be minted with its scopes.
Deno.test("retired estudio scopes cannot be granted to a new key", () => {
  for (const s of ["designs:write", "images:generate"]) {
    assert(!(MCP_ALLOWED_SCOPES as readonly string[]).includes(s), `${s} NOT in allowlist`);
    assert(!(MCP_AGENT_PRESET as readonly string[]).includes(s), `${s} NOT in agent preset`);
    assertEquals(validateScopes([s]), false);
    assertEquals(validateScopes(["posts:read", s]), false);
  }
});
