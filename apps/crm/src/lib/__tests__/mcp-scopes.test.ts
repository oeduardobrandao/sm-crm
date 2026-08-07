import { describe, it, expect } from 'vitest';
import { SCOPE_OPTIONS, AGENT_PRESET, SCOPE_IMPLIES } from '../mcp-scopes';

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

describe('tarefas scopes', () => {
  it('offers tarefas:read and tarefas:write as selectable scopes', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'tarefas:read')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'tarefas:write')).toBe(true);
  });
  it('adds tarefas:read to the preset but keeps tarefas:write out', () => {
    expect(AGENT_PRESET).toContain('tarefas:read');
    expect(AGENT_PRESET).not.toContain('tarefas:write');
  });
});

describe('import assistant scopes (clientes/membros)', () => {
  it('offers clientes:write, membros:read and membros:write as selectable scopes', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'clientes:write')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'membros:read')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'membros:write')).toBe(true);
  });
  it('adds membros:read to the preset but keeps the new writes out', () => {
    expect(AGENT_PRESET).toContain('membros:read');
    expect(AGENT_PRESET).not.toContain('clientes:write');
    expect(AGENT_PRESET).not.toContain('membros:write');
  });
});

describe('SCOPE_IMPLIES', () => {
  // create_client/create_member return the row they just wrote, so mcp/tools.ts requires the
  // matching read scope alongside the write scope. The scope pickers must keep that pair
  // consistent instead of letting a user mint a write-only key/grant that fails at call time.
  it('maps clientes:write to clientes:read and membros:write to membros:read', () => {
    expect(SCOPE_IMPLIES['clientes:write']).toBe('clientes:read');
    expect(SCOPE_IMPLIES['membros:write']).toBe('membros:read');
  });

  it('keeps every key and value inside SCOPE_OPTIONS', () => {
    const values = SCOPE_OPTIONS.map((s) => s.value);
    for (const [write, read] of Object.entries(SCOPE_IMPLIES)) {
      expect(values).toContain(write);
      expect(values).toContain(read);
    }
  });
});
