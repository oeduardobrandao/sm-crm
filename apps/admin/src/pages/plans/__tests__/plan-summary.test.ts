import { describe, expect, it } from 'vitest';
import { workspaceCountLabel } from '../plan-summary';

describe('workspaceCountLabel', () => {
  it('omite o teste quando não há workspaces em teste', () => {
    expect(workspaceCountLabel(1)).toBe('1 workspace');
    expect(workspaceCountLabel(3, 0)).toBe('3 workspaces');
  });

  it('mostra os workspaces em teste reverso separados dos pagantes', () => {
    expect(workspaceCountLabel(4, 2)).toBe('4 workspaces · 2 em teste');
  });
});
