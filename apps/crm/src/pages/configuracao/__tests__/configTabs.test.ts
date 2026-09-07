import { describe, expect, it } from 'vitest';
import { CONFIG_TABS, visibleConfigTabs, canAccessConfigTab } from '../configTabs';
import { makeCan, fakeMembership } from '@/test/makeCan';

const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
const adminCan = makeCan(fakeMembership({ role: 'admin' }));
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
// An unresolved membership (fetch still in flight, or a genuinely broken
// workspaceRole) -- the real-world case behind "unknown or missing role".
const unresolvedCan = makeCan(null);

describe('configTabs', () => {
  it('gives agents only the Conta group tabs', () => {
    expect(visibleConfigTabs(agentCan, 'agent').map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
    ]);
  });

  it('gives admins everything except billing', () => {
    const paths = visibleConfigTabs(adminCan, 'admin').map((t) => t.path);
    expect(paths).toEqual([
      'perfil',
      'notificacoes',
      'workspace',
      'membros',
      'relatorios',
      'status',
      'hub',
      'mcp',
    ]);
    expect(paths).not.toContain('cobranca');
  });

  it('gives owners every tab', () => {
    expect(visibleConfigTabs(ownerCan, 'owner').map((t) => t.path)).toEqual(
      CONFIG_TABS.map((t) => t.path),
    );
  });

  it('falls back to just the "all" tabs (Perfil/Notificações) for an unknown or missing role', () => {
    // `permission: 'all'` bypasses can()/workspaceRole entirely by design
    // (perfil/notificacoes are a member's own account settings, not
    // workspace-permission-gated) -- everything else requires a resolved
    // membership or a literal 'owner' workspaceRole, both absent here.
    expect(visibleConfigTabs(unresolvedCan, undefined).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
    ]);
    expect(visibleConfigTabs(unresolvedCan, null).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
    ]);
    expect(visibleConfigTabs(unresolvedCan, 'superuser').map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
    ]);
  });

  it('refuses direct access to a tab the role cannot see', () => {
    // Guards the URL, not just the strip — hiding a tab is not access control.
    expect(canAccessConfigTab('membros', agentCan, 'agent')).toBe(false);
    expect(canAccessConfigTab('cobranca', adminCan, 'admin')).toBe(false);
    expect(canAccessConfigTab('relatorios', agentCan, 'agent')).toBe(false);
  });

  it('allows every visible tab it advertises', () => {
    const scenarios: [ReturnType<typeof makeCan>, string][] = [
      [ownerCan, 'owner'],
      [adminCan, 'admin'],
      [agentCan, 'agent'],
    ];
    for (const [can, workspaceRole] of scenarios) {
      for (const tab of visibleConfigTabs(can, workspaceRole)) {
        expect(canAccessConfigTab(tab.path, can, workspaceRole)).toBe(true);
      }
    }
  });

  it('treats an unknown path as inaccessible', () => {
    expect(canAccessConfigTab('nao-existe', ownerCan, 'owner')).toBe(false);
    expect(canAccessConfigTab('', ownerCan, 'owner')).toBe(false);
  });

  it('keeps Perfil first so it works as the redirect target for every role', () => {
    expect(CONFIG_TABS[0].path).toBe('perfil');
    for (const [can, workspaceRole] of [
      [ownerCan, 'owner'],
      [adminCan, 'admin'],
      [agentCan, 'agent'],
    ] as const) {
      expect(canAccessConfigTab('perfil', can, workspaceRole)).toBe(true);
    }
  });
});
