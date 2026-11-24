import {
  DEFAULT_HUB_THEME,
  type HubCardStyle,
  type HubRadius,
  type HubSurface,
  type HubThemeConfig,
} from '../theme';
import type { HubThemeInfo } from '../types';

/**
 * The resolver input for a workspace: its accent plus, only when `customized` is true, the
 * surface/fonts/radius/card style it picked. Shared by the loaded portal and the login screen
 * so both gate the preset fields identically (a stale or tampered payload with
 * `customized: false` still renders neutral).
 */
export function buildHubThemeConfig(
  brandColor: string,
  ht: HubThemeInfo | null | undefined,
): HubThemeConfig {
  if (ht?.customized) {
    return {
      accent: brandColor,
      surface: ht.surface as HubSurface,
      fontDisplay: ht.font_display,
      fontBody: ht.font_body,
      radius: ht.radius as HubRadius,
      cardStyle: ht.card_style as HubCardStyle,
      customized: true,
    };
  }
  return { ...DEFAULT_HUB_THEME, accent: brandColor };
}
