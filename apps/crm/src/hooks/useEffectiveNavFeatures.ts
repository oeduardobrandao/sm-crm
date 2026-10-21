import { useQuery } from '@tanstack/react-query';
import { CONTACTS_COUNT_KEY, countInstagramAutomations, countInstagramContacts } from '@/store';

/**
 * Nav visibility for the `automacoes` item follows the workspace's automation
 * flag OR whether it already has automations -- downgrading a plan below the
 * automation tier must not hide the nav link to automations the workspace
 * already created, since list/toggle/delete stay ungated post-downgrade (only
 * creating a NEW automation is gated). Pure so the OR logic is unit-testable
 * without a QueryClient. OR whether it has retained automation contacts (they
 * survive automation deletion).
 *
 * Passing `null` through unchanged matches getNavGroups' own contract: a null
 * `features` map means "still loading / unlimited workspace", where the nav
 * filter is skipped entirely (see nav-data.ts), so there is nothing to widen.
 */
export function buildEffectiveNavFeatures(
  features: Record<string, boolean> | null,
  hasAutomations: boolean,
  hasContacts = false,
): Record<string, boolean> | null {
  if (!features) return features;
  return {
    ...features,
    feature_instagram_automation:
      features.feature_instagram_automation || hasAutomations || hasContacts,
  };
}

/**
 * Wraps buildEffectiveNavFeatures with the live automations count. Powers
 * Sidebar/MobileNav's nav item visibility ONLY -- the "Nova automação" button
 * inside AutomacoesPage reads the raw flag via FeatureGate, since creating a
 * new automation should still be gated even when older ones already exist.
 */
export function useEffectiveNavFeatures(
  features: Record<string, boolean> | null,
): Record<string, boolean> | null {
  const { data: count } = useQuery({
    queryKey: ['instagram-automations-count'],
    queryFn: countInstagramAutomations,
    staleTime: 300_000,
  });
  const contacts = useQuery({
    queryKey: CONTACTS_COUNT_KEY,
    queryFn: countInstagramContacts,
    staleTime: 300_000,
  });
  // Errored count fails open (retained contacts must stay reachable).
  const hasContacts = contacts.isError || (contacts.data ?? 0) > 0;
  return buildEffectiveNavFeatures(features, (count ?? 0) > 0, hasContacts);
}
