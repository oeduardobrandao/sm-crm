import { useContext } from 'react';
import { HubContext } from '../HubContext';
import type { HubLook } from '../theme';

/**
 * 'pauta' when the workspace has feature_hub_pauta. Reads the context directly
 * (not useHub, which throws without a provider) so components rendered outside
 * HubShell, such as the public ConvitePage or isolated tests, fall back to classic.
 */
export function useHubLook(): HubLook {
  return useContext(HubContext)?.bootstrap?.feature_hub_pauta === true ? 'pauta' : 'classic';
}
