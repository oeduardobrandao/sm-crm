// Ícone da plataforma (spec 2026-10-28 seções §Rendering): o mesmo no título de seção do
// relatório e no editor do CRM. Decorativo: o nome da plataforma vem sempre ao lado.
import { Instagram, Music2, Store } from 'lucide-react';
import type { ReportPlatform } from './platform';

// Google Meu Negócio: a vitrine do menu do CRM (ph-storefront), nunca o logo do Google.
const ICONS = { instagram: Instagram, tiktok: Music2, google: Store } as const;

export function PlatformIcon({
  platform,
  className,
  size = 20,
}: {
  platform: ReportPlatform;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[platform];
  return <Icon aria-hidden="true" className={className} size={size} />;
}
