import { describe, it, expect } from 'vitest';
import { getNavGroups, getMoreSheetGroups } from '../nav-data';

const ids = (groups: ReturnType<typeof getNavGroups>) =>
  groups.flatMap((g) => g.items.map((i) => i.id));

describe('getNavGroups financial capability', () => {
  it('shows financeiro and contratos to an authorized admin', () => {
    const got = ids(getNavGroups('admin', null, true));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('hides financeiro and contratos from a restricted admin', () => {
    const got = ids(getNavGroups('admin', null, false));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Nav fails closed alongside values: an unresolved capability must not flash
  // financial nav items at a restricted admin.
  it('hides them while the capability is unknown', () => {
    const got = ids(getNavGroups('admin', null, 'unknown'));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('always shows them to an owner, even with the flag false', () => {
    const got = ids(getNavGroups('owner', null, false));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('keeps equipe for an authorized admin', () => {
    expect(ids(getNavGroups('admin', null, true))).toContain('equipe');
  });

  // Pre-existing mismatch this task fixes: ProtectedRoute blocks agents from
  // /equipe, but nav-data kept rendering the link, so agents saw an item that
  // bounced them to /dashboard.
  it('hides equipe from agents, who are route-blocked from it', () => {
    expect(ids(getNavGroups('agent', null, true))).not.toContain('equipe');
  });

  it('still hides leads and financials from agents', () => {
    const got = ids(getNavGroups('agent', null, true));
    expect(got).not.toContain('leads');
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('applies the capability to the more-sheet too', () => {
    expect(ids(getMoreSheetGroups('admin', null, false))).not.toContain('financeiro');
  });
});
