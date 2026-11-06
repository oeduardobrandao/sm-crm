import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('financeiro scopes (owner-only)', () => {
  const find = (v: string) => SCOPE_OPTIONS.find((s) => s.value === v);

  it('offers financeiro:read and financeiro:write flagged ownerOnly', () => {
    expect(find('financeiro:read')).toEqual({
      value: 'financeiro:read',
      label: 'Financeiro (leitura, só donos)',
      ownerOnly: true,
    });
    expect(find('financeiro:write')).toEqual({
      value: 'financeiro:write',
      label: 'Financeiro (escrita, só donos)',
      ownerOnly: true,
    });
  });
  it('flags every other option as not owner-only, explicitly', () => {
    for (const s of SCOPE_OPTIONS) {
      expect(typeof s.ownerOnly).toBe('boolean');
      if (!s.value.startsWith('financeiro:')) expect(s.ownerOnly).toBe(false);
    }
  });
  it('keeps AGENT_PRESET free of any financeiro scope', () => {
    expect(AGENT_PRESET.some((s) => s.startsWith('financeiro:'))).toBe(false);
  });
  it('mirrors MCP_ALLOWED_SCOPES in the edge function, in the same order', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../supabase/functions/_shared/mcp-token.ts'),
      'utf8',
    );
    const block = src.match(/MCP_ALLOWED_SCOPES = \[([\s\S]*?)\] as const/)?.[1] ?? '';
    const edge = [...block.matchAll(/"([a-z]+:[a-z]+)"/g)].map((m) => m[1]);
    expect(SCOPE_OPTIONS.map((s) => s.value)).toEqual(edge);
  });
});
