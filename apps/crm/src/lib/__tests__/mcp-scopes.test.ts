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

describe('estudio scopes (design §9)', () => {
  it('offers designs:write and images:generate as selectable scopes', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'designs:write')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'images:generate')).toBe(true);
  });
  it('flags the spend scope in its label and keeps both out of the AGENT_PRESET', () => {
    const spend = SCOPE_OPTIONS.find((s) => s.value === 'images:generate');
    expect(spend?.label).toMatch(/custo/i);
    expect(AGENT_PRESET).not.toContain('designs:write');
    expect(AGENT_PRESET).not.toContain('images:generate');
  });
});
