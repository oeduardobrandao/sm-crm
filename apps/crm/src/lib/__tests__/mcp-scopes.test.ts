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
