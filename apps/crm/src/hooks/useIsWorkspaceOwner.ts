import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Ownership of the ACTIVE workspace, for upgrade CTAs. Requires the RESOLVED
 * workspace-membership role — deliberately stricter than CobrancaPage's
 * (workspaceRole ?? role): profiles.role is stale across workspace switches,
 * so falling back to it could nudge a removed member or a foreign-workspace
 * owner toward a billing page that will refuse them. An errored lookup just
 * hides the nudge (fail-quiet). Safe outside an AuthProvider (returns false),
 * matching useWorkspaceLimits' context pattern.
 */
export function useIsWorkspaceOwner(): boolean {
  const auth = useContext(AuthContext);
  if (!auth || auth.membershipResolved === false) return false;
  return auth.workspaceRole === 'owner';
}
