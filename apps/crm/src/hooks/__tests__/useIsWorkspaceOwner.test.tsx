import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../../context/AuthContext';
import { useIsWorkspaceOwner } from '../useIsWorkspaceOwner';
import { makeCan, fakeMembership } from '@/test/makeCan';

// `useIsWorkspaceOwner` itself never calls `can` — but these fixtures used to
// omit it from the AuthContextValue entirely, which would hand
// `can === undefined` to the first consumer down the line that did call it
// (Task 7 review note, addressed in Task 12). Each fixture below now carries
// a real, derivePermission-backed `can` matching its own workspaceRole.

describe('useIsWorkspaceOwner', () => {
  it('returns false when no provider', () => {
    const { result } = renderHook(() => useIsWorkspaceOwner());
    expect(result.current).toBe(false);
  });

  it('returns false when membershipResolved is false', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider
        value={
          {
            user: null,
            profile: null,
            role: 'owner',
            workspaceRole: null,
            membershipResolved: false,
            canSeeFinancials: 'unknown',
            can: makeCan(null),
            loading: false,
            refetchProfile: async () => {},
            signOut: async () => {},
          } as never
        }
      >
        {children}
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => useIsWorkspaceOwner(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('returns true when membershipResolved and workspaceRole is owner', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider
        value={
          {
            user: null,
            profile: null,
            role: 'agent',
            workspaceRole: 'owner',
            membershipResolved: true,
            canSeeFinancials: 'unknown',
            can: makeCan(fakeMembership({ role: 'owner' })),
            loading: false,
            refetchProfile: async () => {},
            signOut: async () => {},
          } as never
        }
      >
        {children}
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => useIsWorkspaceOwner(), { wrapper });
    expect(result.current).toBe(true);
  });

  it('returns false when membershipResolved but workspaceRole is null, even if profile role is owner', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider
        value={
          {
            user: null,
            profile: null,
            role: 'owner',
            workspaceRole: null,
            membershipResolved: true,
            canSeeFinancials: 'unknown',
            can: makeCan(null),
            loading: false,
            refetchProfile: async () => {},
            signOut: async () => {},
          } as never
        }
      >
        {children}
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => useIsWorkspaceOwner(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('returns false when membershipResolved errored, even if profile role is owner', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider
        value={
          {
            user: null,
            profile: null,
            role: 'owner',
            workspaceRole: null,
            membershipResolved: 'error',
            canSeeFinancials: 'unknown',
            can: makeCan(null),
            loading: false,
            refetchProfile: async () => {},
            signOut: async () => {},
          } as never
        }
      >
        {children}
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => useIsWorkspaceOwner(), { wrapper });
    expect(result.current).toBe(false);
  });
});
