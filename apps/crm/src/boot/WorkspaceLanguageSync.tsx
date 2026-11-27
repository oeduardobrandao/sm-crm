import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  effectiveLanguage,
  getExplicitLanguage,
  i18n,
  rememberWorkspaceLanguageAsHint,
  setActiveWorkspaceLanguage,
} from '@mesaas/i18n';
import { getCurrentWorkspace } from '@/store/workspace';

/** Inside the signed-in layout: opens the app in the workspace's language (unless the user made
 * an explicit choice, which `effectiveLanguage()` ranks first). Shares the `currentWorkspace`
 * query with the settings tabs, so there is one fetch. Mounted by ProtectedRoute, so it
 * lives exactly while a signed-in user is on a protected page; leaving that tree (sign-out, or a
 * public page) clears the workspace language on unmount.
 *
 * Without an explicit choice the hint is overwritten with the workspace language, so a Brazilian
 * owner who once visited `/en` does not get an English first paint or login next time.
 *
 * Churn to expect: the workspace language lives in memory and is cleared on unmount, and
 * ProtectedRoute remounts this component when the user crosses between ProtectedRoute instances
 * (for example /workspace-setup to the app). In that gap `effectiveLanguage()` falls back to the
 * hint, and SavedLanguageSync may briefly switch to it before this re-applies the workspace
 * language. The cached `currentWorkspace` makes the re-apply immediate, so it is not visible. */
export function WorkspaceLanguageSync() {
  const { data } = useQuery({ queryKey: ['currentWorkspace'], queryFn: getCurrentWorkspace });
  const language = data?.language ?? null;

  useEffect(() => {
    if (!language) return;
    setActiveWorkspaceLanguage(language);
    if (!getExplicitLanguage()) rememberWorkspaceLanguageAsHint(language);
    const target = effectiveLanguage();
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [language]);

  useEffect(() => () => setActiveWorkspaceLanguage(null), []);
  return null;
}
