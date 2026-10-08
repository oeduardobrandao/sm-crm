import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  Cake,
  CalendarHeart,
  Camera,
  Flag,
  Music2,
  PartyPopper,
  Send,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import type { CamadaId, CamadaItem } from './tipos';

/** Sidebar swatch icon of each layer. */
export const CAMADA_ICONE: Record<CamadaId, LucideIcon> = {
  posts: Camera,
  prazos: Flag,
  recebimentos: BanknoteArrowUp,
  pagamentos: BanknoteArrowDown,
  datas: Cake,
  comemorativas: PartyPopper,
};

/** Chip/popover icon of an item: posts by platform, important client dates
 *  apart from birthdays, otherwise the layer's own. */
export function IconeDaCamada({ item, ...props }: { item: CamadaItem } & LucideProps) {
  if (item.camada === 'posts') {
    if (item.post.platform === 'tiktok') return <Music2 {...props} />;
    if (item.post.platform === 'both') return <Send {...props} />;
    return <Camera {...props} />;
  }
  if (item.camada === 'datas' && item.tipo === 'data') return <CalendarHeart {...props} />;
  const Icone = CAMADA_ICONE[item.camada];
  return <Icone {...props} />;
}
