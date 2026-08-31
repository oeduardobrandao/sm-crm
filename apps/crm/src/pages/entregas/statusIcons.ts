import {
  CalendarClock,
  Camera,
  CircleCheck,
  Clapperboard,
  Eye,
  Flag,
  Hourglass,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Music,
  Palette,
  PencilLine,
  Scissors,
  Send,
  ShieldCheck,
  Star,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

/**
 * Whitelist curada de ícones para status customizados. A chave (nome
 * kebab-case do lucide) é o que vai para post_status_definitions.icone;
 * nome desconhecido ou NULL cai no fallback do dot de cor.
 */
export const CUSTOM_STATUS_ICONS: Record<string, LucideIcon> = {
  'pencil-line': PencilLine,
  palette: Palette,
  camera: Camera,
  clapperboard: Clapperboard,
  scissors: Scissors,
  'wand-sparkles': WandSparkles,
  lightbulb: Lightbulb,
  eye: Eye,
  'message-circle': MessageCircle,
  megaphone: Megaphone,
  'shield-check': ShieldCheck,
  send: Send,
  'circle-check': CircleCheck,
  'calendar-clock': CalendarClock,
  hourglass: Hourglass,
  flag: Flag,
  star: Star,
  music: Music,
};

export function getCustomStatusIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return CUSTOM_STATUS_ICONS[name] ?? null;
}
