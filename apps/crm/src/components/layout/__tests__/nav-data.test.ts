import { describe, it, expect } from 'vitest';
import { getNavGroups, getMoreSheetGroups } from '../nav-data';

const ids = (groups: ReturnType<typeof getNavGroups>) =>
  groups.flatMap((g) => g.items.map((i) => i.id));

describe('getNavGroups financial capability', () => {
  it('shows financeiro and contratos to an authorized admin', () => {
    const got = ids(getNavGroups('admin', null, true, 'admin'));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('hides financeiro and contratos from a restricted admin', () => {
    const got = ids(getNavGroups('admin', null, false, 'admin'));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Nav fails closed alongside values: an unresolved capability must not flash
  // financial nav items at a restricted admin.
  it('hides them while the capability is unknown', () => {
    const got = ids(getNavGroups('admin', null, 'unknown', 'admin'));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('always shows them to an owner, even with the flag false', () => {
    const got = ids(getNavGroups('owner', null, false, 'owner'));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  // Regression: the owner exemption must key off workspaceRole (the ACTIVE
  // workspace's workspace_members row), not the profile-derived `role`.
  // switchWorkspace never writes profiles.role, so an owner in workspace A who
  // is a restricted admin in workspace B previously kept seeing
  // Financeiro/Contratos while working in B — the link then bounced to the
  // restriction screen.
  it('hides financeiro/contratos from a profile-owner who is a restricted admin in the active workspace', () => {
    const got = ids(getNavGroups('owner', null, false, 'admin'));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Hydration case: workspaceRole is null until membership resolves. Accepted
  // cost is a brief flicker (financial items appear a beat later for a real
  // owner) rather than a persistently wrong nav for multi-workspace users.
  it('hides financeiro/contratos for a profile-owner while workspaceRole is still unresolved', () => {
    const got = ids(getNavGroups('owner', null, 'unknown', null));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('keeps equipe for an authorized admin', () => {
    expect(ids(getNavGroups('admin', null, true, 'admin'))).toContain('equipe');
  });

  // Pre-existing mismatch this task fixes: ProtectedRoute blocks agents from
  // /equipe, but nav-data kept rendering the link, so agents saw an item that
  // bounced them to /dashboard.
  it('hides equipe from agents, who are route-blocked from it', () => {
    expect(ids(getNavGroups('agent', null, true, 'agent'))).not.toContain('equipe');
  });

  it('still hides leads and financials from agents', () => {
    const got = ids(getNavGroups('agent', null, true, 'agent'));
    expect(got).not.toContain('leads');
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('applies the capability to the more-sheet too', () => {
    expect(ids(getMoreSheetGroups('admin', null, false, 'admin'))).not.toContain('financeiro');
  });
});
