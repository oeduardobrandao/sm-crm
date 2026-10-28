// Ícone da plataforma (spec 2026-10-28 seções §Rendering): o mesmo no título de seção do
// relatório e no editor do CRM. Decorativo: o nome da plataforma vem sempre ao lado.
import { Instagram, Music2 } from 'lucide-react';
import type { ReportPlatform } from './platform';

const ICONS = { instagram: Instagram, tiktok: Music2 } as const;

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
