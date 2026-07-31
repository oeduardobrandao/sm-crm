import { describe, expect, it } from 'vitest';
import { CONFIG_TABS, visibleConfigTabs, canAccessConfigTab } from '../configTabs';

describe('configTabs', () => {
  it('gives agents only the Perfil tab', () => {
    expect(visibleConfigTabs('agent').map((t) => t.path)).toEqual(['perfil']);
  });

  it('gives admins everything except billing', () => {
    const paths = visibleConfigTabs('admin').map((t) => t.path);
    expect(paths).toEqual(['perfil', 'workspace', 'membros', 'relatorios', 'hub', 'mcp']);
    expect(paths).not.toContain('cobranca');
  });

  it('gives owners every tab', () => {
    expect(visibleConfigTabs('owner').map((t) => t.path)).toEqual(CONFIG_TABS.map((t) => t.path));
  });

  it('falls back to no tabs for an unknown or missing role', () => {
    expect(visibleConfigTabs(undefined)).toEqual([]);
    expect(visibleConfigTabs(null)).toEqual([]);
    expect(visibleConfigTabs('superuser')).toEqual([]);
  });

  it('refuses direct access to a tab the role cannot see', () => {
    // Guards the URL, not just the strip — hiding a tab is not access control.
    expect(canAccessConfigTab('membros', 'agent')).toBe(false);
    expect(canAccessConfigTab('cobranca', 'admin')).toBe(false);
    expect(canAccessConfigTab('relatorios', 'agent')).toBe(false);
  });

  it('allows every visible tab it advertises', () => {
    for (const role of ['owner', 'admin', 'agent']) {
      for (const tab of visibleConfigTabs(role)) {
        expect(canAccessConfigTab(tab.path, role)).toBe(true);
      }
    }
  });

  it('treats an unknown path as inaccessible', () => {
    expect(canAccessConfigTab('nao-existe', 'owner')).toBe(false);
    expect(canAccessConfigTab('', 'owner')).toBe(false);
  });

  it('keeps Perfil first so it works as the redirect target for every role', () => {
    expect(CONFIG_TABS[0].path).toBe('perfil');
    for (const role of ['owner', 'admin', 'agent']) {
      expect(canAccessConfigTab('perfil', role)).toBe(true);
    }
  });
});
