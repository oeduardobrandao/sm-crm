import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Ownership of the ACTIVE workspace, for upgrade CTAs. Follows the
 * CobrancaPage.tsx:73 convention ((workspaceRole ?? role) === 'owner') and
 * stays false until membership resolution has actually run, so a CTA never
 * flashes for someone the billing page will refuse. Safe outside an
 * AuthProvider (returns false), matching useWorkspaceLimits' context pattern.
 */
export function useIsWorkspaceOwner(): boolean {
  const auth = useContext(AuthContext);
  if (!auth || auth.membershipResolved === false) return false;
  return (auth.workspaceRole ?? auth.role) === 'owner';
}
