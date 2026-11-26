import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { effectiveLanguage, i18n, setActiveWorkspaceLanguage } from '@mesaas/i18n';
import { getCurrentWorkspace } from '@/store/workspace';

/** Inside the signed-in layout: opens the app in the workspace's language (unless the user made
 * an explicit choice, which `effectiveLanguage()` ranks first). Shares the `currentWorkspace`
 * query with the settings tabs, so there is one fetch. Cleared on unmount (sign-out). */
export function WorkspaceLanguageSync() {
  const { data } = useQuery({ queryKey: ['currentWorkspace'], queryFn: getCurrentWorkspace });
  const language = data?.language ?? null;

  useEffect(() => {
    if (!language) return;
    setActiveWorkspaceLanguage(language);
    const target = effectiveLanguage();
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [language]);

  useEffect(() => () => setActiveWorkspaceLanguage(null), []);
  return null;
}
