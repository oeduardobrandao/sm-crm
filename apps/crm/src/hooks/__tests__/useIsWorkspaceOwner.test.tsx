import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../../context/AuthContext';
import { useIsWorkspaceOwner } from '../useIsWorkspaceOwner';

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
