import { describe, expect, it } from 'vitest';
import { CONFIG_TABS, visibleConfigTabs, canAccessConfigTab } from '../configTabs';
import { makeCan, fakeMembership } from '@/test/makeCan';

const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
const adminCan = makeCan(fakeMembership({ role: 'admin' }));
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
// An unresolved membership (fetch still in flight, or a genuinely broken
// workspaceRole) -- the real-world case behind "unknown or missing role".
const unresolvedCan = makeCan(null);

// Plan flags that list the Contas conectadas tab (YouTube and/or Google Meu Negócio).
const googleOn = { feature_youtube: true, feature_google_business: true };
const googleOff = { feature_youtube: false, feature_google_business: false };

describe('configTabs', () => {
  it('gives agents the Conta group tabs plus Agentes (MCP)', () => {
    // MCP is open to every member: they connect Claude with the scopes their own role allows.
    expect(visibleConfigTabs(agentCan, 'agent', googleOn).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
      'mcp',
    ]);
  });

  it('gives admins everything except billing', () => {
    const paths = visibleConfigTabs(adminCan, 'admin', googleOn).map((t) => t.path);
    expect(paths).toEqual([
      'perfil',
      'notificacoes',
      'workspace',
      'membros',
      'relatorios',
      'status',
      'hub',
      'contas-conectadas',
      'mcp',
    ]);
    expect(paths).not.toContain('cobranca');
  });

  it('gives owners every tab', () => {
    expect(visibleConfigTabs(ownerCan, 'owner', googleOn).map((t) => t.path)).toEqual(
      CONFIG_TABS.map((t) => t.path),
    );
  });

  it('places Contas conectadas inside the Workspace group, after Hub and before Armazenamento', () => {
    const paths = CONFIG_TABS.map((t) => t.path);
    const i = paths.indexOf('contas-conectadas');
    expect(paths[i - 1]).toBe('hub');
    expect(paths[i + 1]).toBe('armazenamento');
    expect(CONFIG_TABS[i].group).toBe('workspace');
    expect(CONFIG_TABS[i].permission).toEqual({ module: 'configuracoes', action: 'ver' });
  });

  it('lists Contas conectadas only while YouTube or Google Meu Negócio is on', () => {
    const listed = (features: Parameters<typeof visibleConfigTabs>[2]) =>
      visibleConfigTabs(ownerCan, 'owner', features)
        .map((t) => t.path)
        .includes('contas-conectadas');
    expect(listed(googleOn)).toBe(true);
    expect(listed({ feature_youtube: true, feature_google_business: false })).toBe(true);
    expect(listed({ feature_youtube: false, feature_google_business: true })).toBe(true);
    expect(listed(googleOff)).toBe(false);
    expect(listed({})).toBe(false);
    // Plan flags still loading: hidden (a brief pop-in, never a wrong advertisement).
    expect(listed(null)).toBe(false);
    expect(listed(undefined)).toBe(false);
  });

  it('keeps the other tabs identical with the Google flags off', () => {
    expect(visibleConfigTabs(adminCan, 'admin', googleOff).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
      'workspace',
      'membros',
      'relatorios',
      'status',
      'hub',
      'mcp',
    ]);
    expect(visibleConfigTabs(adminCan, 'admin').map((t) => t.path)).not.toContain(
      'contas-conectadas',
    );
  });

  it('lets the route reach Contas conectadas by permission alone, whatever the flags', () => {
    // canAccessConfigTab is the URL guard: a downgraded workspace can still remove access.
    expect(canAccessConfigTab('contas-conectadas', ownerCan, 'owner')).toBe(true);
    expect(canAccessConfigTab('contas-conectadas', adminCan, 'admin')).toBe(true);
    expect(canAccessConfigTab('contas-conectadas', agentCan, 'agent')).toBe(false);
    expect(
      canAccessConfigTab(
        'contas-conectadas',
        makeCan(
          fakeMembership({
            role: 'agent',
            role_id: 'custom',
            permissions: { configuracoes: 'ver' },
          }),
        ),
        'agent',
      ),
    ).toBe(true);
  });

  it('falls back to just the "all" tabs (Perfil/Notificações/MCP) for an unknown or missing role', () => {
    // `permission: 'all'` bypasses can()/workspaceRole entirely by design
    // (perfil/notificacoes are a member's own account settings, not
    // workspace-permission-gated) -- everything else requires a resolved
    // membership or a literal 'owner' workspaceRole, both absent here.
    expect(visibleConfigTabs(unresolvedCan, undefined, googleOn).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
      'mcp',
    ]);
    expect(visibleConfigTabs(unresolvedCan, null).map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
      'mcp',
    ]);
    expect(visibleConfigTabs(unresolvedCan, 'superuser').map((t) => t.path)).toEqual([
      'perfil',
      'notificacoes',
      'mcp',
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
      for (const tab of visibleConfigTabs(can, workspaceRole, googleOn)) {
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
