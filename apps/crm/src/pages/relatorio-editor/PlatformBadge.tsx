// Selo "TikTok" das camadas e do canvas do editor. Só o TikTok leva selo: o
// Instagram é o padrão e fica sem, para manter o visual de hoje.
import { blockPlatform } from '@mesaas/report-blocks/types';

export function PlatformBadge({ type, floating }: { type: string; floating?: boolean }) {
  if (blockPlatform(type) !== 'tiktok') return null;
  return (
    <span className={`rb-platform-badge${floating ? ' rb-platform-badge--floating' : ''}`}>
      TikTok
    </span>
  );
}
