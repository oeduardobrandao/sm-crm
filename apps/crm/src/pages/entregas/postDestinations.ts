import {
  CONTENT_FORMAT_LABELS,
  PLATFORM_DEFS,
  PLATFORM_IDS,
  captionMaxFor,
  supportsFormat,
  type ContentFormat,
  type PlatformId,
} from '@mesaas/platforms';
// type-only: PostsKanbanView.test mocks '@/store' com uma lista fixa de exports.
import type { PostTargetSummary } from '@/store/postTargets';
import type { WorkflowPost } from '@/store/posts';

// Regras dos destinos de um post (P2). Spec 2026-09-29-platform-agnostic-posts.
// O estado de cada destino é derivado aqui, e não numa view SQL (desvio 1 do plano P2):
// os publicadores ainda escrevem as colunas legadas até P4 (TikTok) e P5 (Instagram).

export type DestinationState =
  | 'pendente'
  | 'aguardando_aprovacao'
  | 'agendado'
  | 'processando'
  | 'publicado'
  | 'falha'
  | 'disponivel';

export const DESTINATION_STATE_LABELS: Record<DestinationState, string> = {
  pendente: 'Pendente',
  aguardando_aprovacao: 'Aguardando aprovação',
  agendado: 'Agendado',
  processando: 'Publicando',
  publicado: 'Publicado',
  falha: 'Falhou',
  disponivel: 'Disponível',
};

export type DestinationPostFields = Pick<
  WorkflowPost,
  'status' | 'scheduled_at' | 'instagram_media_id' | 'publish_error' | 'tiktok_publish_status'
>;

// Geral fica "Disponível" depois da aprovação do cliente. Shim de P2: P3 grava
// post_targets.status = 'disponivel' na aprovação e a linha passa a mandar.
// falha_publicacao: aprovado, a publicação social falhou, o conteúdo segue para baixar.
const GERAL_AVAILABLE = new Set<WorkflowPost['status']>([
  'aprovado_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function resolveDestinationState(
  post: DestinationPostFields,
  target: PostTargetSummary,
  now: Date = new Date(),
): DestinationState {
  // P4/P5 movem o estado de publicação para post_targets: fora de 'pendente', a linha manda.
  if (target.status !== 'pendente') return target.status;

  // falha = coluna da própria plataforma E post em falha_publicacao. Só a coluna não
  // basta: nada limpa publish_error/tiktok_publish_status quando alguém volta o post
  // para rascunho na mão. Só o status não basta: uma falha do TikTok num post "both"
  // também grava falha_publicacao, e o Instagram não falhou.
  const failed = post.status === 'falha_publicacao';
  if (target.platform === 'instagram') {
    if (post.instagram_media_id) return 'publicado';
    if (failed && post.publish_error) return 'falha';
  } else if (target.platform === 'tiktok') {
    const s = post.tiktok_publish_status;
    if (s === 'published') return 'publicado';
    if (failed && s === 'failed') return 'falha';
    if (s === 'initiated' || s === 'processing') return 'processando';
  } else if (GERAL_AVAILABLE.has(post.status)) {
    return 'disponivel';
  }

  if (PLATFORM_DEFS[target.platform].autoPublish) {
    if (post.status === 'postado') return 'publicado';
    if (post.status === 'agendado') {
      const due = !!post.scheduled_at && new Date(post.scheduled_at) <= now;
      return due ? 'processando' : 'agendado';
    }
  }
  return post.status === 'enviado_cliente' ? 'aguardando_aprovacao' : 'pendente';
}

/** "Vídeo vertical → Reels"; só o rótulo neutro quando o nativo é igual (Geral);
 *  null quando a plataforma não aceita o formato. */
export function nativeFormatHint(platform: PlatformId, tipo: ContentFormat): string | null {
  const native = PLATFORM_DEFS[platform].nativeFormats[tipo];
  if (!native) return null;
  const neutral = CONTENT_FORMAT_LABELS[tipo];
  return native.label === neutral ? neutral : `${neutral} → ${native.label}`;
}

/** Corta em `max` unidades UTF-16 sem deixar meio par substituto (emoji) no fim. */
export function truncateCaption(text: string, max: number | null): string {
  if (max == null || text.length <= max) return text;
  let out = text.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/**
 * Legenda com que um destino recém-ligado começa (spec: "A newly added destination
 * starts from the first destination's caption"). Primeiro destino que o post JÁ tem,
 * na ordem do registro, com legenda não vazia; cortada no limite do destino novo.
 * Quem chama só usa o resultado se a legenda própria do destino estiver vazia.
 */
export interface CaptionSeed {
  caption: string;
  /** Caracteres cortados para caber no limite do destino novo (0 = cópia inteira). */
  cut: number;
}

export function seedCaptionFor(
  platform: PlatformId,
  current: PlatformId[],
  captions: Partial<Record<PlatformId, string | null>>,
  tipo: ContentFormat,
): CaptionSeed | null {
  for (const p of PLATFORM_IDS) {
    if (p === platform || !current.includes(p)) continue;
    const text = captions[p];
    if (text && text.trim()) {
      const caption = truncateCaption(text, captionMaxFor(platform, tipo));
      return { caption, cut: text.length - caption.length };
    }
  }
  return null;
}

export interface DestinationToggleOption {
  platform: PlatformId;
  on: boolean;
  /** Por que este toggle não pode ser clicado agora: ligar (stories, formato, conta)
   *  ou desligar um destino já publicado. null = pode. O componente ainda recusa
   *  desligar o último destino e trava tudo com o post agendado/postado. */
  disabledReason: string | null;
}

export function destinationToggleOptions(args: {
  boardPlatforms: PlatformId[];
  current: PlatformId[];
  /** Destinos cujo estado resolvido é 'publicado' (resolveDestinationState). */
  published: PlatformId[];
  tipo: ContentFormat;
  tiktokFeatureEnabled: boolean;
  hasActiveTikTokAccount: boolean;
  isExpress: boolean;
}): DestinationToggleOption[] {
  const { boardPlatforms, current, published, tipo, tiktokFeatureEnabled, hasActiveTikTokAccount } =
    args;
  // Post Express é só Instagram (P1 desvio 8): sem linha de Destinos.
  if (args.isExpress) return [];
  return PLATFORM_IDS.filter((p) => {
    if (current.includes(p)) return true;
    if (!boardPlatforms.includes(p)) return false;
    return PLATFORM_DEFS[p].planFeature !== 'feature_tiktok' || tiktokFeatureEnabled;
  }).map((p) => {
    const on = current.includes(p);
    let disabledReason: string | null = null;
    if (on && published.includes(p)) {
      // Tirar um destino publicado apagaria o registro de onde o post saiu.
      disabledReason = 'Já publicado';
    } else if (!on) {
      if (p === 'tiktok' && tipo === 'stories') {
        disabledReason = 'Stories não são suportados no TikTok';
      } else if (!supportsFormat(p, tipo)) {
        disabledReason = `${PLATFORM_DEFS[p].label} não aceita ${CONTENT_FORMAT_LABELS[tipo]}`;
      } else if (p === 'tiktok' && !hasActiveTikTokAccount) {
        disabledReason = 'Cliente sem conta TikTok ativa';
      }
    }
    return { platform: p, on, disabledReason };
  });
}
