import { FileDown, Instagram, Music2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlatformId } from '@mesaas/platforms';

/** Ícone de cada plataforma (chips de quadro, Destinos, abas de legenda, card). */
export const PLATFORM_ICONS: Record<PlatformId, LucideIcon> = {
  instagram: Instagram,
  tiktok: Music2,
  geral: FileDown,
};
