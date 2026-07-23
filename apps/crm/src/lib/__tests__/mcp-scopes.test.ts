import { describe, it, expect } from 'vitest';
import { SCOPE_OPTIONS, AGENT_PRESET } from '../mcp-scopes';

describe('mcp-scopes', () => {
  it('offers templates:write as a selectable scope', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'templates:write')).toBe(true);
  });
  it('keeps writes out of the read-only AGENT_PRESET', () => {
    expect(AGENT_PRESET).not.toContain('templates:write');
    expect(AGENT_PRESET).not.toContain('posts:write');
  });
});

describe('retired Estúdio scopes', () => {
  // Estúdio was retired from the MCP connector: its tools are gone, so offering the scopes
  // would let a user grant a permission that maps to nothing — exactly the confusion the
  // removal set out to fix. Mirrors MCP_ALLOWED_SCOPES in _shared/mcp-token.ts.
  it('no longer offers designs:write or images:generate', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'designs:write')).toBe(false);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'images:generate')).toBe(false);
    expect(AGENT_PRESET).not.toContain('designs:write');
    expect(AGENT_PRESET).not.toContain('images:generate');
  });
});
