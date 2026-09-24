import { CircleDashed, Clapperboard, GalleryHorizontalEnd, Image } from 'lucide-react';
import type { WorkflowPost } from '../../store';

/** Ícone por tipo de post: fallback de capa no quadro de Publicações e no card
 *  de processo individual, e marcador das linhas da Minha fila. */
export const TIPO_ICONS: Record<WorkflowPost['tipo'], typeof Image> = {
  feed: Image,
  reels: Clapperboard,
  carrossel: GalleryHorizontalEnd,
  stories: CircleDashed,
};
